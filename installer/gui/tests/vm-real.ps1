# Runs inside a Windows virtual machine (the machine itself is the test): the real install of every part, with nothing stood in for.
# AC-567, AC-571, AC-575 (VSCodium is the editor), AC-577 (a tool is taken away alone, the rest stays). Copy the setup (the offline one, or the online one: pass its path as -Setup) to C:\test and run this
# as the test user.
param([string]$Setup = "C:\test\ClassroomSetup.exe")
$ErrorActionPreference = "Continue"
# a space in the path on purpose: the C compiler cannot work from one, so the setup puts it elsewhere
$inst = "C:\test\in stall"
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
$code = "$env:LOCALAPPDATA\Programs\VSCodium\bin\codium.cmd"
Check "VSCodium was installed for this user alone" (Test-Path $code)
if (Test-Path $code) {
  $v = cmd /c "`"$code`" --version 2>&1" | Out-String
  Check "VSCodium runs ($(($v -split "`n")[0].Trim()))" ($v -match "^\d+\.\d+")
  $ext = cmd /c "`"$code`" --list-extensions 2>&1" | Out-String
  Check "the board's connection is in the editor ($($ext.Trim() -replace "`r?`n", ' '))" ($ext -match "excalidraw")
}
Check "the extension's folder has the Indra libraries" ((Get-ChildItem (Get-ChildItem "$env:USERPROFILE\.vscode-oss\extensions" -Directory | ? Name -like "*excalidraw*").FullName -Recurse -Filter "indra_ocr*.whl" -ErrorAction SilentlyContinue | Measure-Object).Count -eq 1)

$java = cmd /c "`"$inst\tools\jdk\bin\java.exe`" -version 2>&1" | Out-String
Check "Java runs ($(($java -split "`n")[0].Trim()))" ($java -match "21\.")
Check "Node runs ($(& "$inst\tools\node\node.exe" -v))" $true
$gccExe = (Get-ChildItem "C:\ClassroomTools" -Recurse -Filter gcc.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
Check "the C compiler is on a path with no space ($gccExe)" ($gccExe -and $gccExe.IndexOf(' ') -lt 0)
Check "the C compiler runs" ((& $gccExe --version | Select-Object -First 1) -match "gcc")
Set-Content "C:\test\hello.c" -Encoding ASCII -Value '#include <stdio.h>', 'int main(void){ printf("hello from C\n"); return 0; }'
& $gccExe "C:\test\hello.c" -o "C:\test\hello.exe"
Check "a C program compiles and runs" ((Test-Path "C:\test\hello.exe") -and ((& "C:\test\hello.exe") -eq "hello from C"))
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

"--- uninstall one tool at a time, the rest stays (D-478)"
$u = Start-Process -FilePath "$inst\Uninstall.exe" -ArgumentList "/silent /remove=node" -PassThru -Wait
Check "removing Node alone ends well (exit $($u.ExitCode))" ($u.ExitCode -eq 0)
$envNow = Get-ItemProperty 'HKCU:\Environment'
Check "Node's folder is gone" (-not (Test-Path "$inst\tools\node"))
$nodeLeft = ($envNow.Path -split ';') | ? { $_ -like "*tools\node*" }
Check "Node's entry on the PATH is gone [$nodeLeft]" (-not $nodeLeft)
Check "the others are whole: the board, Python, Java and the C compiler" ((Test-Path "$inst\app\index.html") -and (Test-Path "$inst\tools\python\python.exe") -and (Test-Path "$inst\tools\jdk\bin\java.exe") -and $gccExe -and (Test-Path $gccExe) -and ($envNow.JAVA_HOME -eq "$inst\tools\jdk"))
Check "the uninstaller and its entry in the Apps list are still there" ((Test-Path "$inst\Uninstall.exe") -and (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ExcalidrawClassroom'))
Check "Python is still on the PATH" ((($envNow.Path -split ';') | ? { $_ -like "*tools\python*" }).Count -ge 1)

$u = Start-Process -FilePath "$inst\Uninstall.exe" -ArgumentList "/silent /remove=java,gcc" -PassThru -Wait
Check "removing Java and the C compiler ends well (exit $($u.ExitCode))" ($u.ExitCode -eq 0)
$envNow = Get-ItemProperty 'HKCU:\Environment'
Check "Java is gone with JAVA_HOME, the compiler's own folder is gone" ((-not (Test-Path "$inst\tools\jdk")) -and (-not $envNow.JAVA_HOME) -and (-not (Test-Path "C:\ClassroomTools")))
Check "Python and the board are still whole" ((Test-Path "$inst\tools\python\python.exe") -and (Test-Path "$inst\app\index.html"))

$u = Start-Process -FilePath "$inst\Uninstall.exe" -ArgumentList "/silent /remove=python" -PassThru -Wait
Check "removing Python alone ends well (exit $($u.ExitCode))" ($u.ExitCode -eq 0)
$envNow = Get-ItemProperty 'HKCU:\Environment'
Check "Python is gone: its folder, and its entries on the PATH" ((-not (Test-Path "$inst\tools\python")) -and -not (($envNow.Path -split ';') | ? { $_ -like "*tools\python*" }))
Check "the editor and the board are still there" ((Test-Path $code) -and (Test-Path "$inst\app\index.html") -and (Test-Path "$inst\Uninstall.exe"))

"--- uninstall"
$u = Start-Process -FilePath "$inst\Uninstall.exe" -ArgumentList "/silent" -PassThru -Wait
Check "the uninstall ends well (exit $($u.ExitCode))" ($u.ExitCode -eq 0)
Start-Sleep -Seconds 8
Check "the install folder is gone" (-not (Test-Path $inst))
Check "the compiler's folder is gone too" (-not (Test-Path "C:\ClassroomTools"))
"PATH after: [" + (Get-ItemProperty 'HKCU:Environment').Path + "]"
"--- env before:"; $envBefore
"--- env after:"; (Get-ItemProperty 'HKCU:Environment' | Format-List | Out-String)
# the editor's own uninstaller may drop an empty part (a trailing ;): the entries are what is compared
$norm = { param($p) (([string]$p -split ';') | Where-Object { $_ } ) -join ';' }
Check "the PATH is as it was" ((& $norm (Get-ItemProperty 'HKCU:\Environment').Path) -eq (& $norm $pathBefore))
Check "VSCodium was taken out again" (-not (Test-Path $code))
Check "the uninstall entry is gone" (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ExcalidrawClassroom'))

if ($failed -eq 0) { "all ok" } else { "$failed failed" }



