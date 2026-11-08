@echo off
rem Runs the Windows 7 setup silently from the disc it is on, and shows what it said:
rem   run-silent.bat [components]    (for example: editor,python)
set LOGFILE=%TEMP%\w7-setup.log
set COMPONENTS=%1
if "%COMPONENTS%"=="" (set ARGS=/silent /nodesktop /log=%LOGFILE%) else (set ARGS=/silent /nodesktop /components=%COMPONENTS% /log=%LOGFILE%)
start "" /wait "%~dp0ClassroomSetup-Win7.exe" %ARGS%
echo EXIT=%errorlevel%
type %LOGFILE%
