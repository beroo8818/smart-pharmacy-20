@echo off
title Dawa - Build Installer
cd /d "%~dp0"

echo ========================================
echo   Dawa - Build setup.exe
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js not installed. Install Node.js 20.18.1 from:
  echo https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi
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
  echo 5. Double-click build-setup.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\concurrently" (
  echo Installing packages...
  call npm install --no-audit --no-fund --loglevel=error
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist "node_modules\.better-sqlite3-rebuilt" (
  echo Rebuilding better-sqlite3 for Electron...
  call npx --yes electron-rebuild -f -w better-sqlite3
  if errorlevel 1 ( pause & exit /b 1 )
  echo done > "node_modules\.better-sqlite3-rebuilt"
)

echo.
echo Building setup.exe ... 2-5 minutes
echo.
call npm run build:win
if errorlevel 1 (
  echo ERROR: Build failed.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Done! Installer location:
echo   %cd%\release\Dawa-Setup-1.0.0.exe
echo ========================================
explorer "%cd%\release"
pause