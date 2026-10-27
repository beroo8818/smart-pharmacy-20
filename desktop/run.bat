@echo off
title Dawa - Run
cd /d "%~dp0"

echo ========================================
echo   Dawa - Hospital Stock Manager
echo ========================================
echo.

echo Freeing port 5180 if busy...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5180" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>nul
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Please install Node.js 20.18.1 from:
  echo   https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi
  echo Then run this file again.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -p "process.versions.node"') do set NODE_VERSION=%%v
for /f "tokens=1 delims=." %%v in ("%NODE_VERSION%") do set NODE_MAJOR=%%v
if not "%NODE_MAJOR%"=="20" (
  echo ERROR: Wrong Node.js version found: %NODE_VERSION%
  echo.
  echo This app needs Node.js 20.18.1 exactly.
  echo Node.js 24 causes the better-sqlite3 / node-gyp / Visual Studio error.
  echo.
  echo Simple fix:
  echo 1. Close this window.
  echo 2. Uninstall Node.js from Windows Settings ^> Apps.
  echo 3. Install Node.js 20.18.1 from this link:
  echo    https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi
  echo 4. Delete the node_modules folder beside this file.
  echo 5. Double-click run.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing packages for the first time...
  echo This will take 3-5 minutes. Please wait.
  echo.
  call npm install --no-audit --no-fund --loglevel=error
  if errorlevel 1 (
    echo.
    echo ERROR: npm install failed. Check your internet connection.
    pause
    exit /b 1
  )
)

if not exist "node_modules\concurrently" (
  echo ERROR: concurrently still missing. Re-running install...
  call npm install --no-audit --no-fund --loglevel=error
)

if not exist "node_modules\.better-sqlite3-rebuilt" (
  echo Rebuilding better-sqlite3 for Electron... please wait 2-3 minutes
  call npx --yes electron-rebuild -f -w better-sqlite3
  if errorlevel 1 (
    echo ERROR: electron-rebuild failed.
    pause
    exit /b 1
  )
  echo done > "node_modules\.better-sqlite3-rebuilt"
)

echo.
echo Starting Dawa...
echo Vite URL:      http://127.0.0.1:5180/
echo Browser URL:   http://localhost:5180/
echo Electron will open automatically after Vite is ready.
echo Startup mode:  direct Vite window + direct Electron
echo Default login:  admin / admin123
echo (Do NOT close this window while using the app)
echo.

start "Dawa Vite" /min cmd /c "npm run dev:vite"
echo Waiting for Vite...
call npx --yes wait-on http://127.0.0.1:5180
if errorlevel 1 (
  echo.
  echo ERROR: Vite did not start correctly. Read the error above.
  pause
  exit /b 1
)
echo Vite is ready. Opening Electron now...
call npx electron .
if errorlevel 1 (
  echo.
  echo ERROR: Electron did not start correctly. Read the error above.
)
pause