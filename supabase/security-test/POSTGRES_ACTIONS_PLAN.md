# PostgreSQL 17 real en GitHub Actions — preparado, NO ejecutado

Repositorio público confirmado: dariobarrii/Restaurantes-preview. Un runner Linux estándar de GitHub Actions es gratuito para repositorios públicos según [la documentación de facturación](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Se mantiene el requisito del propietario de autorizar cada ejecución externa. No se ha lanzado ningún workflow ni configurado secretos, variables o entornos.

## Alternativa preparada

`.github/workflows/postgres-staging-validation.yml` solo tiene workflow_dispatch, un guard de repositorio/rama y una confirmación literal. Usa sintaxis JSON, válida como YAML, para poder parsearla localmente sin instalar dependencias. No se dispara por push/PR. Usa un PostgreSQL 17.11 real descartable, sin puertos publicados y con usuario bootstrap separado de postgres. Verifica un digest oficial aprobado antes de suministrar una conexión de staging. El dump completo es schema-only, conserva propietarios/ACL/default ACL; los roles y membresías se obtienen de catálogos sin contraseñas. No hay datos de aplicación.

`postgres-validation.mjs export` valida el project ref en host directo o usuario de session pooler, puerto 5432, base postgres, rol dedicado de lectura y TLS verify-full. Emite solo SELECT de metadatos y pg_dump --schema-only con default_transaction_read_only=on. Rechaza un rol con BYPASSRLS/superusuario o escrituras efectivas. No crea roles ni concede privilegios en staging.

Los dumps, metadatos completos, roles y errores SQL se guardan con permisos privados exclusivamente en RUNNER_TEMP y se eliminan en always(). No se suben a Git, logs públicos ni artefactos. Solo se publica un resultado genérico y una huella del catálogo. Las credenciales se suministran exclusivamente al paso de exportación; la restauración y las migraciones usan docker exec con base/usuario locales explícitos, sin URL ni credenciales de staging en su entorno.

La restauración conserva atributos del propietario: postgres de staging no es superusuario y tiene BYPASSRLS. Se detiene ante extensiones/versiones ausentes o configuraciones de rol no revisadas; no crea funciones ni esquemas sustitutos. Después de una restauración fiel, ejecuta 020 dos veces y 021 dos veces como el propietario postgres, compara snapshots de columnas/políticas/permisos y aplica las verificaciones internas de cada migración. Esto prueba el esquema exportado sin datos, no los límites bigint con datos ni la aceptación NFC/QR integral.

## Bloqueos que siguen abiertos

1. **Registro del workflow:** [GitHub exige que workflow_dispatch exista en la rama por defecto](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow). Este archivo nuevo está solo en la rama de integración y no se ha modificado main. No prometer un botón Run disponible. Hace falta una decisión autorizada sobre su registro en main o sobre otro mecanismo de lanzamiento explícito; ninguna de esas operaciones se realizó.
2. **Credencial de lectura:** debe existir un rol capaz de exportar el esquema, ver catálogos/roles/membresías y tomar locks de lectura, sin escrituras ni BYPASSRLS. Si no existe, crearlo/conceder permisos en staging requeriría nueva autorización. No usar postgres o service_role como atajo.
3. **Entorno protegido:** el propietario debe configurar `nq-postgres-validation` con aprobación obligatoria y solo la rama autorizada. Secretos privados: `NQ_STAGING_READONLY_DB_URL` y `NQ_STAGING_CA_PEM`. No enviar sus valores en chat/Git. El CA debe ser el de la conexión aprobada de Supabase; no desactivar la verificación TLS.
4. **Imagen:** revisar el digest real de la imagen oficial `postgres:17.11` y configurar `NQ_APPROVED_POSTGRES_DIGEST` con `sha256:...`. No se inventó ni configuró un digest. Si el tag no existe o cambia, el precheck debe bloquear.
5. **Extensiones y roles:** PostgreSQL vanilla puede carecer de extensiones administradas de Supabase. El workflow comprobará versiones disponibles y fallará antes del restore. Si ocurre, se necesita una imagen PostgreSQL 17 con esas dependencias reales, revisada y fijada por digest; no sustituirlas por mocks. Los settings de rol desconocidos se bloquean antes del dump y requieren revisión privada, sin copiar secretos.
6. **Validación pendiente:** el workflow, Docker, exportación, restore y SQL no se ejecutaron. Solo se comprobaron localmente la sintaxis JavaScript, el YAML y los guards puros. No se declara PostgreSQL validado.

## Orden posterior, solo tras autorización de ejecución externa

1. Resolver los puntos anteriores sin cambiar producción, y registrar el mecanismo manual de lanzamiento autorizado.
2. Revisar el SHA de la rama y el digest; confirmar proyecto rxxbmqilnozcnpwguqga.
3. Lanzar el workflow únicamente en security/nq-central-staging-integration con authorization=APPROVED_POSTGRES_VALIDATION. El comando de dispatch solo será utilizable cuando GitHub tenga registrado el workflow:

   `gh workflow run postgres-staging-validation.yml --ref security/nq-central-staging-integration -f authorization=APPROVED_POSTGRES_VALIDATION`

4. Revisar resultado y huella, sin publicar dumps/logs privados. Un bloqueo de dependencias no equivale a un fallo de las migraciones.
5. Tras pasar PostgreSQL real, solicitar por separado cualquier aplicación de migraciones o despliegue en staging. Este workflow nunca los realiza.


## Revision de esta continuacion

Se amplio el snapshot local con flags RLS, permisos EXECUTE/propietarios/SECURITY DEFINER, triggers y ACL por defecto. La prueba local solo verifica que esas comprobaciones estan preparadas; no parsea ni ejecuta SQL. El entorno sigue sin PostgreSQL/Docker/WSL instalado ni exportacion fiel. Restaurar membresias con GRANTED BY puede requerir ordenar dependencias administrativas reales: cualquier error debe bloquear, sin quitar grantors ni elevar el propietario. No se ejecuto el workflow. La validacion de 020/021 sigue pendiente.

## Decision actualizada: Codespace temporal, no Actions

Ver POSTGRES_UNBLOCK_DECISION.md. Se recomienda una unica ruta: Codespace desde esta rama, sujeto a cuota gratuita y bloqueo efectivo de gastos, autorizacion externa, imagen oficial Supabase PG17.11 por digest y exportacion privada fiel. No se creo ni ejecuto. El workflow Actions queda como alternativa experimental sin ejecucion; su servicio vanilla y entrypoint no resuelven la clonacion Supabase y requieren revision antes de usarlo. No modificar main para desbloquearlo.

El script acepta Codespaces solo con autorizacion explicita y verificacion real de rama/origin. Preserva ajustes/ACL de base (que pg_dump sin --create omite), compara ICU/preloads y propietarios de extensiones. Nuevos gates detectan problemas en vez de asumir fidelidad. isolar la red exige contenedor marcado, sin puertos ni binds. Ningun gate tiene evidencia Docker/PostgreSQL ejecutada. Se verificaron en staging unicamente dependencias/locale por SELECT, no el dump ni privilegios de un exportador existente.
