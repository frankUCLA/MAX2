@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title MAX — Generar instalador (setup)

echo.
echo ============================================
echo   MAX ERP  —  Generar setup Windows
echo ============================================
echo.
echo  1. Comprueba Node.js / npm
echo  2. Instala dependencias si faltan
echo  3. Empaqueta el sistema con electron-builder
echo  4. Deja el .exe en la carpeta dist-build
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

echo.
echo Node.js:
node -v
echo npm:
call npm -v
echo.

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

for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Get-Content -Raw 'package.json' | ConvertFrom-Json).version"`) do set "APPVER=%%V"
if not defined APPVER set "APPVER=?"

echo.
echo Generando MAX-Setup-%APPVER%.exe ...
echo Espera 1 a 3 minutos. No cierres esta ventana.
echo.

call npm run build:desktop
if errorlevel 1 (
  echo.
  echo ERROR: fallo la generacion del setup.
  echo Cierra MAX.exe si esta abierto y vuelve a ejecutar este .bat
  pause
  exit /b 1
)

set "SETUP=%~dp0dist-build\MAX-Setup-%APPVER%.exe"
echo.
echo ============================================
if exist "%SETUP%" (
  echo   Listo.
  echo   Instalador:
  echo   %SETUP%
) else (
  echo   Build termino. Busca el .exe en:
  echo   %~dp0dist-build\
)
echo ============================================
echo.
echo Pasos siguientes:
echo  1. Copia MAX-Setup-%APPVER%.exe al PC destino
echo  2. Ejecutalo y sigue el asistente de instalacion
echo  3. Abre MAX desde el acceso directo del escritorio
echo.
pause
endlocal
