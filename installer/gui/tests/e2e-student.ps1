# The student setup, end to end, without the clicks: the tools are put in, they run, and the uninstall leaves nothing.
# AC-563 - proved by hand on Windows (D-463, D-464, D-465).
#
#   powershell -File installer\gui\tests\e2e-student.ps1 -Setup <ClassTools-Setup.exe>
#
# The editor's command is a stand-in (CLASSROOM_SETUP_CODE_CLI), so a real editor on this machine is never touched.
param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [string]$Work = (Join-Path $env:TEMP "classtools-e2e")
)

$ErrorActionPreference = "Stop"
$failed = 0
function Check($name, $ok) {
  if ($ok) { Write-Host "ok - $name" } else { Write-Host "not ok - $name"; $script:failed++ }
}

Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Work | Out-Null
$inst = Join-Path $Work "install"

# a stand-in editor command, so that the editor's own installer is not run
$fake = Join-Path $Work "code.cmd"
Set-Content $fake -Encoding ASCII -Value @("@echo off", "exit /b 0")
$env:CLASSROOM_SETUP_CODE_CLI = $fake

$before = (Get-ItemProperty 'HKCU:\Environment').Path

$log = Join-Path $Work "install.log"
$p = Start-Process -FilePath $Setup -ArgumentList "/silent /dir=`"$inst`" /components=editor,python,java,gcc,node /nostartmenu /log=`"$log`"" -PassThru -Wait
Check "the silent install ends well (exit $($p.ExitCode))" ($p.ExitCode -eq 0)

Check "there is no board in the student setup" (-not (Test-Path "$inst\app") -and -not (Test-Path "$inst\ExcalidrawClassroom.exe"))
Check "the uninstaller is there" (Test-Path "$inst\Uninstall.exe")

$ErrorActionPreference = "Continue"
$java = cmd /c "`"$inst\tools\jdk\bin\java.exe`" -version 2>&1" | Out-String
$ErrorActionPreference = "Stop"
Check "Java runs" ($java -match "21\.")
Check "Node runs" ((& "$inst\tools\node\node.exe" -v) -match "^v\d+")
Check "the C compiler runs" ((& "$inst\tools\mingw64\bin\gcc.exe" --version | Select-Object -First 1) -match "gcc")
Check "Python runs" ((& "$inst\tools\python\python.exe" --version) -match "3\.12")

# the lesson itself: compile and run a small C program, and a Java one
Set-Content "$Work\hello.c" -Encoding ASCII -Value '#include <stdio.h>', 'int main(void){ printf("hello from C\n"); return 0; }'
& "$inst\tools\mingw64\bin\gcc.exe" "$Work\hello.c" -o "$Work\hello.exe"
Check "a C program compiles and runs" ((& "$Work\hello.exe") -eq "hello from C")
Set-Content "$Work\Hello.java" -Encoding ASCII -Value 'public class Hello { public static void main(String[] a){ System.out.println("hello from Java"); } }'
Check "a Java program runs (single-file source)" ((& "$inst\tools\jdk\bin\java.exe" "$Work\Hello.java") -eq "hello from Java")

Check "the entry in the uninstall list is the student one" ((Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ClassTools') -and -not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ExcalidrawClassroom'))

$u = Start-Process -FilePath "$inst\Uninstall.exe" -ArgumentList "/silent" -PassThru -Wait
Check "the uninstall ends well (exit $($u.ExitCode))" ($u.ExitCode -eq 0)
Start-Sleep -Seconds 6
Check "the PATH is as it was" ((Get-ItemProperty 'HKCU:\Environment').Path -eq $before)
Check "the entry in the uninstall list is gone" (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ClassTools'))
Check "the install folder is gone" (-not (Test-Path $inst))

Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ""
if ($failed -eq 0) { Write-Host "all ok" } else { Write-Host "$failed failed" }
exit $failed
