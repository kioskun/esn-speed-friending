@echo off
rem Lets phones reach the ESN phone remote (port 8765) through Windows Firewall.
rem Run once on the event laptop. Windows asks for administrator permission.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title ESN phone remote - firewall
echo.
echo  Allowing the ESN phone remote (TCP port 8765) on all networks...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-NetFirewallRule -DisplayName 'ESN phone remote' -ErrorAction SilentlyContinue | Remove-NetFirewallRule;" ^
  "New-NetFirewallRule -DisplayName 'ESN phone remote' -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow -Profile Any | Out-Null;" ^
  "$blocks = Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue | Where-Object { ($_ | Get-NetFirewallApplicationFilter).Program -match 'powershell\.exe$' };" ^
  "foreach($b in $blocks){ Write-Host ('  Turning off a rule that blocked PowerShell: ' + $b.DisplayName); $b | Disable-NetFirewallRule };" ^
  "Write-Host '  Done. Phones on the same network can now open the remote.' -ForegroundColor Green"
echo.
echo  Now start (or restart) start-phone-remote.bat and scan the QR again.
echo.
pause
