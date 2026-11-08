# Runs inside a Windows virtual machine: the student setup for real (the real editor too), then the uninstall.
# AC-567. Copy ClassTools-Setup.exe to C:\test and run this as the test user.
$ErrorActionPreference = "Continue"
$Setup = "C:\test\ClassTools-Setup.exe"
# a space in the path on purpose: the C compiler cannot work from one, so the setup puts it elsewhere
$inst = "C:\test\stu dent"
$failed = 0
function Check($name, $ok) { if ($ok) { "ok - $name" } else { "not ok - $name"; $script:failed++ } }

Remove-Item $inst -Recurse -Force -ErrorAction SilentlyContinue
$before = [string](Get-ItemProperty 'HKCU:\Environment' -ErrorAction SilentlyContinue).Path
"PATH before: [$before]"

$t = Measure-Command {
  $p = Start-Process -FilePath $Setup -ArgumentList "/silent /dir=`"$inst`" /components=editor,python,java,gcc,node /nostartmenu /nodesktop /log=`"C:\test\student.log`"" -PassThru -Wait
}
Check "the silent install ends well (exit $($p.ExitCode), $([int]$t.TotalSeconds) s)" ($p.ExitCode -eq 0)
"--- the end of the log"; Get-Content C:\test\student.log -ErrorAction SilentlyContinue | Select-Object -Last 8 | % { "   | $_" }; "---"

Check "there is no board in the student setup" (-not (Test-Path "$inst\app") -and -not (Test-Path "$inst\ExcalidrawClassroom.exe"))
Check "the uninstaller is there" (Test-Path "$inst\Uninstall.exe")
$code = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
Check "the editor was installed for this user alone" (Test-Path $code)
if (Test-Path $code) { $v = cmd /c "`"$code`" --version 2>&1" | Out-String; Check "the editor runs ($(($v -split "`n")[0].Trim()))" ($v -match "^\d+\.\d+") }

$fresh = powershell -NoProfile -Command {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ";" + [Environment]::GetEnvironmentVariable('Path','User')
  $env:JAVA_HOME = [Environment]::GetEnvironmentVariable('JAVA_HOME','User')
  "python: " + (python --version 2>&1); "java: " + ((cmd /c "java -version 2>&1") -split "`n")[0]; "gcc: " + ((gcc --version) | Select-Object -First 1); "node: " + (node -v)
} | Out-String
"--- by name, from a fresh terminal:"; $fresh
Check "python, java, gcc and node by name run" (($fresh -match "python: Python 3\.12") -and ($fresh -match "java: openjdk") -and ($fresh -match "gcc: gcc") -and ($fresh -match "node: v\d+"))

$w = "C:\test\work"; New-Item -ItemType Directory -Force $w | Out-Null
Set-Content "$w\hello.c" -Encoding ASCII -Value '#include <stdio.h>', 'int main(void){ printf("hello from C\n"); return 0; }'
$gccExe = (Get-ChildItem "C:\ClassroomTools" -Recurse -Filter gcc.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
Check "the C compiler is on a path with no space ($gccExe)" ($gccExe -and $gccExe.IndexOf(' ') -lt 0)
& $gccExe "$w\hello.c" -o "$w\hello.exe"
Check "a C program compiles and runs" ((& "$w\hello.exe") -eq "hello from C")
Set-Content "$w\Hello.java" -Encoding ASCII -Value 'public class Hello { public static void main(String[] a){ System.out.println("hello from Java"); } }'
Check "a Java program runs" ((& "$inst\tools\jdk\bin\java.exe" "$w\Hello.java") -eq "hello from Java")
Check "the entry in the uninstall list is the student one" ((Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ClassTools') -and -not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ExcalidrawClassroom'))

$u = Start-Process -FilePath "$inst\Uninstall.exe" -ArgumentList "/silent" -PassThru -Wait
Check "the uninstall ends well (exit $($u.ExitCode))" ($u.ExitCode -eq 0)
Start-Sleep -Seconds 8
$after = [string](Get-ItemProperty 'HKCU:\Environment').Path
"PATH after: [$after]"
Check "the PATH is exactly as it was" ($after -eq $before)
Check "the editor was taken out again" (-not (Test-Path $code))
Check "the entry in the uninstall list is gone" (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ClassTools'))
Check "the install folder is gone" (-not (Test-Path $inst))
Check "the compiler's folder is gone too" (-not (Test-Path "C:\ClassroomTools"))
if ($failed -eq 0) { "all ok" } else { "$failed failed" }
