@echo off
cd /d "%~dp0"
title MAX - Limpiar sesion atrapada
echo.
echo  Cerrando MAX...
taskkill /IM MAX.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
echo  Borrando cookies de Electron (AppData)...
del /f /q "%APPDATA%\max-erp\Network\Cookies" >nul 2>&1
del /f /q "%APPDATA%\max-erp\Network\Cookies-journal" >nul 2>&1
rmdir /s /q "%APPDATA%\max-erp\Service Worker" >nul 2>&1
rmdir /s /q "%APPDATA%\max-erp\Cache" >nul 2>&1
echo.
echo  Listo. Abre MAX de nuevo e inicia sesion con el usuario de CAJA.
echo.
pause
