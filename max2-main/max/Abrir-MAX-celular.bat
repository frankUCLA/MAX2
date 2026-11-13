@echo off
cd /d "%~dp0"
title MAX - Celular
echo.
echo  El tunel del celular ya se inicia SOLO al abrir MAX.exe
echo  Mira la URL en: Admin -^> Licencias -^> URL telefono
echo.
echo  Este .bat es solo respaldo manual.
echo.
pause
node scripts\max-celular-tunnel.js
pause
