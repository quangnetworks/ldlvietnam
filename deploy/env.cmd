@echo off
REM Thiet lap chung cho cac tep .cmd: chon node.exe, tao .env, DATA_DIR, PORT.
REM Node.js 22 chua ho tro chinh thuc Windows Server 2012 / 2012 R2: bo qua buoc kiem tra phien ban Windows.
set NODE_SKIP_PLATFORM_CHECK=1
set "NODE_EXE=node"
if exist "%~dp0..\node\node.exe" set "NODE_EXE=%~dp0..\node\node.exe"
"%NODE_EXE%" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)" >nul 2>&1
if errorlevel 1 (
  echo [LOI] Khong tim thay Node.js 22.5 tro len.
  echo       Dat node.exe ^(https://nodejs.org/dist/latest-v22.x/win-x64/node.exe^) vao thu muc "node" canh start.cmd.
  exit /b 1
)
if not exist "%~dp0..\.env" copy "%~dp0..\.env.example" "%~dp0..\.env" >nul
if "%DATA_DIR%"=="" set "DATA_DIR=%~dp0..\data"
set "PORT=4000"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%~dp0..\.env") do if /i "%%a"=="PORT" if not "%%b"=="" set "PORT=%%b"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
exit /b 0
