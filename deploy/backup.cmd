@echo off
REM Sao luu CSDL + tep dinh kem vao data\backups (chay duoc khi ung dung dang hoat dong).
setlocal
cd /d "%~dp0"
call "%~dp0deploy\env.cmd"
if errorlevel 1 exit /b 1
"%NODE_EXE%" --no-warnings=ExperimentalWarning server\scripts\backup.mjs %*
