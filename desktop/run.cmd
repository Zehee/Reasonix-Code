@echo off
cd /d "%~dp0"

:: Dynamically locate Visual Studio via vswhere instead of hardcoding
:: VCToolsVersion. This works with VS 2022 / 2019 / BuildTools regardless
:: of exact update version.
set "VSDIR="
for /f "usebackq delims=" %%i in (`where vswhere 2^>nul`) do (
    for /f "usebackq tokens=*" %%p in (`"%%i" -latest -property installationPath`) do set "VSDIR=%%p"
)
if not defined VSDIR (
    for /f "usebackq tokens=*" %%p in (
        `^""%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -property installationPath^"`
    ) do set "VSDIR=%%p"
)

if defined VSDIR (
    :: Use VsDevCmd to set up the full toolchain environment
    if exist "%VSDIR%\Common7\Tools\VsDevCmd.bat" (
        call "%VSDIR%\Common7\Tools\VsDevCmd.bat" -no_logo
        goto :run
    )
)

:: Fallback: hardcoded VS 2022 BuildTools path (last known working version)
set "MSVC_BIN=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64"
set "SDK_BIN=C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64"
if exist "%MSVC_BIN%" (
    set "PATH=%MSVC_BIN%;%SDK_BIN%;%PATH%"
)

:run
cd /d "%~dp0"
if "%1"=="" (
    npx tauri dev
) else (
    npx %1
)
