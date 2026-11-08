@echo off
rem AC-572: the proof on a clean Windows 7 Service Pack 1 machine.
rem Runs each tool the Windows 7 setup put in, from the install folder, and a small C and Java program.
rem   check-tools.bat [install folder]
set D=%~1
if "%D%"=="" set D=%LOCALAPPDATA%\Programs\ExcalidrawClassroom
set GCC=%D%\tools\mingw64\bin\gcc.exe
rem the C compiler cannot work from a path with a space: the setup then puts it on the system drive
if not exist "%GCC%" set GCC=%SystemDrive%\ClassroomTools\ExcalidrawClassroom\mingw64\bin\gcc.exe
echo --- the tools in %D%
"%D%\tools\node\node.exe" -v
"%D%\tools\jdk\bin\java.exe" -version 2>&1 | findstr /i "version"
"%GCC%" --version 2>&1 | findstr /i "gcc"
"%D%\tools\python\python.exe" --version
set CODE=%ProgramFiles%\Microsoft VS Code\bin\code.cmd
if not exist "%CODE%" set CODE=%ProgramFiles(x86)%\Microsoft VS Code\bin\code.cmd
if exist "%CODE%" ("%CODE%" --version 2>&1 | findstr /r "^[0-9]") else echo VS Code is NOT there
if exist "%D%\tools\chromium\chrome.exe" (echo Chromium is there) else echo Chromium is NOT there
echo --- a C program and a Java program
set W=%TEMP%\w7check
mkdir "%W%" 2>nul
echo #include ^<stdio.h^> > "%W%\hello.c"
echo int main(void){ printf("hello from C\n"); return 0; } >> "%W%\hello.c"
"%GCC%" "%W%\hello.c" -o "%W%\hello.exe" && "%W%\hello.exe"
echo public class Hello { public static void main(String[] a){ System.out.println("hello from Java"); } } > "%W%\Hello.java"
"%D%\tools\jdk\bin\javac.exe" -d "%W%" "%W%\Hello.java" && "%D%\tools\jdk\bin\java.exe" -cp "%W%" Hello
echo --- the shortcuts
if exist "%USERPROFILE%\Desktop\Excalidraw Classroom.lnk" (echo desktop shortcut: yes) else echo desktop shortcut: NO
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Excalidraw Classroom" (echo start menu folder: yes) else echo start menu folder: NO
echo --- the board's address answers
start "" /b "%D%\ExcalidrawClassroom.exe"
ping 127.0.0.1 -n 6 >nul
powershell -NoProfile -Command "try { (New-Object Net.WebClient).DownloadString('http://127.0.0.1:47750/').Length.ToString() + ' bytes of the board' } catch { 'the board did not answer: ' + $_.Exception.Message }"
