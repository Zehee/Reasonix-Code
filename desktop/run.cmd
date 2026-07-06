@echo off
cd /d "%~dp0"
set VCToolsVersion=14.44.35207
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cd /d "%~dp0"
if "%1"=="" (
  npm run tauri dev
) else (
  npm run %1
)
