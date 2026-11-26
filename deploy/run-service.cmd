@echo off
REM Duoc Task Scheduler goi khi khoi dong may chu (tai khoan SYSTEM): chay LDL Workspace, tu chay lai neu bi dung.
REM Nhat ky: data\server.log (tu xoay vong khi qua 10 MB).
setlocal
cd /d "%~dp0"
call "%~dp0deploy\env.cmd"
if errorlevel 1 exit /b 1
:loop
for %%F in ("%DATA_DIR%\server.log") do if %%~zF GTR 10485760 move /y "%DATA_DIR%\server.log" "%DATA_DIR%\server.old.log" >nul
echo [%date% %time%] Khoi dong LDL Workspace >> "%DATA_DIR%\server.log"
"%NODE_EXE%" --no-warnings=ExperimentalWarning server\src\node.js >> "%DATA_DIR%\server.log" 2>&1
echo [%date% %time%] Chuong trinh dung (ma %errorlevel%), chay lai sau 10 giay >> "%DATA_DIR%\server.log"
timeout /t 10 /nobreak >nul
goto loop
