# NQ Central — Checklist de validación web
Estado: pendiente de ejecutar. Este documento no certifica resultados.

## Seguridad y despliegue
- [ ] Mantener cambios en feature/nq-web-finalizacion; no fusionar a main sin revisión.
- [ ] No ejecutar migraciones ni modificar producción sin respaldo y autorización.
- [ ] No guardar secretos, contraseñas ni tokens privados.

## Autenticación
- [ ] Acceso de usuarios aprobados y rechazo de pendientes.
- [ ] Cierre de sesión y restauración correcta de sesión.
- [ ] Recuperación desde login y ajustes, usando enlace al entorno correcto.
- [ ] Probar enlace caducado, sesión de recuperación, nueva contraseña y nuevo inicio de sesión.
- [ ] Cambio de perfil, correo y contraseña; verificar persistencia.

## Permisos
- [ ] Un restaurante no puede consultar ni modificar datos de otro, incluso mediante peticiones manuales.
- [ ] Accesos sin sesión rechazados y RLS validada.

## NFC, QR y métricas
- [ ] NFC y QR registrados por separado; tokens inválidos o revocados rechazados.
- [ ] Redirección a Google Maps correcta.
- [ ] Totales diarios, 7 días, 30 días e históricos coinciden con la base.
- [ ] Verificar zona horaria, datos vacíos y errores.
- [ ] Distinguir interacciones de reseñas reales.

## Experiencia de usuario
- [ ] Probar 320px, 375px, tablet y escritorio.
- [ ] Navegación accesible y sin desbordes críticos.
- [ ] Revisar errores JS, estados de carga y formularios.
- [ ] Comprobar URLs autorizadas de Supabase Auth.

## Registro
Por cada incidencia: fecha, entorno, pasos, esperado, obtenido y evidencia sin datos personales.