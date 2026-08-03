#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::Result;
use parking_lot::Mutex;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

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

// ── Environment check / install / launch commands ─────────────────────────────

#[derive(Serialize)]
struct EnvStatus {
    node_ok: bool,
    node_version: Option<String>,
    npm_ok: bool,
    cli_ok: bool,
    cli_version: Option<String>,
}

fn run_version_cmd(cmd: &mut Command) -> Option<String> {
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

fn parse_node_major(version: &str) -> Option<u32> {
    version
        .trim()
        .strip_prefix('v')
        .or(Some(version.trim()))
        .and_then(|s| s.split('.').next())
        .and_then(|s| s.parse().ok())
}

#[tauri::command]
fn check_environment() -> EnvStatus {
    let mut node_cmd = Command::new("node");
    node_cmd.arg("--version");
    // npm may only exist as npm.cmd (no npm.exe) on some installs — go through
    // cmd.exe like npm_install_cmd does.
    let mut npm_cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/c").arg("npm");
        c
    } else {
        Command::new("npm")
    };
    npm_cmd.arg("--version");
    #[cfg(windows)]
    {
        // GUI app (windows_subsystem = "windows") — don't flash console windows.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        node_cmd.creation_flags(CREATE_NO_WINDOW);
        npm_cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let node_version = run_version_cmd(&mut node_cmd);
    let node_ok = node_version
        .as_ref()
        .and_then(|v| parse_node_major(v))
        .map(|m| m >= 22)
        .unwrap_or(false);
    let npm_version = run_version_cmd(&mut npm_cmd);
    let npm_ok = npm_version.is_some();
    let cli_version = resolve_cli().and_then(|cli| {
        let mut cmd = cli_command(&cli);
        cmd.arg("--version");
        run_version_cmd(&mut cmd)
    });
    let cli_ok = cli_version.is_some();
    EnvStatus {
        node_ok,
        node_version,
        npm_ok,
        cli_version,
        cli_ok,
    }
}

#[tauri::command]
fn latest_cli_version() -> Option<String> {
    npm_view_latest_version()
}

/// Desktop shell build number — injected by CI (desktop.yml sets
/// DESKTOP_BUILD), "dev" for local builds. Displayed in the dashboard
/// title bar next to the CLI version.
#[tauri::command]
fn desktop_build() -> String {
    option_env!("DESKTOP_BUILD").unwrap_or("dev").to_string()
}

/// Set the native window title (used for "Reasonix Code · build N · cli X").
#[tauri::command]
fn set_window_title(app: AppHandle, title: String) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_title(&title);
    }
}

/// Append a line to ~/.reasonix-code/desktop.log (created on demand).
/// ~/.reasonix/config.json — the CLI's config (REASONIX_CONFIG_PATH wins).
fn cli_config_path() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("REASONIX_CONFIG_PATH") {
        if !p.trim().is_empty() {
            return Some(std::path::PathBuf::from(p));
        }
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))?;
    Some(std::path::PathBuf::from(home).join(".reasonix").join("config.json"))
}

fn config_has_api_key() -> bool {
    if let Ok(p) = std::env::var("DEEPSEEK_API_KEY") {
        if !p.trim().is_empty() {
            return true;
        }
    }
    let Some(path) = cli_config_path() else {
        return false;
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    matches!(v.get("apiKey"), Some(serde_json::Value::String(s)) if !s.trim().is_empty())
}

/// Whether the CLI has a usable API key (config.json `apiKey` or env).
/// The shell shows an inline key setup panel when this is false.
#[tauri::command]
fn has_api_key() -> bool {
    config_has_api_key()
}

/// Persist the DeepSeek API key into ~/.reasonix/config.json (preserving
/// all other fields) and export it for child processes.
#[tauri::command]
fn save_api_key(key: String) -> Result<(), String> {
    let trimmed = key.trim().to_string();
    if trimmed.is_empty() {
        return Err("API key 不能为空".into());
    }
    let Some(path) = cli_config_path() else {
        return Err("无法定位用户目录".into());
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut v: serde_json::Value = if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if let Some(obj) = v.as_object_mut() {
        obj.insert("apiKey".into(), serde_json::Value::String(trimmed.clone()));
    }
    let text = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    // Make it available to CLIs spawned after this point.
    std::env::set_var("DEEPSEEK_API_KEY", &trimmed);
    log_line(&format!("saved api key to {}", path.display()));
    Ok(())
}

fn log_line(msg: &str) {    let Some(home) = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(std::path::PathBuf::from)
    else {
        return;
    };
    let dir = home.join(".reasonix-code");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("desktop.log");
    use std::io::Write;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[{ts}] [rust] {msg}");
    }
}

/// Append a line to ~/.reasonix-code/desktop.log (created on demand).
/// The splash/container pages forward their console through this command,
/// and embedded dashboards relay via postMessage — so CDP-less debugging
/// works from the log file alone.
#[tauri::command]
fn log_console(level: String, msg: String) {
    log_line(&format!("[{level}] {msg}"));
}

/// Console-forwarding page-load hook for the Builder: wraps console.* and
/// routes errors to desktop.log via log_console. Embedded dashboards are
/// cross-origin iframes — those relay via embed-bridge instead.
fn console_forwarding_hook(
) -> impl Fn(&tauri::Webview, &tauri::webview::PageLoadPayload) + Send + Sync + 'static {
    |window, _payload| {
        let _ = window.eval(
            r#"(function () {
              try {
                var fwd = function (level, args) {
                  try {
                    var msg = Array.prototype.map.call(args, String).join(' ').slice(0, 2000);
                    window.__TAURI_INTERNALS__.invoke('log_console', { level: level, msg: msg });
                  } catch (e) {}
                };
                ['log','info','warn','error'].forEach(function (l) {
                  var orig = console[l];
                  console[l] = function () { fwd(l, arguments); orig.apply(console, arguments); };
                });
                window.addEventListener('error', function (e) {
                  fwd('error', [e.message, (e.filename||''), e.lineno]);
                });
                window.addEventListener('unhandledrejection', function (e) {
                  fwd('error', ['unhandledrejection:', String(e.reason).slice(0, 300)]);
                });
              } catch (e) {}
            })();"#,
        );
    }
}

/// Robust liveness probe for a workspace: checks both the process (via
/// try_wait, so a killed CLI is caught even if the exit watcher hasn't
/// fired yet) and the dashboard server (HTTP GET on its URL, 2 s timeout).
/// The container page checks this before restoring a hidden iframe, so it
/// never shows a frame whose backend is gone.
/// Checked before restoring a hidden iframe so we never show a frame whose
/// backend is gone. Death is decided ONLY by the process layer: a live
/// process (even if its dashboard HTTP is temporarily slow or mid-restart)
/// keeps its tab. Probe errors are treated as alive — a busy CLI server
/// must not look like a dead workspace (that killed tabs on tab switches).
#[tauri::command]
async fn workspace_alive(state: State<'_, DesktopState>, id: u64) -> Result<bool, String> {
    // Process layer.
    {
        let mut instances = state.instances.lock();
        let Some(inst) = instances.iter_mut().find(|i| i.id == id) else {
            return Ok(false);
        };
        match inst.child.try_wait() {
            Ok(Some(_)) => return Ok(false), // exited
            _ => {}
        }
    }

    Ok(true)
}

/// `npm view reasonix-code version` — the latest published version.
fn npm_view_latest_version() -> Option<String> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/c").arg("npm");
        c
    } else {
        Command::new("npm")
    };
    cmd.arg("view").arg("reasonix-code").arg("version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    run_version_cmd(&mut cmd)
}

/// Compare two version strings ("0.2.1", possibly with a leading "v" or a
/// dirty suffix). Only the major.minor.patch core matters for this prompt.
fn is_newer(latest: &str, local: &str) -> bool {
    fn nums(v: &str) -> Option<(u64, u64, u64)> {
        let v = v.trim().trim_start_matches('v');
        let core: String = v
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        let mut it = core.split('.');
        let major = it.next()?.parse().ok()?;
        let minor = it.next().unwrap_or("0").parse().ok()?;
        let patch = it.next().unwrap_or("0").parse().ok()?;
        Some((major, minor, patch))
    }
    match (nums(latest), nums(local)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

/// Synchronous `npm install -g --prefix <prefix> <spec>` — used by the
/// startup update flow; the command-version emits progress events instead.
fn install_cli_sync(version: Option<String>) -> Result<(), String> {
    let mut cmd = npm_install_cmd(version)?;
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let status = cmd.status().map_err(|e| format!("failed to run npm: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "npm install exited with {}",
            status.code().unwrap_or(-1)
        ))
    }
}

/// Startup check (desktop shell only): when the installed CLI is older than
/// the npm latest, ask the user via a native dialog whether to update. Runs
/// on a background thread after a short delay so the window is already up.
fn prompt_cli_update(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        let local = resolve_cli().and_then(|cli| {
            let mut cmd = cli_command(&cli);
            cmd.arg("--version");
            run_version_cmd(&mut cmd)
        });
        let Some(local) = local else { return };
        let Some(latest) = npm_view_latest_version() else { return };
        if !is_newer(&latest, &local) {
            return;
        }
        let msg = format!(
            "发现新版本 {latest}（当前 {local}）。是否立即更新？\n\n将执行: npm install -g reasonix-code@latest"
        );
        let app2 = app.clone();
        app.dialog()
            .message(msg)
            .title("Reasonix-Code 更新")
            .kind(tauri_plugin_dialog::MessageDialogKind::Info)
            .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                "立即更新".to_string(),
                "稍后".to_string(),
            ))
            .show(move |yes| {
                if !yes {
                    return;
                }
                let app3 = app2.clone();
                let latest2 = latest.clone();
                std::thread::spawn(move || {
                    let done_msg = match install_cli_sync(None) {
                        Ok(()) => format!("reasonix-code 已更新到 {latest2}。"),
                        Err(e) => format!("更新失败：{e}"),
                    };
                    let _ = app3
                        .dialog()
                        .message(done_msg)
                        .title("Reasonix-Code 更新")
                        .kind(tauri_plugin_dialog::MessageDialogKind::Info)
                        .show(|_| {});
                });
            });
    });
}

#[tauri::command]
fn install_node() -> Result<(), String> {
    tauri_plugin_opener::open_url("https://nodejs.org/en/download", None::<&str>)
        .map_err(|e| format!("failed to open browser: {e}"))
}

fn reasonix_npm_prefix() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".reasonix-code").join("npm-global"))
}

fn ensure_npm_prefix_dir() -> Result<PathBuf, String> {
    let prefix = reasonix_npm_prefix().ok_or("could not determine home directory")?;
    std::fs::create_dir_all(&prefix).map_err(|e| format!("failed to create npm prefix dir: {e}"))?;
    Ok(prefix)
}

fn add_prefix_bin_to_path(prefix: &Path) {
    let sep = if cfg!(windows) { ';' } else { ':' };
    let bins = vec![prefix.to_path_buf()];
    #[cfg(not(windows))]
    let bins = {
        let mut b = bins;
        b.push(prefix.join("bin"));
        b
    };

    if let Ok(current) = std::env::var("PATH") {
        let current_parts: Vec<&str> = current.split(sep).collect();
        let missing: Vec<String> = bins
            .into_iter()
            .filter(|b| !current_parts.contains(&b.to_string_lossy().as_ref()))
            .map(|b| b.to_string_lossy().into_owned())
            .collect();
        if !missing.is_empty() {
            std::env::set_var("PATH", format!("{}{}{}", missing.join(&sep.to_string()), sep, current));
        }
    }
}

fn npm_install_cmd(version: Option<String>) -> Result<Command, String> {
    let prefix = ensure_npm_prefix_dir()?;
    let prefix_str = prefix.to_string_lossy().into_owned();
    let spec = version.unwrap_or_else(|| "reasonix-code@latest".to_string());
    let args = vec!["install", "-g", "--prefix", &prefix_str, &spec];
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/c").arg("npm");
        c
    } else {
        Command::new("npm")
    };
    cmd.args(&args);
    Ok(cmd)
}

#[tauri::command]
fn install_cli(app: AppHandle, version: Option<String>) {
    thread::spawn(move || {
        let stderr_lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        let result = (|| -> Result<(), String> {
            let mut cmd = npm_install_cmd(version)?;
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }

            let mut child = cmd
                .spawn()
                .map_err(|e| format!("failed to start npm: {e}"))?;
            let stdout = child.stdout.take().ok_or("no stdout")?;
            let stderr = child.stderr.take().ok_or("no stderr")?;

            let app_stdout = app.clone();
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    let _ = app_stdout.emit("install:stdout", line);
                }
            });

            let app_stderr = app.clone();
            let stderr_capture = Arc::clone(&stderr_lines);
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    stderr_capture.lock().push(line.clone());
                    let _ = app_stderr.emit("install:stderr", line);
                }
            });

            let status = child
                .wait()
                .map_err(|e| format!("npm process error: {e}"))?;
            if !status.success() {
                let captured = stderr_lines.lock();
                let tail: Vec<&String> = captured.iter().rev().take(5).rev().collect();
                let detail = if tail.is_empty() {
                    "no stderr captured".to_string()
                } else {
                    format!("stderr:\n{}", tail.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n"))
                };
                return Err(format!(
                    "npm exited with code {:?}\n{}",
                    status.code(),
                    detail
                ));
            }
            if let Some(prefix) = reasonix_npm_prefix() {
                add_prefix_bin_to_path(&prefix);
                #[cfg(windows)]
                persist_prefix_to_user_path(&prefix);
            }
            Ok(())
        })();

        let success = result.is_ok();
        let error = result.err().map(|e| e.to_string());
        let _ = app.emit(
            "install:done",
            serde_json::json!({ "success": success, "error": error }),
        );
    });
}

#[tauri::command]
fn launch_backend(app: AppHandle, state: State<DesktopState>, cwd: String) {
    let workspace = PathBuf::from(&cwd);
    if !workspace.is_dir() {
        let _ = app.emit("cli:error", format!("not a directory: {cwd}"));
        return;
    }
    let state = state.inner().clone();
    thread::spawn(move || {
        if let Err(err) = spawn_instance(&app, &state, &workspace) {
            let _ = app.emit("cli:error", err);
        }
    });
}

/// Open a native folder picker and start (or switch to) that workspace.
#[tauri::command]
fn pick_workspace(app: AppHandle, state: State<DesktopState>) {
    let state = state.inner().clone();
    let initial = load_last_workspace().or_else(home_dir);
    let mut dialog = app.dialog().file();
    if let Some(dir) = initial {
        dialog = dialog.set_directory(dir);
    }
    dialog.pick_folder(move |folder| {
        let Some(folder) = folder else {
            log_line("pick_workspace: dialog cancelled");
            return;
        };
        let Ok(path) = folder.into_path() else {
            log_line("pick_workspace: bad path");
            return;
        };
        if !path.is_dir() {
            log_line(&format!("pick_workspace: not a directory: {}", path.display()));
            return;
        }
        log_line(&format!("pick_workspace: picked {}", path.display()));
        match spawn_instance(&app, &state, &path) {
            Ok(id) => log_line(&format!("spawn_instance ok id={id} path={}", path.display())),
            Err(err) => {
                log_line(&format!("spawn_instance error: {err}"));
                let _ = app.emit("cli:error", err);
            }
        }
    });
}

/// Switch to (or start) a workspace by explicit path.
#[tauri::command]
fn switch_workspace(app: AppHandle, state: State<DesktopState>, path: String) -> Result<(), String> {
    let workspace = PathBuf::from(&path);
    if !workspace.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    spawn_instance(&app, state.inner(), &workspace).map(|_| ())
}

#[derive(Serialize)]
struct WorkspaceInfo {
    id: u64,
    path: String,
    ready: bool,
    /// Dashboard URL once the instance is ready (container.html loads this
    /// into its per-workspace iframe).
    url: Option<String>,
}

#[tauri::command]
fn list_workspaces(state: State<DesktopState>) -> Vec<WorkspaceInfo> {
    state
        .instances
        .lock()
        .iter()
        .map(|i| WorkspaceInfo {
            id: i.id,
            path: i.workspace.to_string_lossy().into_owned(),
            ready: i.url.is_some(),
            url: i.url.clone(),
        })
        .collect()
}

/// Last workspace the user picked — offered as a shortcut on the splash screen.
#[tauri::command]
fn last_workspace() -> Option<String> {
    load_last_workspace().map(|p| p.to_string_lossy().into_owned())
}

// ── Desktop shell lifecycle: detect CLI → install → start TUI → load dashboard ──

/// One workspace = one background CLI process = one dashboard URL.
struct Instance {
    id: u64,
    workspace: PathBuf,
    child: Child,
    url: Option<String>,
}

#[derive(Clone, Default)]
struct DesktopState {
    instances: Arc<Mutex<Vec<Instance>>>,
    /// Instance currently shown in the webview.
    current: Arc<Mutex<Option<u64>>>,
}

static NEXT_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);

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
        // npm creates `.cmd` / `.ps1` / extensionless shims on Windows — never an .exe.
        &["reasonix-code.cmd"]
    } else {
        &["reasonix-code"]
    }
}

fn resolve_cli() -> Option<PathBuf> {
    // 0. Allow developers to override the CLI path for debugging.
    if let Some(override_path) = std::env::var("REASONIX_CLI").ok().filter(|s| !s.is_empty()) {
        let p = PathBuf::from(override_path);
        if p.is_file() {
            return Some(p);
        }
        eprintln!("[reasonix] REASONIX_CLI is set but file does not exist: {}", p.display());
    }

    // 1. Known install location used by the desktop installer. Checked before
    //    PATH because an Explorer that predates the HKCU PATH write won't have
    //    the prefix in its environment yet.
    if let Some(home) = home_dir() {
        let install_dir = home.join(".reasonix-code").join("npm-global");
        for name in cli_names() {
            let p = install_dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
        #[cfg(not(windows))]
        {
            let bin_dir = install_dir.join("bin");
            for name in cli_names() {
                let p = bin_dir.join(name);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }

    // 2. PATH resolution — `where` (Windows, respects PATHEXT) / `which`.
    let probe = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = Command::new(probe);
    cmd.arg("reasonix-code");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    if let Ok(out) = cmd.output() {
        if out.status.success() {
            if let Some(first) = String::from_utf8_lossy(&out.stdout).lines().next() {
                let p = PathBuf::from(first.trim());
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// Build a Command for the resolved CLI. On Windows a `.cmd` shim cannot be
/// executed directly by CreateProcess — run it through cmd.exe, the same way
/// `npm_install_cmd` and `open_in_editor` already do.
fn cli_command(cli: &Path) -> Command {
    #[cfg(windows)]
    {
        let is_cmd = cli
            .extension()
            .map(|e| e.eq_ignore_ascii_case("cmd"))
            .unwrap_or(false);
        if is_cmd {
            let mut c = Command::new("cmd");
            c.arg("/c").arg(cli);
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            c.creation_flags(CREATE_NO_WINDOW);
            return c;
        }
    }
    Command::new(cli)
}

fn desktop_config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".reasonix-code").join("desktop.json"))
}

fn load_last_workspace() -> Option<PathBuf> {
    let path = desktop_config_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
    let ws = v.get("last_workspace")?.as_str()?;
    let p = PathBuf::from(ws);
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

fn save_last_workspace(workspace: &Path) {
    let Some(path) = desktop_config_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let v = serde_json::json!({ "last_workspace": workspace.to_string_lossy() });
    let _ = std::fs::write(path, v.to_string());
}

/// Extract the data of the `Path` value from `reg query` output.
#[cfg(windows)]
fn parse_reg_path_value(output: &str) -> String {
    for line in output.lines() {
        let t = line.trim();
        if !t.to_lowercase().starts_with("path") {
            continue;
        }
        for ty in ["REG_EXPAND_SZ", "REG_SZ"] {
            if let Some(idx) = t.find(ty) {
                return t[idx + ty.len()..].trim().to_string();
            }
        }
    }
    String::new()
}

/// Persist the npm prefix to the user-level PATH (HKCU\Environment) so
/// `reasonix-code` works in new terminals. Uses `reg` instead of `setx`
/// (which truncates at 1024 chars); HKCU needs no admin rights.
#[cfg(windows)]
fn persist_prefix_to_user_path(prefix: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let prefix_str = prefix.to_string_lossy();
    let current = Command::new("reg")
        .args(["query", r"HKCU\Environment", "/v", "Path"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| parse_reg_path_value(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default();

    let present = current
        .split(';')
        .any(|p| p.trim().eq_ignore_ascii_case(&prefix_str));
    if present {
        return;
    }

    let merged = if current.trim().is_empty() {
        prefix_str.to_string()
    } else {
        format!("{};{}", current.trim_end_matches(';'), prefix_str)
    };
    let _ = Command::new("reg")
        .args([
            "add",
            r"HKCU\Environment",
            "/v",
            "Path",
            "/t",
            "REG_EXPAND_SZ",
            "/d",
            &merged,
            "/f",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// True for the ink-rendered `/dashboard  →  http://…` success line. We do NOT
/// parse the URL out of this line: ink wraps piped stdout to 80 columns, which
/// truncates the 64-hex token. The line is only a "server is up and config is
/// persisted" signal — the authoritative URL is read from config afterwards.
/// Requiring '→' excludes the auto-start-failure hint, which also mentions
/// "/dashboard" but carries no arrow.
fn is_dashboard_ready_line(line: &str) -> bool {
    line.contains("/dashboard") && line.contains('→')
}

/// Read the dashboard connection parts (host, port, token) from the CLI's
/// persisted config (~/.reasonix/config.json → dashboard.{host,port,token}).
/// The CLI persists the actual bound port (saveDashboardPort) and the auth
/// token before it prints the /dashboard line, so once that line appears the
/// config holds the correct, complete values.
fn dashboard_config_from_text(text: &str) -> Option<(String, u64, String)> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let dash = v.get("dashboard")?;
    let token = dash.get("token")?.as_str()?.trim();
    if token.len() < 16 {
        return None;
    }
    let port = dash.get("port")?.as_u64()?;
    if !(1..=65535).contains(&port) {
        return None;
    }
    let host = dash
        .get("host")
        .and_then(|h| h.as_str())
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .unwrap_or("127.0.0.1")
        .to_string();
    Some((host, port, token.to_string()))
}

/// Base dashboard URL (no session) — pure, used by tests.
#[cfg(test)]
fn dashboard_url_from_config_text(text: &str) -> Option<String> {
    let (host, port, token) = dashboard_config_from_text(text)?;
    Some(format!("http://{host}:{port}/?token={token}"))
}

/// Build the full dashboard URL the webview navigates to: the config's
/// host/port/token plus the instance's current session as `&session=`. The
/// dashboard only renders conversation history when told which session to show
/// (the TUI appends it in getDashboardUrl); without it the history panel stays
/// empty and the already-active session can't be re-clicked to load.
fn dashboard_url_from_config() -> Option<String> {
    let path = home_dir()?.join(".reasonix").join("config.json");
    let text = std::fs::read_to_string(path).ok()?;
    let (host, port, token) = dashboard_config_from_text(&text)?;
    let mut url = format!("http://{host}:{port}/?token={token}");
    if let Some(session) = fetch_current_session(&host, port, &token) {
        url.push_str("&session=");
        url.push_str(&url_encode(&session));
    }
    Some(url)
}

/// Best-effort fetch of the instance's current session name from its dashboard
/// server (`/api/overview`). Any failure yields None → a session-less URL.
fn fetch_current_session(host: &str, port: u64, token: &str) -> Option<String> {
    let url = format!("http://{host}:{port}/api/overview?token={token}");
    let mut cmd = Command::new("curl");
    cmd.args(["-sS", "--max-time", "5", &url]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let body = String::from_utf8(out.stdout).ok()?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    let session = v.get("session")?.as_str()?.trim();
    if session.is_empty() {
        None
    } else {
        Some(session.to_string())
    }
}

/// Percent-encode a query value — session names may contain '/' and other
/// reserved chars. Leaves unreserved [A-Za-z0-9-_.~] untouched.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_url_from_config() {
        let text = r#"{"dashboard":{"port":51300,"token":"568c149c7a3711a9b44ced658dcac6e263e16a25eb0cbffa457046eeb3ca7cea"}}"#;
        assert_eq!(
            dashboard_url_from_config_text(text).as_deref(),
            Some("http://127.0.0.1:51300/?token=568c149c7a3711a9b44ced658dcac6e263e16a25eb0cbffa457046eeb3ca7cea")
        );
    }

    #[test]
    fn respects_host_and_rejects_bad_values() {
        // Explicit host is honored.
        let text = r#"{"dashboard":{"host":"0.0.0.0","port":1420,"token":"0123456789abcdef"}}"#;
        assert_eq!(
            dashboard_url_from_config_text(text).as_deref(),
            Some("http://0.0.0.0:1420/?token=0123456789abcdef")
        );
        // Token below the CLI's 16-char floor → rejected.
        assert_eq!(
            dashboard_url_from_config_text(r#"{"dashboard":{"port":1,"token":"short"}}"#),
            None
        );
        // Out-of-range port → rejected.
        assert_eq!(
            dashboard_url_from_config_text(r#"{"dashboard":{"port":70000,"token":"0123456789abcdef"}}"#),
            None
        );
        // Missing dashboard section → rejected.
        assert_eq!(dashboard_url_from_config_text(r#"{"lang":"EN"}"#), None);
    }

    #[test]
    fn detects_ready_line_but_not_failure_hint() {
        // Success line (the token may be mid-wrap — we never read it here).
        assert!(is_dashboard_ready_line(
            "  ▸ /dashboard  →  http://127.0.0.1:51300/?token=568c149c"
        ));
        // Auto-start failure hint mentions /dashboard but has no arrow.
        assert!(!is_dashboard_ready_line(
            "▲ dashboard auto-start failed (boom) — try /dashboard or pass --no-dashboard"
        ));
        assert!(!is_dashboard_ready_line("reasonix-code code: rooted at D:\\x"));
    }

    #[test]
    fn url_encode_leaves_unreserved_and_encodes_rest() {
        assert_eq!(url_encode("plain-name_1.2~"), "plain-name_1.2~");
        // Session names carry a '/' (e.g. "<sanitized-cwd>/active") → encoded.
        assert_eq!(url_encode("a/b c"), "a%2Fb%20c");
    }
}

/// Record the dashboard URL for an instance, make it current, and notify the
/// container page (which hosts one iframe per workspace).
fn register_dashboard_url(
    app: &AppHandle,
    instances: &Arc<Mutex<Vec<Instance>>>,
    current: &Arc<Mutex<Option<u64>>>,
    id: u64,
    url: String,
) {
    log_line(&format!("register_dashboard_url id={id} url={url}"));
    let path = {
        let mut guard = instances.lock();
        if let Some(inst) = guard.iter_mut().find(|i| i.id == id) {
            inst.url = Some(url.clone());
            inst.workspace.to_string_lossy().into_owned()
        } else {
            String::new()
        }
    };
    *current.lock() = Some(id);
    // Emit the JSON object directly — passing a serialized String would be
    // double-encoded (listeners would see Value::String, not an object).
    let _ = app.emit(
        "cli:url",
        serde_json::json!({ "id": id, "url": url, "path": path }),
    );
    // Notify the frontend that a new workspace tab is ready.
    let _ = app.emit(
        "workspace-opened",
        serde_json::json!({ "id": id, "url": url, "path": path }),
    );
}

/// Start a new workspace instance, or just navigate to it if already running.
/// One workspace = one background `cmd /c reasonix-code code <cwd>` process =
/// one dashboard URL. The container page (container.html) hosts one iframe per
/// instance and switches by show/hide — the webview itself never navigates.
fn spawn_instance(app: &AppHandle, state: &DesktopState, workspace: &Path) -> Result<u64, String> {
    // Already running? Reuse the instance; the container just activates the
    // existing iframe (no navigation, no second process). The container may
    // have hidden this tab (process kept alive for hot reopen) — tell it to
    // show the iframe again.
    //
    // Robustness: only reuse a *healthy* instance. A CLI killed externally
    // (task manager, crash) may still sit in the table for up to 10 s until
    // the exit watcher reaps it — reusing it would resurrect a dead tab. If
    // the process has actually exited, drop it and fall through to a fresh
    // spawn below.
    {
        let mut instances = state.instances.lock();
        if let Some(existing) = instances.iter_mut().find(|i| i.workspace == workspace) {
            let dead = match existing.child.try_wait() {
                Ok(Some(_)) => true,
                _ => false,
            };
            if dead {
                let dead_id = existing.id;
                instances.retain(|i| i.id != dead_id);
                eprintln!("[reasonix] workspace {} exited — respawning", dead_id);
                // fall through to the fresh-spawn path
            } else {
                let id = existing.id;
                let url = existing.url.clone();
                let path = existing.workspace.to_string_lossy().into_owned();
                drop(instances);
                *state.current.lock() = Some(id);
                if let Some(url) = url {
                    let _ = app.emit(
                        "workspace-opened",
                        serde_json::json!({ "id": id, "url": url, "path": path }),
                    );
                }
                return Ok(id);
            }
        }
    }

    // A fresh CLI cannot boot without an API key (DeepSeekClient throws at
    // construction). The container intercepts this error and shows the
    // inline key setup, then retries the spawn automatically.
    if !config_has_api_key() {
        return Err(format!("NO_API_KEY:{}", workspace.to_string_lossy()));
    }

    if let Some(prefix) = reasonix_npm_prefix() {
        add_prefix_bin_to_path(&prefix);
    }
    let cli = resolve_cli().ok_or("reasonix-code CLI not found.")?;
    let mut cmd = cli_command(&cli);
    cmd.arg("code").arg(workspace);
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
    // Bind the process tree to the kill-on-close job so the OS reaps
    // everything when this shell dies (normal exit, kill, or crash).
    #[cfg(windows)]
    {
        if let Some(Some(job)) = KILL_JOB.get() {
            job::assign(job, &child);
        }
    }
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    let id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::SeqCst);
    state.instances.lock().push(Instance {
        id,
        workspace: workspace.to_path_buf(),
        child,
        url: None,
    });
    *state.current.lock() = Some(id);
    save_last_workspace(workspace);

    // The ink TUI prints a `/dashboard  →  URL` line to STDOUT once the server
    // is up — but piped output wraps to 80 columns and truncates the token, so
    // we treat that line only as a readiness signal and read the authoritative
    // URL from the CLI's config. Watch both streams — first hit wins.
    let found_url = Arc::new(AtomicBool::new(false));

    // stdout: drain (so the child never blocks) and watch for the ready line.
    let app_out = app.clone();
    let instances_out = state.instances.clone();
    let current_out = state.current.clone();
    let found_out = found_url.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if found_out.load(Ordering::SeqCst) {
                continue;
            }
            if is_dashboard_ready_line(&line) {
                if let Some(url) = dashboard_url_from_config() {
                    if found_out
                        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok()
                    {
                        register_dashboard_url(&app_out, &instances_out, &current_out, id, url);
                    }
                }
            }
        }
    });

    // stderr: forward lines to the splash UI, and watch the exit of the process.
    let app_stderr = app.clone();
    let instances_ref = state.instances.clone();
    let current_ref = state.current.clone();
    let found_stderr = found_url.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_stderr.emit("cli:stderr", line.clone());
            if !found_stderr.load(Ordering::SeqCst) {
                if is_dashboard_ready_line(&line) {
                    if let Some(url) = dashboard_url_from_config() {
                        if found_stderr
                            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                            .is_ok()
                        {
                            register_dashboard_url(&app_stderr, &instances_ref, &current_ref, id, url);
                        }
                    }
                }
            }
        }

        // Stderr closed — the process is gone or about to be. Reap it, drop the
        // instance from the table, and fall back to the splash if it was the
        // one on screen.
        let app_exit = app_stderr.clone();
        let found_exit = found_stderr.clone();
        let instances_exit = instances_ref.clone();
        let current_exit = current_ref.clone();
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let removed = {
                    let mut instances = instances_exit.lock();
                    match instances.iter().position(|i| i.id == id) {
                        Some(pos) => match instances[pos].child.try_wait() {
                            Ok(Some(_)) | Err(_) => {
                                instances.remove(pos);
                                true
                            }
                            Ok(None) => false,
                        },
                        None => true,
                    }
                };
                if removed {
                    break;
                }
                if Instant::now() >= deadline {
                    instances_exit.lock().retain(|i| i.id != id);
                    break;
                }
                thread::sleep(Duration::from_millis(250));
            }
            let _ = app_exit.emit("cli:exit", serde_json::json!({ "id": id }));
            // The container page removes the iframe when the workspace dies.
            let _ = app_exit.emit("workspace-closed", serde_json::json!({ "id": id }));
            log_line(&format!("workspace exited id={id}"));
            // Detect a crash: the process exited while it was the active
            // workspace and never produced a ready dashboard URL. Surface a
            // toast so the user knows what happened — previously a hung child
            // disappeared silently after 10s.
            let was_current = {
                let mut cur = current_exit.lock();
                if *cur == Some(id) {
                    *cur = None;
                    true
                } else {
                    false
                }
            };
            if was_current {
                // The container page owns the workspace UI now — it watches
                // cli:exit / workspace-closed and removes the iframe. The
                // webview itself never navigates back to the splash.
                // `found_url` is set by the stdout/stderr watcher when the
                // dashboard URL was successfully registered. If the CLI exits
                // before that, it's a crash.
                let was_ready = found_exit.load(Ordering::SeqCst);
                if !was_ready {
                    let _ = app_exit.emit(
                        "cli:crash",
                        serde_json::json!({ "id": id, "reason": "CLI exited before dashboard was ready" }),
                    );
                }
            }
        });
    });

    // Watchdog: if the dashboard URL never registers (CLI stalls before the
    // ready line — occasionally seen when several workspaces spawn at once),
    // kill the stalled process, drop the instance, log the stdout trace and
    // automatically retry once. The user never has to act.
    {
        let app_tmo = app.clone();
        let state_tmo = state.clone();
        let found_tmo = found_url.clone();
        let tmo_id = id;
        let tmo_path = workspace.to_string_lossy().into_owned();
        thread::spawn(move || {
            for _ in 0..60 {
                if found_tmo.load(Ordering::SeqCst) {
                    return;
                }
                thread::sleep(Duration::from_millis(500));
            }
            if found_tmo.load(Ordering::SeqCst) {
                return;
            }
            log_line(&format!("dashboard url timeout id={tmo_id} path={tmo_path}"));
            // Reap the stalled process + instance.
            {
                let mut instances = state_tmo.instances.lock();
                if let Some(idx) = instances.iter().position(|i| i.id == tmo_id) {
                    let mut inst = instances.remove(idx);
                    kill_process_tree(inst.child.id());
                    let _ = inst.child.kill();
                }
            }
            // Retry once after a short pause.
            let app_r = app_tmo.clone();
            let state_r = state_tmo.clone();
            let path_r = tmo_path.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(2));
                match spawn_instance(&app_r, &state_r, Path::new(&path_r)) {
                    Ok(new_id) => log_line(&format!("retry spawn ok id={new_id} path={path_r}")),
                    Err(e) => {
                        log_line(&format!("retry spawn failed path={path_r} err={e}"));
                        let _ = app_r.emit(
                            "cli:error",
                            format!("工作区启动失败：{path_r}（{e}）"),
                        );
                    }
                }
            });
        });
    }

    Ok(id)
}

/// Close a workspace instance by id: kill its process tree.
#[tauri::command]
fn workspace_close(app: AppHandle, state: State<DesktopState>, id: u64) -> Result<(), String> {
    let pid = {
        let mut instances = state.instances.lock();
        let pos = instances.iter().position(|i| i.id == id);
        match pos {
            Some(pos) => {
                let pid = instances[pos].child.id();
                instances.remove(pos);
                pid
            }
            None => return Err(format!("instance {id} not found")),
        }
    };
    kill_process_tree(pid);
    let _ = app.emit("workspace-closed", serde_json::json!({ "id": id }));
    Ok(())
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

/// Windows Job Object with KILL_ON_JOB_CLOSE: the OS terminates every
/// process assigned to the job (and their descendants) when the handle is
/// closed — i.e. whenever this shell process dies, whether via normal exit,
/// a task-manager kill, or a crash. This makes the per-workspace CLI
/// processes true children of the shell at the OS level.
#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct KillOnCloseJob(HANDLE);

    // The handle is a plain OS value; sharing it across threads is safe
    // (all uses are AssignProcessToJobObject on the same process).
    unsafe impl Sync for KillOnCloseJob {}
    unsafe impl Send for KillOnCloseJob {}

    pub fn create() -> Option<KillOnCloseJob> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle == 0 {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(handle);
                return None;
            }
            Some(KillOnCloseJob(handle))
        }
    }

    /// Assign a spawned child (and implicitly its descendants) to the job.
    /// Failure is non-fatal — the ExitRequested taskkill path still runs.
    pub fn assign(job: &KillOnCloseJob, child: &std::process::Child) -> bool {
        let handle = child.as_raw_handle() as HANDLE;
        unsafe { AssignProcessToJobObject(job.0, handle) != 0 }
    }
}

#[cfg(windows)]
static KILL_JOB: std::sync::OnceLock<Option<job::KillOnCloseJob>> = std::sync::OnceLock::new();

fn main() {
    #[cfg(windows)]
    {
        let _ = KILL_JOB.set(job::create());
    }
    #[cfg(target_os = "linux")]
    linux_webkit_compat();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        // Exclude DECORATIONS from the persisted/restored window state: a stale
        // `decorated:false` (saved by an older frameless build) would otherwise
        // override tauri.conf.json's `decorations:true` and hide the native
        // title bar. Decorations are governed solely by the config.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .on_page_load(console_forwarding_hook())
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            open_in_editor,
            list_workspace_tree,
            git_status,
            write_text_file,
            check_environment,
            latest_cli_version,
            desktop_build,
            set_window_title,
            log_console,
            workspace_alive,
            install_cli,
            install_node,
            has_api_key,
            save_api_key,
            launch_backend,
            pick_workspace,
            switch_workspace,
            list_workspaces,
            last_workspace,
            workspace_close
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

            // Note: no cli:url navigation anymore — container.html hosts one
            // iframe per workspace and switches by show/hide. The cli:url
            // event itself is emitted by register_dashboard_url and consumed
            // by the container page.

            // Startup CLI update check (native dialog, shell-owned — does
            // not depend on the dashboard bundle).
            prompt_cli_update(app.handle().clone());


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

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("tauri build failed")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Kill every cmd/CLI process tree this app started.
                // taskkill /T must run BEFORE Child::kill: once the parent is
                // dead its children are orphaned and /T can no longer find them.
                let state = app.state::<DesktopState>();
                let mut instances = state.instances.lock();
                for inst in instances.iter_mut() {
                    let pid = inst.child.id();
                    kill_process_tree(pid);
                    let _ = inst.child.kill();
                }
                instances.clear();
            }
        });
}
