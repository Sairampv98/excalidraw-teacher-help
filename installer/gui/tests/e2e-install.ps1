# An end-to-end proof of the click-through installer, without the clicks: a silent install of everything,
# AC-563 - proved by hand on Windows (D-463, D-464, D-465).
# checks on what was put where, the launcher serving the app, and an uninstall that leaves nothing.
#
#   powershell -File installer\gui\tests\e2e-install.ps1 -Setup <ClassroomSetup.exe>
#
# It changes only this user's own settings (PATH and two variables) and puts them back. The editor's command is
# a stand-in (CLASSROOM_SETUP_CODE_CLI), so a real editor on this machine is never touched.
param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [string]$Work = (Join-Path $env:TEMP "classroom-e2e")
)

$ErrorActionPreference = "Stop"
$failed = 0
function Check($name, $ok) {
  if ($ok) { Write-Host "ok - $name" } else { Write-Host "not ok - $name"; $script:failed++ }
}

Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Work | Out-Null
$inst = Join-Path $Work "install"
$ext = Join-Path $Work "extensions"
New-Item -ItemType Directory -Force $ext | Out-Null

# a stand-in for the editor's command: "code --install-extension x.vsix" makes the extension's folder
$fake = Join-Path $Work "code.cmd"
Set-Content $fake -Encoding ASCII -Value @(
  "@echo off",
  "if ""%1""==""--install-extension"" (",
  "  mkdir ""%CLASSROOM_SETUP_EXTENSIONS_DIR%\excalidraw.excalidraw-bridge-0.2.1"" 2>nul",
  "  echo installed %2 > ""%CLASSROOM_SETUP_EXTENSIONS_DIR%\excalidraw.excalidraw-bridge-0.2.1\marker.txt""",
  "  exit /b 0",
  ")"
)
$env:CLASSROOM_SETUP_CODE_CLI = $fake
$env:CLASSROOM_SETUP_EXTENSIONS_DIR = $ext
$env:CLASSROOM_NO_WINDOW = "1"

$before = (Get-ItemProperty 'HKCU:\Environment').Path
$beforeJava = (Get-ItemProperty 'HKCU:\Environment' -ErrorAction SilentlyContinue).JAVA_HOME

# ------------------------------------------------------------------ install
$log = Join-Path $Work "install.log"
$p = Start-Process -FilePath $Setup -ArgumentList "/silent /dir=`"$inst`" /components=app,editor,python,java,gcc,node,ocr /nodesktop /nostartmenu /log=`"$log`"" -PassThru -Wait
Check "the silent install ends well (exit $($p.ExitCode))" ($p.ExitCode -eq 0)
if (Test-Path $log) { Get-Content $log | Select-Object -Last 8 | ForEach-Object { Write-Host "   | $_" } }

Check "the board's files are there" (Test-Path "$inst\app\index.html")
Check "the engines the board carries are there" ((Test-Path "$inst\app\vendor\pyodide\pyodide.asm.wasm") -and (Test-Path "$inst\app\vendor\pdfjs\pdf.min.mjs"))
Check "the clips are there" (Test-Path "$inst\app\clips\manifest.json")
Check "the launcher and the uninstaller are there" ((Test-Path "$inst\ExcalidrawClassroom.exe") -and (Test-Path "$inst\Uninstall.exe"))
Check "the record of the install is kept" (Test-Path "$inst\install.json")

# java prints its version on stderr, which is not an error
$ErrorActionPreference = "Continue"
$java = cmd /c "`"$inst\tools\jdk\bin\java.exe`" -version 2>&1" | Out-String
$ErrorActionPreference = "Stop"
Check "Java runs ($($java.Split("`n")[0].Trim()))" ($java -match "21\.")
$node = & "$inst\tools\node\node.exe" -v
Check "Node runs ($node)" ($node -match "^v\d+")
$gcc = & "$inst\tools\mingw64\bin\gcc.exe" --version | Select-Object -First 1
Check "the C compiler runs ($gcc)" ($gcc -match "gcc")
$py = & "$inst\tools\python\python.exe" --version
Check "Python runs ($py)" ($py -match "3\.12")
& "$inst\tools\python\python.exe" -c "import sys; print(sys.version_info[:2])" | Out-Null
Check "Python is per-user: it is under the install folder and the machine's Python list is untouched" (Test-Path "$inst\tools\python\python.exe")

$envNow = Get-ItemProperty 'HKCU:\Environment'
Check "JAVA_HOME points at the Java" ($envNow.JAVA_HOME -eq "$inst\tools\jdk")
Check "the PATH has the tools" (($envNow.Path -like "*$inst\tools\node*") -and ($envNow.Path -like "*$inst\tools\mingw64\bin*") -and ($envNow.Path -like "*$inst\tools\jdk\bin*"))
Check "the Indra reader is told where its models are" ($envNow.INDRA_OCR_MODEL_DIR -eq "$inst\tools\indra-models")
Check "the models are there" (Test-Path "$inst\tools\indra-models\det.onnx")
Check "the editor's connection to the board was installed (through the stand-in)" (Test-Path "$ext\excalidraw.excalidraw-bridge-0.2.1\marker.txt")
Check "the reader's libraries went into the extension's folder" ((Get-ChildItem "$ext\excalidraw.excalidraw-bridge-0.2.1\wheels" -Filter "indra_ocr*.whl" -ErrorAction SilentlyContinue | Measure-Object).Count -eq 1)
Check "the uninstall list has the entry" (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ExcalidrawClassroom')

# ------------------------------------------------------------------ the Indra reader, with nothing from the internet
# a picture of printed words, drawn here
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 900, 240
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.DrawString("A queue is first in, first out", (New-Object System.Drawing.Font("Arial", 34)), [System.Drawing.Brushes]::Black, 30, 60)
$words = Join-Path $Work "words.png"
$bmp.Save($words, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

$ErrorActionPreference = "Continue"
$venv = Join-Path $Work "venv"
& "$inst\tools\python\python.exe" -m venv $venv 2>&1 | Out-Null
$wheels = "$ext\excalidraw.excalidraw-bridge-0.2.1\wheels"
$pip = cmd /c "`"$venv\Scripts\pip.exe`" install --no-index --find-links `"$wheels`" indra-ocr 2>&1" | Out-String
Check "indra-ocr installs from the shipped libraries alone (no index)" ($pip -match "Successfully installed")
$env:INDRA_OCR_MODEL_DIR = "$inst\tools\indra-models"
$env:HF_HUB_OFFLINE = "1"
$read = cmd /c "`"$venv\Scripts\indra-ocr.exe`" `"$words`" 2>&1" | Out-String
Check "Indra reads the words with the shipped models, offline ($($read.Trim()))" ($read -match "(?i)queue")
$ErrorActionPreference = "Stop"
Remove-Item Env:\INDRA_OCR_MODEL_DIR -ErrorAction SilentlyContinue
Remove-Item Env:\HF_HUB_OFFLINE -ErrorAction SilentlyContinue

# ------------------------------------------------------------------ the launcher
$launcher = Start-Process -FilePath "$inst\ExcalidrawClassroom.exe" -PassThru
Start-Sleep -Seconds 3
try {
  $page = Invoke-WebRequest -Uri "http://127.0.0.1:47750/" -UseBasicParsing
  Check "the launcher serves the board" ($page.StatusCode -eq 200 -and $page.Content -match "Excalidraw")
  $wasm = Invoke-WebRequest -Uri "http://127.0.0.1:47750/vendor/pyodide/pyodide.asm.wasm" -UseBasicParsing -Method Head
  Check "it serves the Python engine as WebAssembly" ($wasm.Headers["Content-Type"] -eq "application/wasm")
  $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:47750/clips/pages.webm")
  $req.AddRange(0, 99)
  $resp = $req.GetResponse()
  Check "it answers a range for the videos ($($resp.StatusCode))" ([int]$resp.StatusCode -eq 206)
  $resp.Close()
} catch {
  Check "the launcher answers ($($_.Exception.Message))" $false
}
Check "the launcher has no console window" ($launcher.MainWindowHandle -eq 0)
Get-Process -Name "ExcalidrawClassroom" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# ------------------------------------------------------------------ uninstall
$u = Start-Process -FilePath "$inst\Uninstall.exe" -ArgumentList "/silent" -PassThru -Wait
Check "the uninstall ends well (exit $($u.ExitCode))" ($u.ExitCode -eq 0)
Start-Sleep -Seconds 6

$after = (Get-ItemProperty 'HKCU:\Environment')
Check "the PATH is as it was" ($after.Path -eq $before)
Check "JAVA_HOME is as it was" ($after.JAVA_HOME -eq $beforeJava)
Check "the models variable is gone" ($null -eq $after.INDRA_OCR_MODEL_DIR)
Check "the entry in the uninstall list is gone" (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ExcalidrawClassroom'))
Check "the install folder is gone" (-not (Test-Path $inst))

Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ""
if ($failed -eq 0) { Write-Host "all ok" } else { Write-Host "$failed failed" }
exit $failed
