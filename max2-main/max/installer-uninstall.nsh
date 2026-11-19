!macro customInstall
  ; Solo una instalacion nueva crea el marcador desde Electron.
  ; Reinstalar o actualizar conserva la contraseña ya configurada.
!macroend

!macro customUnInstall
  ; No borrar datos ni marcar una contraseña como pendiente al desinstalar.
  ; $APPDATA\MAX, la base de datos y la configuración siguen disponibles.
!macroend
