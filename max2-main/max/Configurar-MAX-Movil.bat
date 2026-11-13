@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title MAX - Configurar acceso movil

echo.
echo ============================================================
echo   MAX - Configurar acceso movil desde cualquier lugar
echo ============================================================
echo.
echo Este asistente configura Tailscale Funnel con una direccion
echo HTTPS estable. La primera vez requiere iniciar sesion y aprobar
echo el acceso publico en Tailscale.
echo Cierra MAX antes de continuar para que lea la nueva configuracion.
echo.

set "TS_EXE="
if exist "%ProgramW6432%\Tailscale\tailscale.exe" set "TS_EXE=%ProgramW6432%\Tailscale\tailscale.exe"
if not defined TS_EXE if exist "%ProgramFiles%\Tailscale\tailscale.exe" set "TS_EXE=%ProgramFiles%\Tailscale\tailscale.exe"
if not defined TS_EXE for /f "delims=" %%I in ('where tailscale.exe 2^>nul') do if not defined TS_EXE set "TS_EXE=%%I"

if not defined TS_EXE (
  echo Tailscale no esta instalado. Intentando instalarlo con winget...
  where winget.exe >nul 2>nul
  if errorlevel 1 (
    echo.
    echo No se encontro winget. Instala Tailscale desde:
    echo https://tailscale.com/download/windows
    echo Despues vuelve a ejecutar este archivo.
    start "" "https://tailscale.com/download/windows"
    pause
    exit /b 1
  )

  winget install --id Tailscale.Tailscale --exact --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo.
    echo No se pudo instalar Tailscale automaticamente.
    echo Instala Tailscale desde https://tailscale.com/download/windows
    echo y vuelve a ejecutar este archivo.
    start "" "https://tailscale.com/download/windows"
    pause
    exit /b 1
  )

  if exist "%ProgramW6432%\Tailscale\tailscale.exe" set "TS_EXE=%ProgramW6432%\Tailscale\tailscale.exe"
  if not defined TS_EXE if exist "%ProgramFiles%\Tailscale\tailscale.exe" set "TS_EXE=%ProgramFiles%\Tailscale\tailscale.exe"
  if not defined TS_EXE for /f "delims=" %%I in ('where tailscale.exe 2^>nul') do if not defined TS_EXE set "TS_EXE=%%I"
)

if not defined TS_EXE (
  echo.
  echo No encuentro tailscale.exe. Cierra esta ventana, abrela de nuevo
  echo y, si sigue igual, reinicia Windows despues de instalar Tailscale.
  pause
  exit /b 1
)

set "TS_DIR=%~dp0"
for %%I in ("%TS_EXE%") do set "TS_DIR=%%~dpI"
if exist "%TS_DIR%tailscale-ipn.exe" start "" "%TS_DIR%tailscale-ipn.exe"

echo.
echo Inicia sesion en Tailscale en esta PC si aun no lo has hecho.
echo Cuando veas esta PC conectada en Tailscale, vuelve aqui y pulsa una tecla.
pause >nul

call :readDnsName
if not defined TS_DNS (
  echo.
  echo Tailscale aun no esta conectado o no tiene nombre DNS.
  echo Inicia sesion en la ventana de Tailscale y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

echo.
echo Equipo Tailscale detectado: %TS_DNS%
echo.
echo Activando Funnel para MAX en el puerto 3000...
echo Si Tailscale muestra una solicitud de autorizacion, apruebala.
echo.
"%TS_EXE%" funnel --bg http://127.0.0.1:3000
if errorlevel 1 (
  echo.
  echo Tailscale aun no autorizo Funnel o falta activar MagicDNS/HTTPS.
  echo Sigue cualquier enlace o instruccion que aparecio arriba.
  echo En la consola de administracion de Tailscale, activa MagicDNS,
  echo HTTPS Certificates y Funnel para esta PC.
  echo Despues de aprobarlo, pulsa una tecla para intentar otra vez.
  pause >nul
  "%TS_EXE%" funnel --bg http://127.0.0.1:3000
  if errorlevel 1 (
    echo.
    echo No se pudo activar Funnel. No se modifico el archivo .env.
    echo Revisa la autorizacion de Funnel y vuelve a ejecutar este archivo.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
  ) else (
    type nul > ".env"
  )
)

if not exist ".env" (
  echo.
  echo No se pudo crear .env en %CD%.
  pause
  exit /b 1
)

set "MAX_ENV_FILE=%~dp0.env"
set "MAX_MOBILE_DNS=%TS_DNS%"
set "MAX_ENV_BACKUP=%~dp0.env.respaldo"
if exist "%MAX_ENV_BACKUP%" set "MAX_ENV_BACKUP=%~dp0.env.respaldo.%RANDOM%"
if exist ".env" copy /y ".env" "%MAX_ENV_BACKUP%" >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:MAX_ENV_FILE; $lines=@(); if(Test-Path -LiteralPath $p){$lines=Get-Content -LiteralPath $p}; $lines=@($lines | Where-Object {$_ -notmatch '^\s*#?\s*MAX_(TUNNEL_PROVIDER|TUNNEL_TOKEN|MOBILE_URL)='}); $lines+=@('MAX_TUNNEL_PROVIDER=tailscale-funnel','MAX_TUNNEL_TOKEN=','MAX_MOBILE_URL=https://'+$env:MAX_MOBILE_DNS); [IO.File]::WriteAllLines($p,[string[]]$lines,[Text.UTF8Encoding]::new($false))"
if errorlevel 1 (
  echo.
  echo No se pudo guardar la configuracion en .env.
  echo Se conservo una copia de respaldo en %MAX_ENV_BACKUP%.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   CONFIGURACION TERMINADA
echo ============================================================
echo Direccion estable: https://%TS_DNS%/movil.html
echo .env actualizado; respaldo anterior: %MAX_ENV_BACKUP%
echo.
echo Reinicia MAX para que lea la nueva configuracion.
echo Luego abre Admin - Licencias y escanea una vez el QR nuevo.
echo.

if exist "%~dp0MAX.exe" (
  choice /c SN /n /m "Deseas abrir MAX ahora? (S/N): "
  if errorlevel 2 goto done
  start "" "%~dp0MAX.exe"
)

:done
echo Cuando MAX este abierto, la direccion publica estara disponible
echo desde cualquier telefono con internet. Manten esta PC encendida
echo y conectada a internet.
echo.
pause
exit /b 0

:readDnsName
set "TS_DNS="
set "TS_STATUS=%TEMP%\max-tailscale-status-%RANDOM%.json"
set "TS_DNS_FILE=%TEMP%\max-tailscale-dns-%RANDOM%.txt"
"%TS_EXE%" status --json > "%TS_STATUS%" 2>nul
if errorlevel 1 (
  del "%TS_STATUS%" >nul 2>nul
  exit /b 0
)
set "MAX_TS_STATUS_FILE=%TS_STATUS%"
powershell.exe -NoProfile -Command "$j=Get-Content -Raw -LiteralPath $env:MAX_TS_STATUS_FILE | ConvertFrom-Json; if($j.Self.DNSName){$j.Self.DNSName.TrimEnd('.')}" > "%TS_DNS_FILE%"
if exist "%TS_DNS_FILE%" set /p "TS_DNS="<"%TS_DNS_FILE%"
del "%TS_STATUS%" >nul 2>nul
del "%TS_DNS_FILE%" >nul 2>nul
exit /b 0
