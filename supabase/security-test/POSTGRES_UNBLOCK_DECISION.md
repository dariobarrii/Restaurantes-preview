# PostgreSQL 17: decision y ejecucion pendiente

Fecha: 2026-10-19. Base b6811d7ad9e459757236ec0f64f18c613b2e96aa. Ningun Codespace, contenedor, workflow, exportacion o SQL de escritura fue ejecutado en esta fase.

## Recomendacion unica

Un GitHub Codespace temporal, abierto en el navegador desde security/nq-central-staging-integration, con un contenedor PostgreSQL 17.11 de la distribucion oficial Supabase fijado por digest y un cluster limpio separado. No levantar todo el stack Supabase. No instalar herramientas en la PC ni modificar main. Solo crear el Codespace despues de verificar cuota gratuita suficiente y un bloqueo efectivo de gasto adicional; si no puede demostrarse costo cero, no crearlo.

[Codespaces permite elegir una rama](https://docs.github.com/en/codespaces/developing-in-a-codespace/creating-a-codespace-for-a-repository). [La cuota gratuita depende de la cuenta y los excesos se facturan](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces). No se comprobo la cuota privada ni se configuro facturacion.

| Mecanismo | Viabilidad bajo los limites actuales |
|---|---|
| PostgreSQL local existente | Bloqueado: no servidor, clientes, Docker ni WSL instalado; no se instalaran |
| Actions nuevo con workflow_dispatch | Bloqueado por registro en default branch, autorizacion y dependencias; no tocar main para habilitarlo |
| Codespace temporal desde esta rama | Recomendado, condicionado a cuota/costo cero, autorizacion externa y dependencias exactas; no necesita main ni instalacion local |
| Nueva base externa/Supabase branch | Recurso externo, permisos/gastos no demostrados y posible copia de datos; descartado en esta fase |
| PostgreSQL vanilla o esquema reconstruido | No demuestra compatibilidad fiel de Supabase; no usarlo para aprobar 020/021 |

## Evidencia nueva obtenida en staging, solo SELECT de catalogos

Proyecto confirmado por API: NQ Central Security Test, ref rxxbmqilnozcnpwguqga, ACTIVE_HEALTHY, build reportado 17.11.0.003. SQL confirma server_version_num=170011.

- Extensiones: pg_stat_statements 1.11 en extensions; pgcrypto 1.3 en extensions; plpgsql 1.0 en pg_catalog; supabase_vault 0.3.1 en vault; uuid-ossp 1.1 en extensions.
- session_preload_libraries: supautils.
- Bibliotecas shared: auto_explain, pg_cron, pg_net, pg_stat_statements, pg_tle, pgaudit, pgsodium, plan_filter, plpgsql, plpgsql_check, supabase_vault. El export preservara tambien el orden original; la lista aqui esta ordenada solo para lectura.
- Base: UTF8, collate/ctype en_US.UTF-8, proveedor ICU (i), locale en-US, version de collation 153.121.
- Existe ajuste por base app.settings.jwt_exp. Solo se consulto su nombre, no el valor. El export admite exclusivamente su valor numerico; no admite jwt_secret.
- Seis event triggers; cero foreign servers y cero security labels. No se leyeron cuerpos de funciones ni filas de aplicaciones.

La distribucion [Supabase Postgres documenta PG17.11 y extensiones](https://github.com/supabase/postgres). Existe [release fuente v17.11.0.003-cli](https://github.com/supabase/postgres/releases/tag/v17.11.0.003-cli), pero no se verifico su tag/digest Docker ni que replique esta build administrada. La [configuracion self-hosted publicada](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml) aun referencia 17.6.1.136: NO usarla como prueba de 17.11. No se invento una imagen ni digest. La imagen elegida debe comprobarse antes de entregar credenciales.

## Requisitos exactos que faltan

1. Autorizacion explicita de crear/usar/eliminar un Codespace temporal y descargar la imagen en el servicio externo; cuota y bloqueo de gastos verificados por el propietario. No se ha creado ningun recurso.
2. Imagen oficial supabase/postgres@sha256:<digest-real-revisado>, arquitectura compatible, server 170011, extensiones/versiones indicadas y bibliotecas/configuracion requerida, ICU/collation iguales. No basta con compartir version principal. Configuracion propia de bibliotecas administradas puede bloquear: revisar de forma privada, sin copiar claves de pgsodium/Vault ni credenciales de infraestructura.
3. Conexion SQL directa o session pooler 5432, DB postgres, ref correcto y rol dedicado de lectura existente; CA de Supabase y sslmode=verify-full. No hay conexion SQL/credencial de dump disponible para Codex. La conexion MCP de lectura no es un pg_dump ni proporciona la contrasena SQL. Si no existe ese rol, crearlo/conceder permisos requiere autorizacion adicional de escritura en staging.
4. El rol necesita CONNECT, USAGE y acceso de catalogos y permisos para ACCESS SHARE sobre todas las tablas incluidas por pg_dump. No necesita filas para --schema-only, ni pg_authid/password hashes, BYPASSRLS, escrituras de columnas/tablas/secuencias o CREATE de esquema/base. La exportacion usa PGOPTIONS read-only. Si falla por objetos administrados, detenerse y revisar: no cambiar grants ni usar postgres/service_role como atajo.
5. Exportar estructura completa sin --no-owner, --no-acl ni filtros que omitan dependencias; exportar roles/atributos/membresias/grantors desde pg_roles/pg_auth_members, nunca contrasenas. pg_dump no exporta roles y, sin --create, tampoco ajustes/ACL propios de la base: el script ahora prepara esos metadatos para la base local nq_validation sin reconectar a postgres remoto.
6. Cluster limpio, con bootstrap separado y staging postgres recreado NOSUPERUSER/BYPASSRLS. No usar los roles/esquemas de muestra que el entrypoint Supabase crea automaticamente. Restaurar grantors puede requerir ordenar dependencias; un error bloquea, no se ignora.
7. Propietarios y esquemas de extensiones deben coincidir despues del restore. plpgsql inicial puede pertenecer al bootstrap y CREATE EXTENSION del dump puede conservar un propietario incorrecto. El nuevo gate lo detecta: resolverlo mediante un plan local revisado sobre el cluster descartable, nunca borrando ownership del dump o retocando catalogos para obtener verde. Esta correccion de restauracion sigue pendiente de inspeccionar el dump real.
8. Espacio temporal privado fuera del checkout, sin puertos publicados, mounts del host ni subida de artefactos. Los cuerpos de funciones pueden contener logica sensible incluso en schema-only: no pegar dump/logs en chat/GitHub. Eliminar archivos y el Codespace al terminar; detenerlo solo no elimina almacenamiento facturable.

## Orden de ejecucion pendiente de autorizacion

1. Propietario verifica cuota, pagador y bloqueo de gasto; autoriza Codespace. Abrir esta rama y verificar HEAD, origin, Node y Docker disponibles. Si faltan, detenerse: no instalar automaticamente ni activar prebuilds/workflows.
2. Revisar y fijar digest de imagen oficial. Crear un cluster **vacio** con entrypoint initdb/postgres revisado, evitando /docker-entrypoint-initdb.d. Debe usar usuario bootstrap nq_ci_bootstrap, socket /var/run/postgresql, DB nq_validation y las propiedades de locale/preload verificadas; sin puertos publicados ni mounts. Etiqueta obligatoria nq.central.validation=staging-schema-only. No se entrega un docker run universal porque la inicializacion/configuracion depende de la imagen aun no verificada.
3. En terminal privada de Codespace, cargar URL/CA desde secretos restringidos o entrada oculta, nunca argumentos/historial ni chat. No falsear GITHUB_ACTIONS. Variables de entorno de control:

   `NQ_PG_VALIDATION_AUTHORIZATION=APPROVED_CODESPACE_POSTGRES_VALIDATION`

   `NQ_APPROVED_POSTGRES_IMAGE=supabase/postgres@sha256:<digest-real-revisado>`

   `NQ_PG_CONTAINER=<id-hex-del-contenedor-descartable>`

   RUNNER_TEMP debe ser un directorio privado temporal fuera del repositorio. CODESPACES/CODESPACE_NAME/GITHUB_REPOSITORY deben provenir del entorno; el script verifica ademas rama y origin reales.
4. Ejecutar en orden, solo despues de resolver requisitos:

   `node supabase/security-test/postgres-validation.mjs precheck`

   `node supabase/security-test/postgres-validation.mjs export`

   Quitar NQ_STAGING_READONLY_DB_URL y NQ_STAGING_CA_PEM del entorno, asi como variables PG de conexion remota.

   `node supabase/security-test/postgres-validation.mjs isolate`

   `node supabase/security-test/postgres-validation.mjs validate`

   `node supabase/security-test/postgres-validation.mjs cleanup`

   precheck verifica digest/version; export solo SELECT+schema-only; isolate desconecta redes solo del contenedor marcado; validate exige aislamiento y usa socket/usuario/base locales explicitos. No repetir automaticamente validate sobre un restore parcial: ante error, recrear solo el sandbox propio tras revisar evidencia privada.
5. validate restaura roles/ACL/ajustes y esquema, verifica dependencias/locale/propietarios de extensiones y solo despues aplica 020 dos veces y 021 dos veces al clon. Cualquier gate/SQL/warning no revisado bloquea la aprobacion. Revisar resultado agregado, no publicar logs privados.
6. Eliminar contenedor y archivos privados propios; eliminar Codespace desde GitHub y verificar fin de consumo/almacenamiento. No existe cleanup automatico del Codespace.

Ningun paso autoriza aplicar migraciones, modificar staging, desplegar o importar historico. La restauracion fiel y las migraciones siguen NO EJECUTADAS. Solo se ejecutaron pruebas puras locales del procedimiento y consultas SELECT de dependencias.
