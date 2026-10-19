@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Action start
echo.
pause
