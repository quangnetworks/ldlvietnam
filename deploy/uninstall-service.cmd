@echo off
REM Go LDL Workspace khoi Task Scheduler (khong xoa du lieu trong thu muc data). Run as administrator.
schtasks /end /tn "LDL Workspace" >nul 2>&1
schtasks /delete /tn "LDL Workspace" /f
schtasks /delete /tn "LDL Workspace - Sao luu" /f
netsh advfirewall firewall delete rule name="LDL Workspace"
powershell -NoProfile -Command "Get-WmiObject Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server\src\node.js*' } | ForEach-Object { $_.Terminate() | Out-Null }"
echo Da go LDL Workspace (du lieu trong thu muc data van con nguyen).
pause
