@echo off
REM ===== LDL Workspace - chay tren Windows (cua so dong lenh) =====
REM Cau hinh trong tep .env canh tep nay. Dong cua so = dung chuong trinh.
REM De chay ngam khi khoi dong may chu: chuot phai install-service.cmd > Run as administrator.
setlocal
cd /d "%~dp0"
call "%~dp0deploy\env.cmd"
if errorlevel 1 (pause & exit /b 1)
echo LDL Workspace dang chay - mo http://localhost:%PORT%   (Ctrl+C de dung)
"%NODE_EXE%" --no-warnings=ExperimentalWarning server\src\node.js
pause
