@echo off
title ESN Speed Friending - phone remote (keep open)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
echo.
echo The phone remote has stopped.
pause
