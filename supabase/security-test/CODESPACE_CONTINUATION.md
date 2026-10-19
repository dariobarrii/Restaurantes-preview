# Continuar PostgreSQL en el Codespace existente

Estado: el propietario confirmo el contenedor **nq-central-pg-validation**, PostgreSQL 17.11, en `/workspaces/Restaurantes-preview` de su Codespace y un precheck aprobado. Registro privado indicado: `$RUNNER_TEMP/nq-postgres-validation/local-version.private.log`. Codex no tiene acceso a ese Docker ni inspecciono el log. El precheck informado NO valida dump, restore, 020/021 ni RLS.

No crear otro Codespace, cambiar facturacion o instalar herramientas para repetir ese paso. No ejecutar estas instrucciones contra Supabase. Todo SQL de escritura pertenece solo al contenedor descartable verificado. No eliminar datos/volumenes ni contenedores ajenos. No compartir URLs con contrasenas ni logs privados.

## Antes de continuar, en terminal privada del Codespace

1. Comprobar rama, HEAD y cambios locales. Debe estar la revision final de esta jornada; conservar cualquier cambio posterior. Si hay divergencias, detenerse sin reset ni merge forzado. Revisar el diff de postgres-validation.mjs y postgres-clone-snapshot.sql.
2. Confirmar que el contenedor nombrado es el descartable propio y resolver su ID hexadecimal, que el script exige:

   `export NQ_PG_CONTAINER="$(docker inspect --format '{{.Id}}' nq-central-pg-validation)"`

3. Confirmar RUNNER_TEMP existente/privado fuera del checkout, imagen por digest aprobada, etiqueta de sandbox, ausencia de puertos/binds, version y autorizacion de entorno. El script comprueba CODESPACES, repositorio y branch/origin reales. No falsear GITHUB_ACTIONS. No asumir que un precheck de otra revision cubre estos nuevos controles.
4. Confirmar que el cluster de validacion no contiene un restore previo parcial. La restauracion crea roles y objetos: no es un comando de reparacion ni se repite sobre una base parcialmente restaurada. Si hay residuos, preparar recuperacion solo del sandbox propio; no ejecutar limpiezas amplias.

## Exportacion privada: solo lectura de staging

Necesita conexion SQL de lectura y CA ya configuradas de forma privada. No crear roles ni conceder permisos en staging. Si faltan, reportar el bloqueo. El script exige project ref rxxbmqilnozcnpwguqga y verify-full; rechaza credenciales de propietario como atajo. Quiescencia de cambios DDL durante el export: roles, catalogo y pg_dump se capturan en conexiones separadas; no hay snapshot distribuido de todo el cluster.

`node supabase/security-test/postgres-validation.mjs precheck`

`node supabase/security-test/postgres-validation.mjs export`

El export nuevo crea metadata.json, roles.sql, source-catalog.json y schema.sql solo en el directorio privado. Mantiene ACL/propietarios y no exporta filas. Un dump antiguo sin source-catalog.json no satisface la nueva comprobacion: no fabricar ese archivo desde el clon ni eliminar el gate. No subir archivos o logs privados a Git/chat/artefactos.

## Solo contra el contenedor local descartable

Retirar variables de conexion remota del entorno antes de cualquier restore:

`unset NQ_STAGING_READONLY_DB_URL NQ_STAGING_CA_PEM PGDATABASE PGHOST PGSERVICE PGPASSWORD PGUSER PGPORT PGOPTIONS`

`node supabase/security-test/postgres-validation.mjs isolate`

`node supabase/security-test/postgres-validation.mjs validate`

La validacion usa socket /var/run/postgresql, DB nq_validation y usuarios locales explicitos; exige contenedor marcado y sin red. Compara version/extensiones/ICU/preloads/propietarios y el catalogo restaurado frente al **origen**, antes de permitir 020/021. Compara las dos pasadas de cada migracion despues. El snapshot incluye private.app_is_admin(), hash de cuerpos sensibles sin devolverlos, ACL de base/default y RLS. Un hash no demuestra comportamiento funcional.

Si hay cualquier diferencia/error, estado BLOQUEADO. No quitar grants, cambiar propietarios de forma arbitraria, vaciar politicas o sustituir funciones para conseguir verde. Revisar causa privadamente. No volver a ejecutar restore sobre estado parcial.

`node supabase/security-test/postgres-validation.mjs cleanup`

Cleanup elimina solo los archivos del directorio privado validado; no elimina automaticamente el contenedor, volumenes ni Codespace. Conservar solo evidencia agregada saneada necesaria antes de borrar logs propios. La gestion del contenedor propio debe seguir el plan de pruebas autorizado, sin afectar recursos ajenos.

## Evidencia para continuar

Compartir solo: SHA, version real, resultado restore/cotejo de catalogo, 020 primera/segunda, 021 primera/segunda, resultado de cada verificacion y mensaje generico del bloqueo. No pegar SQL/logs privados. Incluso un resultado aprobado de este clon no autoriza migraciones/despliegues/datos en staging y no demuestra RLS con dos negocios ni NFC/QR integral.

Desde este entorno solo se planifico el SELECT del snapshot actualizado con EXPLAIN sin ANALYZE en staging confirmado: valido sintacticamente, sin ejecutar migraciones ni leer filas de aplicaciones. Las pruebas PostgreSQL anteriores siguen pendientes de ejecucion en el Codespace.
