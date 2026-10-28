# Dang ky LDL Workspace voi Task Scheduler (Windows Server 2012 tro len, PowerShell 3+).
param([string]$Dir, [string]$Port = '4000')
$ErrorActionPreference = 'Stop'
$Dir = (Resolve-Path $Dir).Path
$name = 'LDL Workspace'

# 1. Ung dung: chay khi khoi dong may, tai khoan SYSTEM, khong gioi han thoi gian chay
$action = New-ScheduledTaskAction -Execute "$Dir\run-service.cmd" -WorkingDirectory $Dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

# 2. Sao luu 01:30 moi dem
$bAction = New-ScheduledTaskAction -Execute "$Dir\backup.cmd" -WorkingDirectory $Dir
$bTrigger = New-ScheduledTaskTrigger -Daily -At '01:30'
$bSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -StartWhenAvailable
Register-ScheduledTask -TaskName "$name - Sao luu" -Action $bAction -Trigger $bTrigger -Settings $bSettings -Principal $principal -Force | Out-Null

# 3. Tuong lua
& netsh advfirewall firewall delete rule name="$name" | Out-Null
& netsh advfirewall firewall add rule name="$name" dir=in action=allow protocol=TCP localport=$Port | Out-Null

# 4. Dung ban dang chay (neu cai lai) roi chay ngay
Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Get-WmiObject Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server\src\node.js*' } | ForEach-Object { $_.Terminate() | Out-Null }
Start-ScheduledTask -TaskName $name
Start-Sleep -Seconds 5
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 15
  Write-Host "Da cai dat va dang chay: http://localhost:$Port  (may khac: http://<IP-may-chu>:$Port)"
} catch {
  Write-Host "Da cai dat nhung chua mo duoc http://127.0.0.1:$Port - xem nhat ky: $Dir\data\server.log"
}
Write-Host "Nhat ky: $Dir\data\server.log   |   Sao luu: $Dir\data\backups (01:30 hang dem)"
