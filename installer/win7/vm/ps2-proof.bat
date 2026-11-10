@echo off
rem D-481: the proof on Windows 7 that the editor-window helpers run on PowerShell 2.0.
rem Run from the disc that holds the extension's media folder:  ps2-proof.bat
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ps2-proof.ps1"
