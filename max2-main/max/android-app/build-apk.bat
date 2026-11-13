@echo off
setlocal
cd /d "%~dp0"

if not defined ANDROID_HOME if defined ANDROID_SDK_ROOT set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
if not defined ANDROID_HOME (
  echo ERROR: Instala Android Studio y configura ANDROID_HOME.
  exit /b 1
)

call gradlew.bat assembleDebug
if errorlevel 1 exit /b 1

if not exist "..\dist-build" mkdir "..\dist-build"
copy /Y "app\build\outputs\apk\debug\app-debug.apk" "..\dist-build\MAX-Movil-3.0.8.apk" >nul
if errorlevel 1 exit /b 1

echo APK listo: %~dp0..\dist-build\MAX-Movil-3.0.8.apk
endlocal
