# Runs inside a Windows virtual machine (the machine itself is the test): the real install of every part, with nothing stood in for.
# AC-567, AC-571. Copy the setup (the offline one, or the online one: pass its path as -Setup) to C:\test and run this
# as the test user.
param([string]$Setup = "C:\test\ClassroomSetup.exe")
$ErrorActionPreference = "Continue"
$inst = "C:\test\install"
$failed = 0
function Check($name, $ok) { if ($ok) { "ok - $name" } else { "not ok - $name"; $script:failed++ } }

Remove-Item $inst -Recurse -Force -ErrorAction SilentlyContinue

$pathBefore = (Get-ItemProperty 'HKCU:\Environment' -ErrorAction SilentlyContinue).Path
"PATH before: [$pathBefore]"

$t = Measure-Command {
  $p = Start-Process -FilePath $Setup -ArgumentList "/silent /dir=`"$inst`" /components=app,editor,python,java,gcc,node,ocr /nodesktop /log=`"C:\test\install.log`"" -PassThru -Wait
}
Check "the silent install ends well (exit $($p.ExitCode), $([int]$t.TotalSeconds) s)" ($p.ExitCode -eq 0)
"--- the end of the log"
Get-Content C:\test\install.log -ErrorAction SilentlyContinue | Select-Object -Last 14 | ForEach-Object { "   | $_" }
"---"

Check "the board is in place" (Test-Path "$inst\app\index.html")
Check "the launcher and the uninstaller are in place" ((Test-Path "$inst\ExcalidrawClassroom.exe") -and (Test-Path "$inst\Uninstall.exe"))

# a new logon sees the user's new PATH, so the tools are looked for as a student would
$code = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
Check "VS Code was installed for this user alone" (Test-Path $code)
if (Test-Path $code) {
  $v = cmd /c "`"$code`" --version 2>&1" | Out-String
  Check "VS Code runs ($(($v -split "`n")[0].Trim()))" ($v -match "^\d+\.\d+")
  $ext = cmd /c "`"$code`" --list-extensions 2>&1" | Out-String
  Check "the board's connection is in the editor ($($ext.Trim() -replace "`r?`n", ' '))" ($ext -match "excalidraw")
}
"--- extension folders:"; Get-ChildItem "$env:USERPROFILE.vscodeextensions" -ErrorAction SilentlyContinue | % { "   $($_.FullName)"; Get-ChildItem $_.FullName -Recurse -Filter *.whl -ErrorAction SilentlyContinue | % { "      wheel: $($_.Name)" } }
Check "the extension's folder has the Indra libraries" ((Get-ChildItem (Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory | ? Name -like "*excalidraw*").FullName -Recurse -Filter "indra_ocr*.whl" -ErrorAction SilentlyContinue | Measure-Object).Count -eq 1)

$java = cmd /c "`"$inst\tools\jdk\bin\java.exe`" -version 2>&1" | Out-String
Check "Java runs ($(($java -split "`n")[0].Trim()))" ($java -match "21\.")
Check "Node runs ($(& "$inst\tools\node\node.exe" -v))" $true
Check "the C compiler runs" ((& "$inst\tools\mingw64\bin\gcc.exe" --version | Select-Object -First 1) -match "gcc")
Check "Python runs ($(& "$inst\tools\python\python.exe" --version))" (Test-Path "$inst\tools\python\python.exe")

$envNow = Get-ItemProperty 'HKCU:\Environment'
Check "JAVA_HOME is set" ($envNow.JAVA_HOME -eq "$inst\tools\jdk")
Check "the models variable is set" ($envNow.INDRA_OCR_MODEL_DIR -eq "$inst\tools\indra-models")
$pathParts = $envNow.Path -split ';'
Check "Python is on the user's PATH, and ahead of the Store's stub if that is there" (($pathParts | ? { $_ -like "*tools\python*" }).Count -ge 1 -and ((($pathParts | % { $_ -like "*WindowsApps*" }).IndexOf($true) -lt 0) -or ((($pathParts | % { $_ -like "*tools\python*" }).IndexOf($true)) -lt (($pathParts | % { $_ -like "*WindowsApps*" }).IndexOf($true)))))

# a student's terminal: a new process that asks for `python`, `java`, `gcc`, `node` by name
$fresh = powershell -NoProfile -Command {
  $machine = [Environment]::GetEnvironmentVariable('Path','Machine'); $user = [Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = "$machine;$user"
  $env:JAVA_HOME = [Environment]::GetEnvironmentVariable('JAVA_HOME','User')
  "python: " + (python --version 2>&1); "java: " + ((cmd /c "java -version 2>&1") -split "`n")[0]; "gcc: " + ((gcc --version) | Select-Object -First 1); "node: " + (node -v)
} | Out-String
"--- by name, from a fresh terminal:"
$fresh
Check "python by name is Python 3.12" ($fresh -match "python: Python 3\.12")
Check "java, gcc and node by name run" (($fresh -match "java: openjdk version") -and ($fresh -match "gcc: gcc") -and ($fresh -match "node: v\d+"))

# the launcher
$env:CLASSROOM_NO_WINDOW = "1"
$launcher = Start-Process -FilePath "$inst\ExcalidrawClassroom.exe" -PassThru
Start-Sleep -Seconds 4
try {
  $page = Invoke-WebRequest -Uri "http://127.0.0.1:47750/" -UseBasicParsing
  Check "the launcher serves the board" ($page.StatusCode -eq 200)
} catch { Check "the launcher answers ($($_.Exception.Message))" $false }
Get-Process -Name "ExcalidrawClassroom" -ErrorAction SilentlyContinue | Stop-Process -Force

"--- uninstall"
$u = Start-Process -FilePath "$inst\Uninstall.exe" -ArgumentList "/silent" -PassThru -Wait
Check "the uninstall ends well (exit $($u.ExitCode))" ($u.ExitCode -eq 0)
Start-Sleep -Seconds 8
Check "the install folder is gone" (-not (Test-Path $inst))
"PATH after: [" + (Get-ItemProperty 'HKCU:Environment').Path + "]"
"--- env before:"; $envBefore
"--- env after:"; (Get-ItemProperty 'HKCU:Environment' | Format-List | Out-String)
Check "the PATH is as it was" (([string](Get-ItemProperty 'HKCU:\Environment').Path) -eq ([string]$pathBefore))
Check "VS Code was taken out again" (-not (Test-Path $code))
Check "the uninstall entry is gone" (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ExcalidrawClassroom'))

if ($failed -eq 0) { "all ok" } else { "$failed failed" }



