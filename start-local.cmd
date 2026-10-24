@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Install Node.js, then try again.
  goto failed
)
if not exist "node_modules\vite\bin\vite.js" (
  call npm.cmd ci
  if errorlevel 1 goto failed
)
call npm.cmd run dev -- --open
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1
