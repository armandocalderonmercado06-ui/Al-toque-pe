@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo No se encontro Node.js. Instala Node.js 20.6 o posterior y vuelve a intentarlo.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:4173"
node --env-file-if-exists=.env server.mjs
if errorlevel 1 (
  echo.
  echo No se pudo iniciar Al Toque. Revisa el mensaje anterior.
  pause
)
