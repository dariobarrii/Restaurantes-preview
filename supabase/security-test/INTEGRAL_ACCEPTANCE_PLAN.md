# Aceptación integral pendiente — orden seguro

Fecha: 2026-10-19. Proyecto exclusivo rxxbmqilnozcnpwguqga. Este procedimiento está preparado; NO se ejecutó. No sustituye pruebas reales con permisos/RLS por pruebas locales.

## Ahora, sin escrituras externas

1. Verificar HEAD remoto y diff de la rama security/nq-central-staging-integration. Leer NQ_CENTRAL_HANDOFF.md y los resultados locales.
2. Resolver POSTGRES_ACTIONS_PLAN.md: autorización de ejecución externa, mecanismo manual registrado, credencial existente exclusivamente de lectura, CA e imagen con dependencias/versiones reales. No publicar dumps.
3. Validar 020 dos veces y 021 dos veces en clon PostgreSQL 17 fiel. Revisar ACL/propietarios/defaults/secuencias y diferencias de catálogo. No aplicar en staging.
4. Revisar preflight y plan de reversión existentes con los resultados de PostgreSQL antes de solicitar aplicación.

## Después de autorizaciones nuevas y explícitas

Estas operaciones NO están autorizadas por esta jornada: aplicar migraciones en staging, configurar o desplegar funciones/Worker/web, modificar datos y ejecutar fixtures. Solicitar aprobación de los SHA/SQL/operaciones concretos.

1. Confirmar nuevamente identidad del proyecto. Ejecutar preflights solo de lectura y comparar cambios desde el informe.
2. Tras aprobación, aplicar 020/021 de manera controlada siguiendo su reversión y comprobaciones. No importar 64 históricos ni crear espejo en este paso.
3. Tras aprobación separada, desplegar y configurar las funciones administrativas y de credenciales; después la ruta de registro y gateway. Nunca conectar endpoints E2E como producto. Mantener secreto del gateway exclusivamente servidor.
4. Ejecutar fixture solo con autorización de escrituras y credenciales en entorno privado, nunca argumentos/chat/Git:

   `node supabase/security-test/staging-acceptance.mjs --project rxxbmqilnozcnpwguqga --keep`

   Revisar primero la implementación: IDs, firmas completas, marcas exactas y comprobación de restauraciones. Ante fallo, conservar evidencia privada; no ejecutar limpieza amplia. Este fixture no sustituye el recorrido público real.
5. Con dos usuarios y dos negocios, comprobar lectura aislada, escrituras directas denegadas, autoaprobación/promoción denegadas y gestión administrativa permitida solo a admin aprobado. Probar login, renovación/cierre de sesión, recuperación en la misma ruta de staging y ausencia de caché anterior tras cambiar usuario.
6. Probar crear/editar/pausar/archivar tarjetas, label/category nulos, IDs inexistentes, errores de base y negocio no aprobado. Registrar HTTP y estado final; un 200 no prueba una modificación correcta.
7. Emitir/rotar/revocar tokens por la función autenticada. Mantener tokens originales solo temporalmente en memoria del operador; verificar que el anterior deja de registrar/redirigir. NFC y QR se derivan de su tarjeta, nunca de business_id suministrado por el navegador.
8. Invocar el gateway desde el origen aprobado: token válido/inválido/revocado/otra tarjeta; estados activos/pausados/archivados; destino HTTPS sin credenciales; acceso directo a Edge rechazado. Comprobar conteos antes/después por negocio y canal, sin redirección en fallos.
9. Límites distintos: Worker por cliente (por punto de presencia), global RPC 600/60 segundos y tarjeta según SQL. Probar fallo del limitador y upstream. No asumir protección global por cliente ni idempotencia duradera: no hay identificador persistente de intento; una repetición posterior a la ventana puede registrar otro evento. Definir contrato antes de añadir reintentos automáticos.
10. Crear cantidades conocidas solo dentro del fixture autorizado y contrastar diarios/semanales/mensuales/históricos, gráfico NFC/QR y CSV. Seleccionar el segundo negocio, cambiar rápido de negocio y cerrar sesión durante la carga. Más de 50.000 eventos genera error explícito; necesita agregación servidor antes de crecer más.
11. Guardar apertura/cierre de reseñas como owner/manager y probar viewer/otro negocio; verificar la captura más reciente de cada tipo, restricciones de columnas y restauración del perfil tras cada caso aislado.
12. Histórico: usar conciliación agregada antes/después de una importación futura expresamente aprobada; preservar fecha/negocio/canal, excluir ambigüedades y no repetir legacy_event_id. No importar ni crear trigger ahora.
13. Solo tras revisar firmas completas y resultados, limpieza limitada del fixture autorizado:

   `node supabase/security-test/staging-acceptance.mjs --project rxxbmqilnozcnpwguqga --cleanup`

   Cualquier discrepancia o restauración fallida es bloqueo crítico. Verificar ausencia de los registros propios y conservación de los ajenos. No guardar credenciales ni filas privadas en resultados públicos.

## Evidencia requerida

Por caso: SHA, proyecto, identidad/rol de prueba sin credenciales, solicitud redactada, HTTP, conteos/estado final y restauración. Estados independientes: aprobado, fallido, pendiente. Aislamiento comercial y NFC/QR integral permanecen pendientes hasta obtener esta evidencia real.

card-flow-smoke.mjs sigue siendo un harness antiguo y no prueba el gateway actual. card-browser-smoke.mjs fue reemplazado por un harness offline del scanner/Worker/Edge actuales, con cliente SQL sustituido y todas las peticiones interceptadas. Ver BROWSER_LOCAL_TESTS.md. Ninguno demuestra RPC/RLS desplegado.
