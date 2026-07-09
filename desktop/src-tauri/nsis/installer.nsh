; Post-install hook: ensure the reasonix-code CLI is installed and up-to-date.
; The desktop installer itself only ships the Tauri shell; the CLI binary is
; downloaded on-demand by install.ps1 from GitHub Releases.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Checking Reasonix-Code CLI..."
  ; Run the GitHub-hosted install.ps1 silently in the background.
  ; The desktop shell will later verify the CLI and prompt the user if needed.
  ExecWait 'powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/Zehee/Reasonix-Code/main/install.ps1)"' $0
  IntCmp $0 0 +3
    DetailPrint "Warning: CLI installation may have failed (exit code $0)."
    DetailPrint "The desktop app will prompt you to install it on first launch."
!macroend
