@echo off
setlocal
set PORT=8000
cd /d "%~dp0web"

echo Starting Gear Generator web server on port %PORT% ...

set PYCMD=
where py >nul 2>nul
if %errorlevel%==0 set PYCMD=py

if not defined PYCMD (
    where python >nul 2>nul
    if %errorlevel%==0 set PYCMD=python
)

if defined PYCMD (
    start "" cmd /c "timeout /t 1 /nobreak >nul & start "" http://localhost:%PORT%/"
    %PYCMD% -m http.server %PORT%
    goto :eof
)

echo Python not found. Install it from https://www.python.org and try again.
pause
