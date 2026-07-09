; Post-install hook: ensure the reasonix-code CLI is installed.
; The desktop installer itself only ships the Tauri shell. If Node.js and npm
; are available, install the CLI via npm silently in the background.
; Otherwise the desktop shell will prompt the user on first launch.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Checking Node.js / npm..."
  nsExec::ExecToStack 'cmd /c node --version && npm --version'
  Pop $0
  Pop $1

  IntCmp $0 0 npm_ok
    DetailPrint "Node.js / npm not found, skipping CLI auto-install."
    DetailPrint "The desktop app will prompt you to install them on first launch."
    Goto done

  npm_ok:
    DetailPrint "Installing reasonix-code via npm..."
    nsExec::ExecToStack 'cmd /c npm install -g reasonix-code'
    Pop $0
    Pop $1
    IntCmp $0 0 done
      DetailPrint "Warning: npm install failed (exit code $0)."
      DetailPrint "The desktop app will prompt you to install it on first launch."

  done:
!macroend
