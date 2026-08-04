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
  ; Allow cancel / close during install (the instfiles page disables its
  ; Cancel button by default; a stalled npm step shouldn't be unescapable).
  GetDlgItem $0 $HWNDPARENT 2
  EnableWindow $0 1

  DetailPrint "Checking reasonix-code CLI..."
  ; PATH lookup first, then the canonical npm-global shim -- a CLI installed
  ; there is valid even before it's on PATH, so we don't reinstall it.
  nsExec::ExecToStack /TIMEOUT=10000 'cmd /c reasonix-code --version'
  Pop $0
  Pop $1
  ${If} $0 == 0
    DetailPrint "reasonix-code already installed: $1"
    DetailPrint "The app will check for updates on startup."
    Goto done
  ${ElseIf} ${FileExists} "$PROFILE\.reasonix-code\npm-global\reasonix-code.cmd"
    DetailPrint "reasonix-code already installed (npm-global); adding to PATH."
    Goto path_setup
  ${Else}
    DetailPrint "reasonix-code not found, checking Node.js / npm..."
    Goto check_npm
  ${EndIf}

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
        ; hiding the checkbox -- see MyFinishShow in template.nsi.
        ${If} ${FileExists} "$LOCALAPPDATA\Programs\nodejs\node.exe"
          ReadRegStr $2 HKCU "Environment" "Path"
          StrCpy $5 "$LOCALAPPDATA\Programs\nodejs"
          ; Append only if not already on PATH (reinstalls must not duplicate).
          ${If} "$2" != "*$5*"
            ${If} $2 == ""
              StrCpy $2 "$5"
            ${Else}
              StrCpy $2 "$2;$5"
            ${EndIf}
            WriteRegExpandStr HKCU "Environment" "Path" "$2"
          ${EndIf}
          System::Call 'KERNEL32::SetEnvironmentVariable(t "Path", t r2)'
          ; Async notify — SendMessage(HWND_BROADCAST) blocks until EVERY
          ; top-level window answers; a hung window (explorer, FastGithub,
          ; another installer) stalls the installer. PostMessage returns
          ; immediately; explorer picks the change up on its own.
          System::Call 'user32::PostMessage(i ${HWND_BROADCAST}, i ${WM_SETTINGCHANGE}, i 0, t "Environment")'
        ${Else}
          StrCpy $InstalledNodeByUs 1
        ${EndIf}
        Goto npm_ok

  npm_ok:
    DetailPrint "Installing reasonix-code CLI (first install may take a few minutes)..."
    ; Prefer the canonical npm location (a just-installed Node may not be
    ; on this process's PATH yet); fall back to PATH. Keep the command
    ; simple -- no cmd if/else parenthesis nesting, which can stall.
    ${If} ${FileExists} "$LOCALAPPDATA\Programs\nodejs\npm.cmd"
      nsExec::ExecToStack /TIMEOUT=120000 'cmd /c ""$LOCALAPPDATA\Programs\nodejs\npm.cmd" install -g --prefix "$PROFILE\.reasonix-code\npm-global" reasonix-code"'
    ${Else}
      nsExec::ExecToStack /TIMEOUT=120000 'cmd /c npm install -g --prefix "$PROFILE\.reasonix-code\npm-global" reasonix-code'
    ${EndIf}
    Pop $0
    Pop $1
    IntCmp $0 0 path_setup
      DetailPrint "npm install failed or timed out (exit code $0)."
      DetailPrint "You can install it manually later: npm install -g --prefix $\"$PROFILE\.reasonix-code\npm-global$\" reasonix-code"
      DetailPrint "The desktop app will also offer to install the CLI on first launch."
      Goto done
  path_setup:
    ; Make reasonix-code available in the user's terminals too: append the
    ; npm-global bin dir to the user PATH (registry + this process + notify),
    ; but only if it isn't already there — reinstalls must not duplicate it.
    ReadRegStr $3 HKCU "Environment" "Path"
    StrCpy $4 "$PROFILE\.reasonix-code\npm-global"
    ${If} "$3" != "*$4*"
      ${If} $3 == ""
        StrCpy $3 "$4"
      ${Else}
        StrCpy $3 "$3;$4"
      ${EndIf}
      WriteRegExpandStr HKCU "Environment" "Path" "$3"
    ${EndIf}
    System::Call 'KERNEL32::SetEnvironmentVariable(t "Path", t r3)'
    ; Async notify — see path_setup above for why SendMessage is avoided.
    System::Call 'user32::PostMessage(i ${HWND_BROADCAST}, i ${WM_SETTINGCHANGE}, i 0, t "Environment")'
    Goto done
  done:
!macroend
