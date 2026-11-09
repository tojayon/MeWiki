@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.13 或更新的受支持版本，再打开此文件。
  pause
  exit /b 1
)
node scripts/start-mewiki.mjs
if errorlevel 1 pause
