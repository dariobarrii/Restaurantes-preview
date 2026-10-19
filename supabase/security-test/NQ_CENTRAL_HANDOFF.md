# NQ Central — relevo técnico

Actualizado: 2026-10-19. Rama exclusiva: `security/nq-central-staging-integration`, repositorio `dariobarrii/Restaurantes-preview`. HEAD remoto verificado al iniciar esta jornada: `d5bb53dc20796db4f8a3845a1a2a123ad982088e`. Este documento se versiona con cada bloque; para conocer el HEAD actual usar `git ls-remote origin refs/heads/security/nq-central-staging-integration`, no asumir que la referencia anterior sigue siendo la última.

## Estado y límites

Staging autorizado: NQ Central Security Test, `rxxbmqilnozcnpwguqga`, PostgreSQL 17.11. Solo lectura en staging en esta fase. Modificaciones de código, commits y pruebas locales autorizados. NO aplicar migraciones, escribir fixtures/datos de staging, desplegar, importar históricos, crear triggers, hacer merge o tocar producción. Los workflows requieren autorización adicional incluso si son gratuitos.

El sistema NO está listo para lanzamiento. No se ha demostrado aún la autorización/aislamiento con dos usuarios reales ni el flujo NFC/QR integral. 020/021 siguen sin ejecutarse en PostgreSQL real. Consultar `STAGING_VALIDATION_2026-10-19.md` y `results/2026-10-19-staging-readonly.json`; no repetir esos preflights salvo cambio de esquema o necesidad concreta.

## Arquitectura y fuentes principales

- `index.html`: acceso, recuperación, portal de negocio, panel administrador, estadísticas, reseñas, tarjetas y exportaciones. Configuración externa de staging; ninguna clave privilegiada en el navegador.
- `supabase/functions/manage-business-administration/index.ts`: operaciones administrativas autenticadas, getUser + perfil admin/approved en servidor. UUID de nuevos negocios/tarjetas generado en servidor; no depende de defaults ausentes en staging.
- `supabase/functions/manage-business-card-token/index.ts`: emisión/rotación/revocación, hash SHA-256 y token original entregado solo al administrador aprobado.
- `card.html` → `workers/nq-central-card-gateway/src/index.mjs` → `supabase/functions/register-business-card-event/index.ts` → RPC de registro. El negocio y canal deben derivarse de la tarjeta en servidor. Las funciones E2E/secure-test NO son rutas de producto.
- SQL `016` registro seguro, `017` importación idempotente, `018` espejo genérico, `019` restricciones anónimas ya registradas en staging, `020` compatibilidad nullable/defaults, `021` retiro coordinado de escrituras de navegador.
- `supabase/security/`: preflights de solo lectura, conciliación y reversión. `supabase/security-test/staging-acceptance.mjs`: fixture con escrituras; preparado pero PROHIBIDO ejecutarlo ahora.

## Pruebas y cambios completados

En d5bb53d se ejecutaron realmente Node 24.19.0: 24 pruebas estáticas + 5 del handler administrativo con cliente sustituido + 9 unitarias del Worker = 38/38, y sintaxis del fixture. Los tres preflights de staging se ejecutaron sin error SQL; eso no aprueba sus hallazgos. 64 históricos elegibles: 62 NFC/2 QR, cero importados. No hay espejo, faltan category/label, defaults bigint y despliegues de producto. Hay grants excesivos y acceso público a target_url pendientes de corregir en la base tras las autorizaciones correspondientes.

Bloque PostgreSQL preparado esta jornada: workflow manual sin triggers push/PR, runner con PostgreSQL 17.11 real, exportación read-only privada, preservación de roles/ACL y bloqueo por dependencias ausentes. `postgres-plan-local.test.mjs` contiene 4 pruebas puras de guards: no simulan PostgreSQL ni ejecutan Docker. Ver `POSTGRES_ACTIONS_PLAN.md`.

Bloque portal completado: `nq-central-data.mjs` y `index.html` preservan el negocio seleccionado, paginan con count exacto y orden estable por fecha/id, detectan respuestas truncadas/repetidas y rechazan historiales >50.000 sin publicar totales parciales. Todas las páginas filtran business_id en Supabase. La ventana de lectura usa una fecha máxima fija; no es un snapshot transaccional, por lo que cambios concurrentes detectados deben reintentarse. Se descartan respuestas antiguas tras cambiar de negocio/cerrar sesión, se limpian cachés/formularios y se deshabilita exportación durante cargas/fallos. CSV tiene BOM/saltos reales y neutralización de fórmulas. La agrupación diaria de reseñas elige la captura más reciente en cada canal. Recuperación desde ajustes usa la misma ruta de staging que el formulario de login. `portal-data-local.test.mjs`: 9/9 pruebas locales aprobadas, incluidas llamadas al loadClient real en VM con API sustituida (no RLS). Las dos regresiones iniciales del portal fallaron antes de la corrección. La suite estática existente sigue 24/24.

## Pendientes priorizados y bloqueos externos

1. Validación PostgreSQL real de 020/021 (dos pasadas cada una). Falta servidor local/dump o habilitar la alternativa Actions tras aprobación. El workflow nuevo requiere registro en la rama por defecto; no se ha modificado main. Faltan rol/conexión de lectura, CA, digest de imagen y entorno protegido. Vanilla PostgreSQL puede no tener extensiones Supabase; debe abortar sin sustituirlas.
2. Límites de credenciales/scanner y fallos de selección/paginación/carreras del portal corregidos localmente; falta probar sus recorridos reales. Para historiales >50.000, diseñar agregación servidor por business_id antes de ampliar límites del navegador.
3. Preparar aceptación integral tras resolver contratos/esquema/despliegues; no ejecutar escrituras ahora. El endpoint de producto no está desplegado.
4. Demostrar aislamiento real entre dos usuarios y restaurantes, ciclo de tarjetas/tokens, rate limiting y repetición de solicitudes. Las pruebas unitarias no sustituyen esa evidencia.
5. Importación histórica y espejo solo después de conciliación y aprobación expresa. No importar los 64 eventos de prueba ni alterar fechas/atribuciones ahora.

## Continuación reproducible

1. Verificar HEAD remoto, estado local y rama antes de editar; conservar trabajo posterior.
2. Revisar este documento, el informe y los diffs recientes. Usar Node incluido en el entorno si no está en PATH.
3. Ejecutar solo pruebas locales pertinentes: `node --test supabase/security-test/staging-integration-static.mjs supabase/security-test/admin-creation-local.test.mjs workers/nq-central-card-gateway/src/index.test.mjs` y `node --test supabase/security-test/postgres-plan-local.test.mjs`. Registrar resultados reales.
4. Para PostgreSQL seguir `POSTGRES_ACTIONS_PLAN.md` o `POSTGRES_MIGRATION_VALIDATION.md`. No usar catálogos reconstruidos/mocks como sustituto de un dump/restauración fiel.
5. Actualizar este relevo y hacer commits pequeños. Nunca incluir secretos, dumps privados o logs SQL completos en Git/chat.

El límite de body y el scanner quedaron completados en el bloque siguiente; no repetir salvo regresión.

## Bloque credenciales y scanner completado

Se limita la lectura en streaming de credenciales a 4096 bytes antes de autenticar; se cancelan cuerpos excesivos con HTTP 413 y se rechazan campos inesperados. No se cambió el contrato issue/rotate: el panel usa rotate también para la primera emisión mediante upsert. Administración devuelve 413 también cuando el exceso llega por streaming. Registro exige application/json y solo devuelve campos de error permitidos, sin mensajes de proveedor en logs. card.html elimina el fragmento de credencial antes de validar configuración, incluso cuando el gateway falta, y no redirige ante errores o destinos inseguros.

Resultados reales de esta jornada: 66/66 Node (24 estáticas, 6 handler administrativo, 9 Worker, 4 guards del plan PostgreSQL, 9 portal, 7 credenciales/registro, 7 scanner). Sintaxis de staging-acceptance.mjs aprobada. Comando completo y salida: results/2026-10-19-continuation-node-tests.txt. Las pruebas de handlers usan clientes sustituidos; no prueban RLS ni PostgreSQL. Las del scanner ejecutan el script actual en VM sin red. El fixture de integración NO se ejecutó y no se modificaron datos de staging. No se lanzó workflow ni se aplicó SQL. Las migraciones 020/021 no se modificaron en esta jornada: su validación real sigue bloqueada.

Preparado INTEGRAL_ACCEPTANCE_PLAN.md con orden de aceptación, evidencia requerida, límites de cada suite y operaciones que requieren aprobación. No volver a usar los smoke antiguos como evidencia del scanner actual.

Próximo cambio recomendado actualizado: definir un contrato de request_id persistente entre scanner, gateway, Edge y RPC si se requiere idempotencia de reintentos; revisar todos los consumidores y diseñar migración separada antes de implementarlo. El límite temporal actual por tarjeta no es idempotencia duradera. Antes de lanzamiento también hace falta prueba PostgreSQL concurrente de pausa/revocación durante registro y aislamiento real de los dos negocios. Las pruebas locales de autorización no cubren esos casos.


## Referencias verificadas al cerrar los bloques

Commits remotos publicados únicamente en la rama autorizada:
- ecad27ff377a4dd1a240d602d1c98f1073d21a61: plan PostgreSQL/Actions y relevo inicial.
- 82d1161faa44a89b91a38be88599546f13bfc710: selección/paginación/CSV/reseñas y aislamiento de caché de sesión.
- 6570e5d8f62a8f5efa1f6dc420f1aa2e03a9ba3a: credenciales, respuestas del registro, scanner, 66 pruebas y aceptación preparada.

Este relevo se guarda en un commit documental posterior; resolver HEAD en GitHub antes de continuar. Árboles remotos comparados con los commits locales revisados, sin sobrescribir cambios posteriores. No hubo consultas nuevas ni escrituras en Supabase durante esta continuación; los tres preflights pertenecen al informe previo.

## Continuacion critica: administracion y perfil

Base remota verificada: 65cea5ce888885598f2a69f658af2804d7d58d9c. PostgreSQL/psql/pg_dump/Docker siguen sin estar disponibles; wsl.exe existe pero confirma que el subsistema no esta instalado. No se instalaron herramientas ni se ejecuto SQL. Actions sigue preparado y bloqueado por autorizacion/requisitos del plan.

Corregida lectura administrativa truncada con caps inferiores a 1000: count exacto obligatorio, offsets segun filas recibidas, clave unica/orden estable y rechazo de conteos variables/duplicados/truncamiento/mas de 50.000. No representa snapshot transaccional: cambios concurrentes deben reintentarse. Se mantienen las respuestas de consumidores, con id adicional en eventos/reseñas para paginacion. Los diez actions rechazan usuarios no aprobados/no admin antes de operar; autoaprobacion y campo role rechazados por pruebas del handler real con cliente sustituido. Tambien se comprueba application/json y longitud de bearer.

Perfil: una actualizacion sin filas podia presentarse como exito y cambiar metadata aunque RLS impidiera el cambio de perfil. Ahora requiere SELECT de user_id/full_name y confirmacion de la fila exacta antes de metadata. Compatible con UPDATE(full_name) y SELECT previstos en 021; requiere prueba RLS real. Regresiones reproducidas antes del cambio (2 lecturas administrativas y 2 casos de perfil), despues 34/34 admin+estaticas y 3/3 perfil aprobadas. Sin escrituras ni fixtures de staging.
