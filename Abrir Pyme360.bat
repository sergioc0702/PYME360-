@echo off
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 goto use_py_launcher
python "%~dp0server\serve-local.py"
goto finished
:use_py_launcher
py -3 "%~dp0server\serve-local.py"
:finished
if errorlevel 1 pause
