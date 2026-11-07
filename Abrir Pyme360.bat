@echo off
chcp 65001 >nul
title Pyme360
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
  py -3 server\serve-local.py
  goto finished
)
where python >nul 2>nul
if not errorlevel 1 (
  python server\serve-local.py
  goto finished
)
echo Pyme360 necesita Python 3.11 o superior.
echo Instalalo desde https://www.python.org/downloads/ y vuelve a abrir este archivo.
pause
exit /b 1

:finished
if errorlevel 1 pause
