@echo off
rem Starts the whiteboard: a small server on this computer and a browser window with no tabs.
rem Everything is in this folder, and nothing is installed or changed on the computer.
rem   start.bat           the bundled Chromium 109, then Firefox if it is bundled, then a browser
rem                       that is already on the computer
rem   start.bat safe      the same with the graphics card switched off (use it if the window is
rem                       blank, or garbled)
setlocal enableextensions
set "HERE=%~dp0"
set "PORT=8123"
if defined DSA_PORT set "PORT=%DSA_PORT%"
set "URL=http://127.0.0.1:%PORT%/"
set "PROFILE=%HERE%data\profile"
set "SAFE="
if /i "%~1"=="safe" set "SAFE=--disable-gpu --disable-software-rasterizer"

if not exist "%HERE%app\index.html" (
  echo The folder "app" is missing next to this file. The pack is not complete.
  pause
  exit /b 1
)

rem 1. which browser
set "BROWSER="
set "KIND="
if exist "%HERE%tools\chromium-109-x86\chrome-win\chrome.exe" (
  set "BROWSER=%HERE%tools\chromium-109-x86\chrome-win\chrome.exe"
  set "KIND=chromium"
)
if not defined BROWSER if exist "%HERE%tools\firefox\firefox.exe" (
  set "BROWSER=%HERE%tools\firefox\firefox.exe"
  set "KIND=firefox"
)
if not defined BROWSER (
  for %%K in (HKLM HKCU) do (
    for /f "tokens=2,*" %%A in ('reg query "%%K\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do (
      if not defined BROWSER set "BROWSER=%%B" & set "KIND=chromium"
    )
  )
)
if not defined BROWSER (
  echo No browser was found. Open the folder "present-anywhere" instead: it holds the PDF
  echo handouts and the videos, which need only a PDF reader and a video player.
  pause
  exit /b 1
)

rem 2. the server, hidden
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%HERE%serve.ps1" -Port %PORT%

rem 3. wait until it answers (up to 30 seconds)
set /a TRIES=0
:wait
set /a TRIES+=1
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (New-Object Net.WebClient).DownloadString('%URL%__ping') | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto ready
if %TRIES% GEQ 30 (
  echo The server did not start. Read serve.log in this folder, and run diagnose.bat.
  pause
  exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto wait

:ready
rem keeps Chromium from showing "Google API keys are missing"
set "GOOGLE_API_KEY=no"
set "GOOGLE_DEFAULT_CLIENT_ID=no"
set "GOOGLE_DEFAULT_CLIENT_SECRET=no"
rem 4. the browser: its own profile in this folder, so the saved work stays with the pack
if not exist "%PROFILE%" mkdir "%PROFILE%"
if "%KIND%"=="chromium" (
  "%BROWSER%" --user-data-dir="%PROFILE%" --app=%URL% --no-first-run --no-default-browser-check --disable-features=Translate %SAFE%
) else (
  "%BROWSER%" -no-remote -profile "%PROFILE%" -new-window %URL%
)

rem 5. the window was closed: stop the server
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (New-Object Net.WebClient).DownloadString('%URL%__quit') | Out-Null } catch { }"
exit /b 0
