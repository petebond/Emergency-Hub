@echo off
title Emergency Hub Coordinator
rem Runs from the app folder. The "Emergency Hub" shortcut next to that folder starts this file.
rem Work out the folders before changing directory: %~dp0 can go wrong after a cd when started by a relative path.
set "APPDIR=%~dp0"
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "%APPDIR%"

rem Keep the "Emergency Hub" shortcut pointing here, with its icon. Only does anything the first time,
rem or after the folder has been moved, so copies of the shortcut (for example on the desktop) keep working.
set "HAVE="
if exist ".shortcut" set /p HAVE=<".shortcut"
if /i "%HAVE%"=="%ROOT%" goto shortcut_ok
powershell -NoProfile -ExecutionPolicy Bypass -Command "$r=$env:ROOT; $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $r 'Emergency Hub.lnk')); $s.TargetPath=(Join-Path $env:APPDIR 'Start Emergency Hub.bat'); $s.WorkingDirectory=$env:APPDIR; $s.IconLocation=(Join-Path $env:APPDIR 'static\emergency-hub.ico')+',0'; $s.Description='Start Emergency Hub Coordinator'; $s.Save(); Set-Content -LiteralPath (Join-Path $env:APPDIR '.shortcut') -Value $r -NoNewline" >nul 2>nul
:shortcut_ok

rem Use the copy of Python that comes with the app; otherwise one installed on this computer.
set "PY="
if exist "python\python.exe" set PY="python\python.exe"
if not defined PY (where py >nul 2>nul && set "PY=py -3")
if not defined PY (where python >nul 2>nul && set "PY=python")
if not defined PY goto no_python

rem Lets the app restart itself after installing an update.
set EHC_LAUNCHER=1

:run
%PY% server.py
if %errorlevel%==3 goto restart
echo.
echo The server has stopped. If you saw an error above, please make a note of it.
pause
exit /b

:restart
echo.
echo Restarting...
set EHC_NO_BROWSER=1
goto run

:no_python
echo.
echo Python could not be found. The download from the Releases page includes it in the
echo app\python folder, so please download that version again, or install Python 3 from python.org.
echo.
pause
exit /b 1
