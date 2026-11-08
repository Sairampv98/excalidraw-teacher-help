@echo off
rem Reports what this computer is, and whether the bundled browser starts on it.
rem Needs nothing installed. The report is written to diagnose-report.txt next to this file.
setlocal enableextensions
set "HERE=%~dp0"
set "OUT=%HERE%diagnose-report.txt"

echo Checking this computer (about 30 seconds)...
> "%OUT%" echo ===== Whiteboard pack - diagnose report =====
>> "%OUT%" echo Date: %DATE% %TIME%
>> "%OUT%" echo.
>> "%OUT%" echo ----- Windows -----
>> "%OUT%" ver
wmic os get Caption,Version,ServicePackMajorVersion,OSArchitecture /value 2>nul | find "=" >> "%OUT%"
>> "%OUT%" echo PROCESSOR_ARCHITECTURE=%PROCESSOR_ARCHITECTURE%  PROCESSOR_ARCHITEW6432=%PROCESSOR_ARCHITEW6432%
>> "%OUT%" echo.
>> "%OUT%" echo ----- Memory and screen -----
wmic computersystem get TotalPhysicalMemory /value 2>nul | find "=" >> "%OUT%"
wmic path Win32_VideoController get Name,CurrentHorizontalResolution,CurrentVerticalResolution /value 2>nul | find "=" >> "%OUT%"
>> "%OUT%" echo.
>> "%OUT%" echo ----- Updates that matter (empty = not installed) -----
>> "%OUT%" echo KB2999226 (Universal C Runtime):
wmic qfe where "HotFixID='KB2999226'" get HotFixID /value 2>nul | find "=" >> "%OUT%"
>> "%OUT%" echo Service Pack 1 (ServicePackMajorVersion above must be 1; no KB number is listed for it):

>> "%OUT%" echo.
>> "%OUT%" echo ----- PowerShell and .NET -----
powershell -NoProfile -ExecutionPolicy Bypass -Command "$PSVersionTable.PSVersion.ToString()" >> "%OUT%" 2>&1
>> "%OUT%" reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP" /s /v Version 2>nul
>> "%OUT%" echo.
>> "%OUT%" echo ----- Browsers on this computer -----
for %%B in (chrome.exe firefox.exe msedge.exe iexplore.exe) do (
  >> "%OUT%" echo %%B:
  >> "%OUT%" reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%%B" /ve 2>nul
  >> "%OUT%" reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%%B" /ve 2>nul
)
>> "%OUT%" echo.
>> "%OUT%" echo ----- Does the bundled Chromium start here? -----
set "CHROME=%HERE%tools\chromium-109-x86\chrome-win\chrome.exe"
if not exist "%CHROME%" (
  >> "%OUT%" echo The bundled Chromium is not in this pack.
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
   "$p = New-Object System.Diagnostics.ProcessStartInfo; $p.FileName = '%CHROME%'; $p.Arguments = '--headless --disable-gpu --no-first-run --user-data-dir=\"%TEMP%\diag-chromium\" --dump-dom about:blank'; $p.UseShellExecute = $false; $p.RedirectStandardOutput = $true; $p.CreateNoWindow = $true; try { $q = [Diagnostics.Process]::Start($p); if ($q.WaitForExit(20000)) { $o = $q.StandardOutput.ReadToEnd(); if ($o -match '<html') { 'Chromium started and answered: OK' } else { 'Chromium ended with code ' + $q.ExitCode + ' and no page' } } else { $q.Kill(); 'Chromium did not answer in 20 seconds (it may be showing an error window)' } } catch { 'Chromium could not be started: ' + $_.Exception.Message }" >> "%OUT%" 2>&1
)
>> "%OUT%" echo.
>> "%OUT%" echo ----- Is port 8123 free? -----
netstat -ano | findstr ":8123" >> "%OUT%"
>> "%OUT%" echo (nothing above = free)
>> "%OUT%" echo.
>> "%OUT%" echo ===== end =====

type "%OUT%"
echo.
echo This report is saved as: %OUT%
pause
