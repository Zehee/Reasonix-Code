@echo off
set VCToolsVersion=
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
cd /d D:\workspace\Reasonix-Code\desktop
npm run tauri build
