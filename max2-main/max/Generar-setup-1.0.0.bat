@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title MAX — Generar instalador 1.0.0

echo.
echo ============================================
echo   MAX ERP  —  Generar setup 1.0.0
echo ============================================
echo.
echo Este instalador no incluye Contabilidad, reportes contables,
echo Promociones ni la terminal Caja Mayor.
echo Los datos y funciones existentes no se borran.
echo.
echo Cierra MAX si esta abierto antes de continuar.
echo.
pause

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: No se encontro Node.js.
  echo Instala Node.js LTS desde https://nodejs.org y vuelve a ejecutar este .bat
  echo.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: No se encontro npm. Reinstala Node.js e intenta de nuevo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Instalando dependencias ^(npm install^)... esto puede tardar.
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: fallo npm install.
    pause
    exit /b 1
  )
)

echo.
echo Generando MAX-Setup-1.0.0.exe ...
echo.
call npm run build:setup:1.0.0
if errorlevel 1 (
  echo.
  echo ERROR: fallo la generacion del setup 1.0.0.
  echo Cierra MAX.exe si esta abierto y vuelve a ejecutar este .bat
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Listo. Busca MAX-Setup-1.0.0.exe en:
echo   %~dp0dist-build-1.0.0\
echo ============================================
echo.
pause
endlocal
