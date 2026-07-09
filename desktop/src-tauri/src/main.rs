#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::Result;
use parking_lot::Mutex;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Listener, Manager};

/// #892: bundled libwayland in AppImage can ABI-mismatch the host Wayland
/// compositor → WebKitWebProcess `abort()`s on EGL display creation. Redirect
/// the child to the host's libwayland via LD_PRELOAD before WebKit forks.
#[cfg(target_os = "linux")]
fn linux_webkit_compat() {
    fn set_default(key: &str, value: &str) {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
        }
    }

    // Always-on: DMABUF renderer breaks on a wider set of Mesa stacks than
    // libwayland bundling does. Cheap to disable, slow path is still fine.
    set_default("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    let in_appimage = std::env::var_os("APPDIR").is_some();
    let on_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    if !(in_appimage && on_wayland) {
        return;
    }

    // Disable accelerated compositing as well — same EGL init path.
    set_default("WEBKIT_DISABLE_COMPOSITING_MODE", "1");

    // Skip /usr/lib/libwayland-client.so.0 — on 64-bit Fedora that path can
    // resolve to a 32-bit library and the loader prints a wrong-ELF-class
    // warning instead of preloading.
    const CANDIDATES: &[&str] = &[
        "/usr/lib64/libwayland-client.so.0",
        "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
        "/lib/x86_64-linux-gnu/libwayland-client.so.0",
    ];
    let Some(lib) = CANDIDATES.iter().find(|p| Path::new(p).exists()) else {
        return;
    };
    let existing = std::env::var("LD_PRELOAD").unwrap_or_default();
    let merged = if existing.is_empty() {
        (*lib).to_string()
    } else {
        format!("{lib}:{existing}")
    };
    std::env::set_var("LD_PRELOAD", merged);
}

#[derive(Serialize)]
struct FileEntry {
    path: String,
    depth: u32,
    kind: &'static str,
    name: String,
}

const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "out"];
const MAX_ENTRIES: usize = 800;

fn walk_dir(dir: &Path, depth: u32, max_depth: u32, out: &mut Vec<FileEntry>) {
    if depth > max_depth || out.len() >= MAX_ENTRIES {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut items: Vec<_> = entries.flatten().collect();
    items.sort_by_key(|e| {
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        (!is_dir, e.file_name())
    });
    for entry in items {
        if out.len() >= MAX_ENTRIES {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        // Hidden files (.git, .next, .env) and well-known noise dirs.
        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else { continue };
        let path = entry.path().to_string_lossy().into_owned();
        if file_type.is_dir() {
            out.push(FileEntry {
                path: path.clone(),
                depth,
                kind: "dir",
                name,
            });
            walk_dir(&entry.path(), depth + 1, max_depth, out);
        } else if file_type.is_file() {
            out.push(FileEntry {
                path,
                depth,
                kind: "file",
                name,
            });
        }
    }
}

#[tauri::command]
fn list_workspace_tree(root: String, max_depth: u32) -> Result<Vec<FileEntry>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let mut out = Vec::new();
    walk_dir(root_path, 0, max_depth.min(4), &mut out);
    Ok(out)
}

#[derive(Serialize)]
struct GitStatusEntry {
    path: String,
    kind: &'static str,
}

#[tauri::command]
fn git_status(root: String) -> Result<Vec<GitStatusEntry>, String> {
    use std::process::Command;
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let mut cmd = Command::new("git");
    cmd.arg("status").arg("--porcelain").arg("-z").current_dir(root_path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return Ok(Vec::new()), // not a git repo / no git on PATH — silent
    };
    if !output.status.success() {
        return Ok(Vec::new()); // not a git repo — silent
    }
    let mut out = Vec::new();
    for rec in output.stdout.split(|&b| b == 0) {
        if rec.len() < 4 {
            continue;
        }
        // `git status --porcelain -z` format: `XY ` + path, where X / Y are
        // index / worktree statuses. Map both to a coarse `kind`.
        let x = rec[0];
        let y = rec[1];
        let kind = match (x, y) {
            (b'?', b'?') => "untracked",
            (b'A', _) | (_, b'A') => "added",
            (b'D', _) | (_, b'D') => "deleted",
            (b'M', _) | (_, b'M') => "modified",
            (b'R', _) | (_, b'R') => "renamed",
            _ => continue,
        };
        let path = String::from_utf8_lossy(&rec[3..]).into_owned();
        out.push(GitStatusEntry { path, kind });
    }
    Ok(out)
}

#[tauri::command]
fn open_in_editor(command: String, path: String, line: Option<u32>) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("editor command is empty".into());
    }
    // VS Code / Cursor / Windsurf understand `-g path:line`; harmless for others if `line` is None.
    let mut cmd;
    #[cfg(windows)]
    {
        // Spawn through cmd.exe so `.cmd` shims (code.cmd, cursor.cmd) resolve via PATH.
        cmd = Command::new("cmd");
        cmd.arg("/c").arg(trimmed);
        if let Some(l) = line {
            cmd.arg("-g").arg(format!("{}:{}", path, l));
        } else {
            cmd.arg(&path);
        }
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        cmd = Command::new(trimmed);
        if let Some(l) = line {
            cmd.arg("-g").arg(format!("{}:{}", path, l));
        } else {
            cmd.arg(&path);
        }
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    cmd.spawn().map_err(|e| format!("spawn {trimmed}: {e}"))?;
    Ok(())
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("write failed: {e}"))
}

// ── Desktop shell lifecycle: detect CLI → install → start TUI → load dashboard ──

#[derive(Default)]
struct DesktopState {
    child: Arc<Mutex<Option<Child>>>,
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

fn cli_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["reasonix-code.exe"]
    } else {
        &["reasonix-code"]
    }
}

fn find_cli() -> Option<PathBuf> {
    // 0. Allow developers to override the CLI path for debugging.
    if let Some(override_path) = std::env::var("REASONIX_CLI").ok().filter(|s| !s.is_empty()) {
        let p = PathBuf::from(override_path);
        if p.is_file() {
            return Some(p);
        }
        eprintln!("[reasonix] REASONIX_CLI is set but file does not exist: {}", p.display());
    }

    // 1. Known install location used by install.ps1.
    if let Some(home) = home_dir() {
        let install_dir = home.join(".reasonix-code").join("bin");
        for name in cli_names() {
            let p = install_dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    // 2. PATH lookup.
    let path_var = std::env::var("PATH").ok()?;
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in path_var.split(sep) {
        for name in cli_names() {
            let p = Path::new(dir).join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn parse_dashboard_url(line: &str) -> Option<String> {
    if !line.contains("/dashboard") {
        return None;
    }
    let arrow = "→";
    let idx = line.find(arrow)?;
    let arrow_len = arrow.chars().next().map(|c| c.len_utf8()).unwrap_or(1);
    let url = line[idx + arrow_len..].trim();
    if url.starts_with("http://") || url.starts_with("https://") {
        Some(url.to_string())
    } else {
        None
    }
}

fn spawn_tui(
    app: &tauri::AppHandle,
    state: &DesktopState,
    cli: &Path,
    cwd: &Path,
) -> Result<(), String> {
    let mut cmd = Command::new(cli);
    cmd.arg("code").arg(cwd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start Reasonix TUI: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    *state.child.lock() = Some(child);

    // Drain stdout so the child never blocks on a full pipe.
    thread::spawn(move || {
        let _ = BufReader::new(stdout).lines().count();
    });

    // Parse stderr for the dashboard URL, then keep emitting lines for the splash UI.
    let app_stderr = app.clone();
    let child_for_exit = state.child.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        let mut found_url = false;
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_stderr.emit("cli:stderr", line.clone());
            if !found_url {
                if let Some(url) = parse_dashboard_url(&line) {
                    found_url = true;
                    let _ = app_stderr.emit("cli:url", url);
                }
            }
        }

        // Stderr closed — watch for process exit and notify the UI.
        let app_exit = app_stderr.clone();
        let watcher = child_for_exit.clone();
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let done = {
                    let mut guard = watcher.lock();
                    match guard.as_mut() {
                        Some(c) => match c.try_wait() {
                            Ok(Some(status)) => {
                                let code = status.code();
                                let _ = app_exit.emit("cli:exit", code);
                                guard.take();
                                true
                            }
                            Ok(None) => false,
                            Err(_) => {
                                guard.take();
                                true
                            }
                        },
                        None => true,
                    }
                };
                if done {
                    break;
                }
                if Instant::now() >= deadline {
                    break;
                }
                thread::sleep(Duration::from_millis(250));
            }
        });
    });

    Ok(())
}

fn start_backend(app: &tauri::AppHandle, state: &DesktopState) {
    let app = app.clone();
    let state = DesktopState {
        child: state.child.clone(),
    };
    thread::spawn(move || {
        let result: Result<(), String> = (|| {
            let cli = find_cli().ok_or(
                "reasonix-code CLI not found. Please install it with:\n\
                 powershell -ExecutionPolicy Bypass -File install.ps1",
            )?;
            let cwd = std::env::current_dir().map_err(|e| format!("no current directory: {e}"))?;
            spawn_tui(&app, &state, &cli, &cwd)
        })();
        if let Err(err) = result {
            let _ = app.emit("cli:error", err);
        }
    });
}

fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .status();
        let _ = Command::new("pkill")
            .args(["-KILL", "-P", &pid.to_string()])
            .status();
    }
}

fn navigate_main_window(app: &tauri::AppHandle, url: &str) {
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(parsed) = url.parse::<tauri::Url>() {
            let _ = w.navigate(parsed);
        }
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    linux_webkit_compat();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            open_in_editor,
            list_workspace_tree,
            git_status,
            write_text_file
        ])
        .setup(|app| {
            // #1119: Updater pubkey is empty — auto-updates will not be
            // cryptographically verified. Generate a keypair before release:
            //   cargo tauri signer generate -w ~/.tauri/reasonix.key
            // then set the public key in tauri.conf.json's updater.pubkey.
            // This warning is best-effort; the real check happens at build time.
            {
                let ctx: tauri::Context<tauri::Wry> = tauri::generate_context!();
                let updater_config = ctx.config().plugins.0.get("updater");
                let pubkey_empty = updater_config
                    .and_then(|u| u.get("pubkey"))
                    .and_then(|k| k.as_str())
                    .map(|k| k.is_empty())
                    .unwrap_or(true);
                if pubkey_empty {
                    eprintln!(
                        "[reasonix] WARNING: updater.pubkey is empty — auto-update artifacts are NOT cryptographically verified.\n\
                         [reasonix] Generate a signing key: `cargo tauri signer generate -w ~/.tauri/reasonix.key`\n\
                         [reasonix] Then set the public key in tauri.conf.json's updater.pubkey."
                    );
                }
            }

            let app_handle = app.handle().clone();
            app.listen("cli:url", move |event| {
                let url = serde_json::from_str::<String>(event.payload()).unwrap_or_default();
                if !url.is_empty() {
                    navigate_main_window(&app_handle, &url);
                }
            });

            if let Some(w) = app.get_webview_window("main") {
                // HiDPI fit: the JSON config asks for 1024x720 logical px.
                // On Windows laptops at 200% scale (1920x1080 → 960x540
                // effective logical px) that overflows the screen and the
                // window opens partially off-canvas. Clamp to 90% of the
                // monitor's available logical size whenever the configured
                // size doesn't fit, then recenter.
                if let Ok(Some(monitor)) = w.current_monitor() {
                    let scale = monitor.scale_factor();
                    let phys = monitor.size();
                    let avail_w = phys.width as f64 / scale;
                    let avail_h = phys.height as f64 / scale;
                    let want_w = 1024_f64.min(avail_w * 0.9);
                    let want_h = 720_f64.min(avail_h * 0.9);
                    if want_w < 1024.0 || want_h < 720.0 {
                        let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize {
                            width: want_w,
                            height: want_h,
                        }));
                        let _ = w.center();
                    }
                }
                // macOS 透明窗口：默认 macOS 配置启用透明背景（视觉效果更原生）。
                // 设置 REASONIX_DESKTOP_OPAQUE=1 可强制使用不透明深色背景，
                // 解决部分 macOS 版本（Ventura/Sonoma）下 WebKit 透明渲染的兼容性问题。
                #[cfg(target_os = "macos")]
                if std::env::var("REASONIX_DESKTOP_OPAQUE").is_ok() {
                    let _ = w.set_background_color(Some(tauri::window::Color(11, 11, 11, 255)));
                }
                if std::env::var("REASONIX_DEVTOOLS").is_ok() {
                    #[cfg(debug_assertions)]
                    w.open_devtools();
                }
            }

            let state = app.state::<DesktopState>();
            start_backend(app.handle(), &state);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("tauri build failed")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app.state::<DesktopState>();
                let child_opt = state.child.lock().take();
                if let Some(mut child) = child_opt {
                    let pid = child.id();
                    let _ = child.kill();
                    kill_process_tree(pid);
                }
            }
        });
}
