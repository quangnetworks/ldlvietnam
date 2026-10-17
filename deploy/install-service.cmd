@echo off
REM Cai LDL Workspace chay ngam cung Windows (Task Scheduler) + sao luu 01:30 hang dem + mo cong tuong lua.
REM Chuot phai > Run as administrator.
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Hay chay tep nay bang quyen Administrator: chuot phai ^> Run as administrator.
  pause
  exit /b 1
)
call "%~dp0deploy\env.cmd"
if errorlevel 1 (pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\install-service.ps1" -Dir "%~dp0." -Port %PORT%
pause
