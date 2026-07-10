; Post-install hook: ensure the reasonix-code CLI is installed.
; The desktop installer itself only ships the Tauri shell. If the CLI is
; missing and Node.js/npm are available, install it via npm silently.
; Otherwise the desktop shell will prompt the user on first launch.

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
    DetailPrint "The desktop app will prompt you to upgrade if needed."
    Goto done

  check_npm:
    nsExec::ExecToStack 'cmd /c node --version && npm --version'
    Pop $0
    Pop $1
    IntCmp $0 0 npm_ok
      DetailPrint "Node.js / npm not found, skipping CLI auto-install."
      DetailPrint "The desktop app will prompt you to install them on first launch."
      Goto done

  npm_ok:
    DetailPrint "Installing reasonix-code via npm..."
    nsExec::ExecToStack 'cmd /c npm install -g --prefix "$PROFILE\.reasonix-code\npm-global" reasonix-code'
    Pop $0
    Pop $1
    IntCmp $0 0 done
      DetailPrint "Warning: npm install failed (exit code $0)."
      DetailPrint "The desktop app will prompt you to install it on first launch."

  done:
!macroend
