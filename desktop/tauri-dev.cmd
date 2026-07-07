@echo off
cd /d "%~dp0"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" -vcvars_ver=14.44.35207
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
call npm run tauri dev
