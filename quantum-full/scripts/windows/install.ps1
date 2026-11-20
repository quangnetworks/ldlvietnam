# QUANTUM FULL — cài đặt & chạy cục bộ trên Windows
# Cách dùng (PowerShell):
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Target "D:\Duong dan khac"
param(
  [string]$Target = 'D:\OneDrive\10 Claude\Project Cloudflare\Quantum',
  [string]$Branch = 'claude/charming-heisenberg-xtzan2',
  [string]$Repo = 'https://github.com/quangnetworks/ldlvietnam.git',
  # Database SQLite cục bộ đặt NGOÀI OneDrive để tránh hỏng file khi đồng bộ.
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA 'QuantumFull\state'),
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Step([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Have([string]$c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Invoke-Checked([string]$what, [scriptblock]$block) {
  & $block
  if ($LASTEXITCODE -ne 0) { throw "$what thất bại (mã lỗi $LASTEXITCODE)" }
}

Step 'Kiểm tra Git và Node.js (cần Node 22 trở lên)'
if (-not (Have 'git')) {
  if (-not (Have 'winget')) { throw 'Chưa có Git. Cài tại https://git-scm.com rồi chạy lại.' }
  Invoke-Checked 'Cài Git' { winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements }
  Refresh-Path
}
$nodeOk = $false
if (Have 'node') { $nodeOk = [int]((node -v).TrimStart('v').Split('.')[0]) -ge 22 }
if (-not $nodeOk) {
  if (-not (Have 'winget')) { throw 'Cần Node.js 22 trở lên. Cài bản LTS tại https://nodejs.org rồi chạy lại.' }
  Invoke-Checked 'Cài Node.js LTS' { winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements }
  Refresh-Path
}
Write-Host ("   Git: " + (git --version) + " | Node: " + (node -v))

Step "Tải mã nguồn vào $Target"
if (Test-Path (Join-Path $Target '.git')) {
  Invoke-Checked 'git pull' { git -C $Target pull --ff-only }
} else {
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  if (@(Get-ChildItem -LiteralPath $Target -Force).Count -gt 0) { throw "Thư mục $Target đã có dữ liệu khác. Hãy chọn thư mục trống (tham số -Target)." }
  Invoke-Checked 'git clone' { git clone --filter=blob:none --sparse --branch $Branch $Repo $Target }
  Invoke-Checked 'git sparse-checkout' { git -C $Target sparse-checkout set quantum-full }
}
$App = Join-Path $Target 'quantum-full'
if (-not (Test-Path (Join-Path $App 'package.json'))) { throw "Không tìm thấy dự án tại $App" }

Step "Cấu hình database cục bộ tại $StateDir"
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$cfg = [ordered]@{ stateDir = $StateDir; port = 5190 } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $App 'quantum.local.json'), $cfg, (New-Object System.Text.UTF8Encoding($false)))

Step 'Cài thư viện (npm ci) — lần đầu mất vài phút'
Push-Location $App
try {
  Invoke-Checked 'npm ci' { npm ci --no-audit --no-fund }
  Invoke-Checked 'Thiết lập cục bộ' { npm run setup:local }
} finally { Pop-Location }

Step 'Tạo trình khởi chạy và shortcut trên Desktop'
$run = @'
@echo off
title QUANTUM FULL (local)
cd /d "%~dp0quantum-full"
start "" cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:5190"
echo Dang chay QUANTUM FULL tai http://localhost:5190  (dong cua so nay de dung)
call npm run dev
pause
'@
$update = @'
@echo off
title Cap nhat QUANTUM FULL
cd /d "%~dp0"
git pull --ff-only || goto :err
cd quantum-full
call npm ci --no-audit --no-fund || goto :err
call npm run db:migrate:local || goto :err
echo.
echo Da cap nhat xong. Chay "Quantum Full.cmd" de mo ung dung.
pause
exit /b 0
:err
echo Cap nhat that bai.
pause
exit /b 1
'@
$ascii = New-Object System.Text.ASCIIEncoding
[System.IO.File]::WriteAllText((Join-Path $Target 'Quantum Full.cmd'), $run, $ascii)
[System.IO.File]::WriteAllText((Join-Path $Target 'Cap nhat Quantum.cmd'), $update, $ascii)
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path $desktop 'Quantum Full.lnk'))
$lnk.TargetPath = Join-Path $Target 'Quantum Full.cmd'
$lnk.WorkingDirectory = $Target
$lnk.Description = 'QUANTUM FULL - chay cuc bo'
$lnk.Save()

Write-Host "`nHoàn tất!" -ForegroundColor Green
Write-Host "  Mã nguồn : $App"
Write-Host "  Database : $StateDir (ngoài OneDrive)"
Write-Host "  Chạy     : bấm đúp 'Quantum Full' trên Desktop (hoặc '$Target\Quantum Full.cmd')"
Write-Host "  Cập nhật : '$Target\Cap nhat Quantum.cmd'"
Write-Host "  Lưu ý    : thư mục node_modules (nhiều file) nằm trong OneDrive; nếu OneDrive đồng bộ chậm, hãy tạm dừng OneDrive trong lần cài đầu."
if (-not $NoStart) { Start-Process -FilePath (Join-Path $Target 'Quantum Full.cmd') -WorkingDirectory $Target }
