; Post-install hook: ensure the reasonix-code CLI is installed.
; The desktop installer itself only ships the Tauri shell.
; - CLI already present -> leave it alone; the shell checks for updates
;   (npm latest) on every startup via a native dialog.
; - CLI missing + npm available -> install the CLI via npm silently.
; - CLI missing + npm missing -> install Node.js (LTS) via winget, add it
;   to the user PATH (registry + this process) so the finish page's
;   "Run app" works, then install the CLI via npm. If winget is
;   unavailable, or node.exe isn't at the canonical location, fall back
;   to hiding the checkbox ($InstalledNodeByUs -> MyFinishShow in
;   template.nsi) and letting the shell prompt on first launch.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Checking reasonix-code CLI..."
  nsExec::ExecToStack /TIMEOUT=10000 'cmd /c reasonix-code --version'
  Pop $0
  Pop $1

  IntCmp $0 0 cli_exists
    DetailPrint "reasonix-code not found, checking Node.js / npm..."
    Goto check_npm

  cli_exists:
    DetailPrint "reasonix-code already installed: $1"
    DetailPrint "The app will check for updates on startup."
    Goto done

  check_npm:
    nsExec::ExecToStack /TIMEOUT=10000 'cmd /c node --version && npm --version'
    Pop $0
    Pop $1
    IntCmp $0 0 npm_ok
      DetailPrint "Node.js / npm not found, installing Node.js LTS via winget..."
      nsExec::ExecToStack /TIMEOUT=300000 'cmd /c winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements'
      Pop $0
      Pop $1
      IntCmp $0 0 node_installed
        DetailPrint "Warning: automatic Node.js install failed (exit code $0)."
        DetailPrint "The desktop app will prompt you to install it on first launch."
        Goto done
      node_installed:
        ; Best effort: put Node's canonical install location on the user
        ; PATH (registry) AND refresh this process's environment so the
        ; finish page's "Run app" works right away (a child process
        ; inherits the installer's environment). If node.exe isn't at the
        ; canonical location (winget installed it elsewhere), fall back to
        ; hiding the checkbox — see MyFinishShow in template.nsi.
        ${If} ${FileExists} "$LOCALAPPDATA\Programs\nodejs\node.exe"
          ReadRegStr $2 HKCU "Environment" "Path"
          ${If} $2 == ""
            StrCpy $2 "$LOCALAPPDATA\Programs\nodejs"
          ${Else}
            StrCpy $2 "$2;$LOCALAPPDATA\Programs\nodejs"
          ${EndIf}
          WriteRegExpandStr HKCU "Environment" "Path" "$2"
          System::Call 'KERNEL32::SetEnvironmentVariable(t "Path", t r2)'
          SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment"
        ${Else}
          StrCpy $InstalledNodeByUs 1
        ${EndIf}
        Goto npm_ok

  npm_ok:
    DetailPrint "正在安装 reasonix-code 命令行版（首次安装可能需要几分钟，请耐心等待）..."
    ; npm may have just been installed by winget — the current process's
    ; PATH is stale, so try the canonical install location first and fall
    ; back to PATH. A 5-minute timeout keeps the installer from hanging
    ; forever on a stalled network.
    nsExec::ExecToStack /TIMEOUT=300000 'cmd /c if exist "$LOCALAPPDATA\Programs\nodejs\npm.cmd" ("$LOCALAPPDATA\Programs\nodejs\npm.cmd" install -g --prefix "$PROFILE\.reasonix-code\npm-global" reasonix-code) else (npm install -g --prefix "$PROFILE\.reasonix-code\npm-global" reasonix-code)'
    Pop $0
    Pop $1
    IntCmp $0 0 path_setup
      DetailPrint "npm 安装失败或超时（退出码 $0）。"
      DetailPrint "可稍后在终端手动执行：npm install -g --prefix ""$PROFILE\.reasonix-code\npm-global"" reasonix-code"
      DetailPrint "桌面版首次启动时也会提示安装命令行版。"
      Goto done
  path_setup:
    ; Make reasonix-code available in the user's terminals too: append the
    ; npm-global bin dir to the user PATH (registry + this process + notify).
    ReadRegStr $3 HKCU "Environment" "Path"
    ${If} $3 == ""
      StrCpy $3 "$PROFILE\.reasonix-code\npm-global"
    ${Else}
      StrCpy $3 "$3;$PROFILE\.reasonix-code\npm-global"
    ${EndIf}
    WriteRegExpandStr HKCU "Environment" "Path" "$3"
    System::Call 'KERNEL32::SetEnvironmentVariable(t "Path", t r3)'
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment"
    Goto done
  done:
!macroend
