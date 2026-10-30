@echo off
rem Brings the editor's window back to the main display when it is out of
rem reach: parked off every display, or on the virtual display (D-360).
rem Double-click this file. It needs neither the editor nor the whiteboard.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0rescue-editor-window.ps1" %*
echo.
pause
