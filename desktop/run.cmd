@echo off
cd /d "%~dp0"
:: Add MSVC tools to PATH directly (vcvars version mismatch workaround)
set "MSVC_BIN=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64"
set "SDK_BIN=C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64"
set "PATH=%MSVC_BIN%;%SDK_BIN%;%PATH%"
cd /d "%~dp0"
if "%1"=="" (
  npx tauri dev
) else (
  npx %1
)
