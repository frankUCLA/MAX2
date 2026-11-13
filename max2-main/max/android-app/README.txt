MAX MÓVIL — APK ANDROID 3.0.8
=============================

La app abre MAX en una ventana Android, escanea el QR celular de Admin una sola
vez y guarda la dirección en el teléfono. Cerrar y volver a abrir la app no
borra la vinculación. Android puede restaurar la dirección desde su copia de
seguridad; si no la restaura al reinstalar o borrar los datos, escanea de nuevo.

EN EL SERVIDOR: CONFIGURAR UNA DIRECCIÓN FIJA (RECOMENDADO)
-----------------------------------------------------------

El túnel rápido gratuito de Cloudflare cambia de dirección al reiniciar MAX y
deja inválida la dirección guardada en el teléfono. Para tener un enlace público
HTTPS estable sin comprar un dominio, usa Tailscale Funnel:

1. En el PC servidor, abre `Configurar-MAX-Movil.bat` y sigue las instrucciones.
   El asistente instala Tailscale si hace falta, te guía para iniciar sesión,
   activa Funnel y configura el archivo .env. Si Windows pide permiso de
   administrador para instalar Tailscale, acepta.
2. Si el asistente indica que faltan permisos, abre la consola de administración
   de Tailscale, activa MagicDNS, HTTPS Certificates y Funnel para esta PC, y
   vuelve a ejecutar el asistente.

3. Reinicia MAX. Admin → Licencias debe mostrar el QR permanente como listo.

No necesitas instalar Tailscale en el teléfono: Funnel es público y funciona
desde cualquier conexión a internet. MAX y Tailscale deben estar activos en el
PC servidor. El enlace expone MAX a internet; no compartas el QR públicamente.

ALTERNATIVA: CLOUDFLARE CON DOMINIO PROPIO
------------------------------------------

Si ya tienes un dominio en Cloudflare, configura un Named Tunnel apuntando a
`http://localhost:3000` y guarda el token de forma privada en .env:

   MAX_TUNNEL_PROVIDER=cloudflare
   MAX_TUNNEL_TOKEN=token-del-tunel
   MAX_MOBILE_URL=https://movil.midominio.com

Las tres variables son necesarias. Sin una configuración permanente, MAX
conserva el túnel gratuito y su QR puede cambiar al reiniciar.

INSTALAR Y VINCULAR
-------------------

1. Instala MAX-Movil-3.0.8.apk en Android y permite la cámara.
2. En la app, escanea una vez el QR de Admin → Licencias.
3. Inicia sesión con el usuario administrador de MAX.

En adelante, abre MAX desde su icono; la dirección guardada y la sesión del
navegador integrado persisten al cerrar la app. La cuenta sigue requiriendo
autenticación cuando expire la sesión. La app requiere conexión a internet y
Android 6.0 o posterior.

COMPILAR EN WINDOWS
-------------------

Instala Android Studio y su Android SDK. Abre android-app en Android Studio y
compila con Build → Build APK(s), o ejecuta build-apk.bat desde esta carpeta.
El APK de depuración firmado se copia a dist-build\MAX-Movil-3.0.8.apk.

El instalador de escritorio Windows se genera por separado desde la carpeta
max con Generar-setup.bat y queda en dist-build\MAX-Setup-3.0.10.exe.
