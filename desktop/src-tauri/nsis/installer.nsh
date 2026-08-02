; Post-install hook: ensure the reasonix-code CLI is installed.
; The desktop installer itself only ships the Tauri shell.
; - CLI already present -> leave it alone; the shell checks for updates
;   (npm latest) on every startup via a native dialog.
; - CLI missing + npm available -> install the CLI via npm silently.
; - CLI missing + npm missing -> install Node.js (LTS) via winget, then
;   install the CLI; if winget is unavailable the shell prompts on first
;   launch. This only touches fresh machines (no existing Node to break).

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Checking reasonix-code CLI..."
  nsExec::ExecToStack 'cmd /c reasonix-code --version'
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
    nsExec::ExecToStack 'cmd /c node --version && npm --version'
    Pop $0
    Pop $1
    IntCmp $0 0 npm_ok
      DetailPrint "Node.js / npm not found, installing Node.js LTS via winget..."
      nsExec::ExecToStack 'cmd /c winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements'
      Pop $0
      Pop $1
      IntCmp $0 0 node_installed
        DetailPrint "Warning: automatic Node.js install failed (exit code $0)."
        DetailPrint "The desktop app will prompt you to install it on first launch."
        Goto done
      node_installed:
        StrCpy $InstalledNodeByUs 1

  npm_ok:
    DetailPrint "Installing reasonix-code via npm..."
    ; npm may have just been installed by winget — the current process's
    ; PATH is stale, so try the canonical install location first and fall
    ; back to PATH.
    nsExec::ExecToStack 'cmd /c if exist "$LOCALAPPDATA\Programs\nodejs\npm.cmd" ("$LOCALAPPDATA\Programs\nodejs\npm.cmd" install -g --prefix "$PROFILE\.reasonix-code\npm-global" reasonix-code) else (npm install -g --prefix "$PROFILE\.reasonix-code\npm-global" reasonix-code)'
    Pop $0
    Pop $1
    IntCmp $0 0 done
      DetailPrint "Warning: npm install failed (exit code $0)."
      DetailPrint "The desktop app will prompt you to install it on first launch."

  done:
!macroend
