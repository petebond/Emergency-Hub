@echo off
title Emergency Hub Coordinator
cd /d "%~dp0"

rem Use the copy of Python that comes with the app; otherwise one installed on this computer.
set "PY="
if exist "python\python.exe" set PY="python\python.exe"
if not defined PY (where py >nul 2>nul && set "PY=py -3")
if not defined PY (where python >nul 2>nul && set "PY=python")
if not defined PY (
  echo.
  echo Python could not be found. The download from the Releases page includes it,
  echo so please download that version again, or install Python 3 from python.org.
  echo.
  pause
  exit /b 1
)

rem Lets the app restart itself after installing an update.
set EHC_LAUNCHER=1

:run
%PY% server.py
if %errorlevel%==3 (
  echo.
  echo Restarting...
  set EHC_NO_BROWSER=1
  goto run
)
echo.
echo The server has stopped. If you saw an error above, please make a note of it.
pause
