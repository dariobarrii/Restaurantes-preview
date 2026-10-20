# NQ Business — comprobaciones antes de publicar

Estado: **pendiente de ejecución real**. Esta lista no implica que las pruebas estén superadas.

## Cambios aislados
- Rama: `feature/nq-business-naming`; `main` sin modificar.
- El proyecto de Supabase utilizado en este repositorio de pruebas es `qcvhxrudzjlgqlhvnkkl`.
- La base de datos de la web principal sigue sin confirmarse.
- No modificar claves, tokens, rutas NFC/QR, ni tablas en este proceso de interfaz.

## Casos de prueba prioritarios
1. Usuario miembro de restaurante: muestra **NQ Restaurant** y únicamente sus negocios aprobados.
2. Miembro de peluquería/estética: muestra **NQ Beauty**.
3. Miembro de gimnasio: muestra **NQ Fitness**.
4. Miembro de negocio de otra categoría: muestra **NQ Business**.
5. Usuario con dos negocios: seleccionar el segundo, actualizar datos y comprobar que permanece seleccionado.
6. Usuario sin negocio aprobado: título **Sin negocio asignado**, contadores a cero, sin identidad visual del negocio anterior.
7. Administrador: acceso a gestión de tarjetas y negocios sin regresiones.
8. Cliente: no aparecen controles para activar/desactivar tarjetas NFC ni QR; solicitudes de cambios únicamente al administrador.
9. Comparar conteos NFC y QR contra la fuente correspondiente, sin equiparar interacciones con reseñas confirmadas.
10. Verificar login, logout, recuperación de contraseña, aislamiento por negocio y visualización móvil.
11. Revisar consola, peticiones fallidas, RLS y comportamiento de conexión lenta.
12. Confirmar fuente de datos de la web principal antes de cualquier migración o publicación.

## Riesgos conocidos
- La revisión de código no sustituye pruebas con usuarios reales de distintos roles.
- El código de pruebas consulta `nfc_events` para compatibilidad histórica; revisar visibilidad y aislamiento por negocio.
- No asumir que la rama es una versión lista para publicar hasta completar la regresión.
