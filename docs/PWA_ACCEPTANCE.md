# NQ Central: instalación PWA inicial

Implementación sin Service Worker ni caché de aplicación añadida. Necesita conexión.
No cambia autenticación, almacenamiento de sesión existente, permisos ni NFC/QR.

## Iconos provisionales

Los cuatro PNG de `assets/pwa/` son un monograma geométrico NQ oscuro/dorado,
identificado también en sus metadatos como PROVISIONAL. No son un logotipo oficial.
**Pendiente: aprobación visual del propietario o sustitución por sus originales.**

## Rutas y publicación

Manifiesto, entrada e iconos usan rutas relativas para conservar el subdirectorio
de GitHub Pages. Pages está habilitado según el inventario anterior, pero faltan
confirmar URL publicada, rama y carpeta de origen. No se ha publicado este cambio.
La rama de integración requiere además su configuración de backend existente;
la PWA no completa ni modifica esa configuración.

## Prueba local reproducible

Desde la raíz del repositorio, con Node disponible:

```sh
node --test supabase/security-test/pwa-static.test.mjs
```

Comprueba identidad, rutas en raíz/subdirectorio, dimensiones y descompresión de
PNG, marcado provisional y referencias HTML. No demuestra instalación real.

Resultado ejecutado el 2026-10-19: **4/4 pruebas aprobadas, 0 fallidas** con
`node --test supabase/security-test/pwa-static.test.mjs`.
`git diff --check` también terminó sin errores. No se ejecutaron pruebas contra
producción ni staging; no se verificó instalación, actualización o sesión en móvil.

## Estado de entrega

Cambios preparados en `security/nq-central-staging-integration`, sobre
`194e19621b6ccc52d479902af04cc14ba85a3a06`. La comprobación remota coincidió con
ese HEAD antes de editar. El commit se bloqueó porque Git no tiene identidad de
autor configurada; no se inventó ni cambió la identidad. Los archivos quedaron
preparados en el índice, sin publicar. Tras configurar una identidad autorizada:

```sh
git commit -m "feat(pwa): add relative manifest and provisional install icons"
```

## Aceptación pendiente en HTTPS y dispositivos reales

- Android/Chrome: abrir el portal, menú Instalar aplicación o Añadir a inicio;
  comprobar icono y apertura independiente. El texto del menú depende del navegador.
- iPhone/Safari: Compartir, Añadir a pantalla de inicio; comprobar icono y apertura.
- Confirmar que manifiesto e iconos responden correctamente desde la URL publicada.
- Inicio de sesión, recuperación, cierre de sesión, volver atrás y cambio de cuenta:
  no debe reaparecer información del usuario anterior. Probar dos negocios.
- Sin conexión: comprobar error de red; no esperar acceso offline ni estadísticas
  actualizadas. No se añade CacheStorage; comprobar registros previos del origen
  sin borrar cachés ni Service Workers compartidos por otros sitios.
- Actualización: cargar una versión posterior y comprobar los recursos al reabrir;
  la actualización de iconos depende del sistema y puede demorarse.
- Comprobar que los enlaces NFC/QR mantienen su registro y redirección habituales.

La sesión existente de Supabase puede persistir en el navegador: esta propuesta
no elimina ese mecanismo. El alcance del manifiesto no sustituye autorización/RLS.
No considerar la PWA validada hasta completar estas comprobaciones reales.
