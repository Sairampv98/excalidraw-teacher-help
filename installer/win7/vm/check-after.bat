@echo off
rem AC-572: the proof on a clean Windows 7 Service Pack 1 machine.
rem What is left on the machine after the Windows 7 setup's uninstall.
rem   check-after.bat [install folder]
set D=%~1
if "%D%"=="" set D=%LOCALAPPDATA%\Programs\ExcalidrawClassroom
echo --- the install folder
if exist "%D%" (echo STILL THERE: & dir /s /b "%D%") else echo gone
echo --- the compiler's own folder
if exist "%SystemDrive%\ClassroomTools" (echo STILL THERE) else echo gone
echo --- VSCodium
if exist "%LOCALAPPDATA%\Programs\VSCodium" (echo STILL THERE) else if exist "%ProgramFiles(x86)%\VSCodium" (echo STILL THERE) else echo gone
echo --- the user's PATH and JAVA_HOME
reg query HKCU\Environment /v Path 2>nul
reg query HKCU\Environment /v JAVA_HOME 2>nul
echo --- the entry in the uninstall list
reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ExcalidrawClassroom 2>nul || echo gone
echo --- the desktop and the Start menu
dir /b "%USERPROFILE%\Desktop" 2>nul
dir /b "%APPDATA%\Microsoft\Windows\Start Menu\Programs" 2>nul
