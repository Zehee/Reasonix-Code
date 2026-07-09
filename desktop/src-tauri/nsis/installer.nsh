; Post-install hook: ensure the reasonix-code CLI is installed and up-to-date.
; The desktop installer itself only ships the Tauri shell; the CLI binary is
; downloaded on-demand by install.ps1 from GitHub Releases.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Checking Reasonix-Code CLI..."
  ; Run the GitHub-hosted install.ps1 in a visible PowerShell window so the
  ; user can see the version comparison prompt and the download progress bar.
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -Command "Invoke-RestMethod -Uri ''https://raw.githubusercontent.com/Zehee/Reasonix-Code/main/install.ps1'' | Invoke-Expression"'
!macroend
