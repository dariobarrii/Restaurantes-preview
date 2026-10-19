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

## Pendientes priorizados y bloqueos externos

1. Validación PostgreSQL real de 020/021 (dos pasadas cada una). Falta servidor local/dump o habilitar la alternativa Actions tras aprobación. El workflow nuevo requiere registro en la rama por defecto; no se ha modificado main. Faltan rol/conexión de lectura, CA, digest de imagen y entorno protegido. Vanilla PostgreSQL puede no tener extensiones Supabase; debe abortar sin sustituirlas.
2. Corregir los fallos funcionales reproducibles del portal y los límites de petición de credenciales; actualizar este documento con resultados de cada bloque.
3. Preparar aceptación integral tras resolver contratos/esquema/despliegues; no ejecutar escrituras ahora. El endpoint de producto no está desplegado.
4. Demostrar aislamiento real entre dos usuarios y restaurantes, ciclo de tarjetas/tokens, rate limiting y repetición de solicitudes. Las pruebas unitarias no sustituyen esa evidencia.
5. Importación histórica y espejo solo después de conciliación y aprobación expresa. No importar los 64 eventos de prueba ni alterar fechas/atribuciones ahora.

## Continuación reproducible

1. Verificar HEAD remoto, estado local y rama antes de editar; conservar trabajo posterior.
2. Revisar este documento, el informe y los diffs recientes. Usar Node incluido en el entorno si no está en PATH.
3. Ejecutar solo pruebas locales pertinentes: `node --test supabase/security-test/staging-integration-static.mjs supabase/security-test/admin-creation-local.test.mjs workers/nq-central-card-gateway/src/index.test.mjs` y `node --test supabase/security-test/postgres-plan-local.test.mjs`. Registrar resultados reales.
4. Para PostgreSQL seguir `POSTGRES_ACTIONS_PLAN.md` o `POSTGRES_MIGRATION_VALIDATION.md`. No usar catálogos reconstruidos/mocks como sustituto de un dump/restauración fiel.
5. Actualizar este relevo y hacer commits pequeños. Nunca incluir secretos, dumps privados o logs SQL completos en Git/chat.

Próximo cambio de código recomendado: resolver selección/paginación de negocios en el portal y cubrirlo con pruebas locales que ejecuten el código real; revisar después límites de body y contrato de emisión de credenciales.
