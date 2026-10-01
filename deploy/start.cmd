@echo off
REM Chay LDL Workspace (Windows). Can Node.js >= 22.5. Cau hinh trong tep .env canh tep nay.
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
if "%DATA_DIR%"=="" set "DATA_DIR=%~dp0data"
node --no-warnings=ExperimentalWarning server\src\node.js
