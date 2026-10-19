# Jornada de validación — 2026-10-19

## Alcance y destino comprobados

- Repositorio: dariobarrii/Restaurantes-preview.
- Rama: security/nq-central-staging-integration.
- HEAD remoto y local inicial: f9d6cb94b856044650e3bde1bdc2e526132fcc0d.
- Proyecto confirmado mediante get_project: NQ Central Security Test, rxxbmqilnozcnpwguqga.
- Servidor consultado mediante SELECT: PostgreSQL 17.11, server_version_num 170011. El rol de inspección es postgres.
- Producción no fue consultada. No se emitió SQL de escritura, no se aplicaron migraciones ni se ejecutó el fixture de aceptación. No hubo despliegues, imports, creación de triggers o merge.

## Evidencia

[Metadatos y resultados agregados](./results/2026-10-19-staging-readonly.json) y [salida real de Node](./results/2026-10-19-node-tests.txt).

El JSON contiene catálogos, permisos, políticas y agregados. No contiene cuerpos completos de funciones, credenciales, filas individuales de eventos ni datos de perfiles. El UUID del negocio de la conciliación se sustituyó por un alias. Los scripts de diagnóstico corresponden al HEAD inicial; no fueron modificados durante esta jornada.

## Pruebas Node reales

Se descubrieron los ejecutables incluidos en el runtime de Codex; no se instalaron dependencias. Node: v24.19.0. La rama fue clonada en un directorio local separado sin sobrescribir el proyecto original.

Comandos ejecutados desde la raíz del clon, usando el ejecutable resuelto:

```powershell
$nqNode = 'C:/Users/dario/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $nqNode --check supabase/security-test/staging-acceptance.mjs
& $nqNode --test supabase/security-test/staging-integration-static.mjs supabase/security-test/admin-creation-local.test.mjs workers/nq-central-card-gateway/src/index.test.mjs
```

| Prueba | Resultado real | Alcance |
| --- | --- | --- |
| Sintaxis staging-acceptance.mjs | Exit 0 | No ejecuta el fixture |
| staging-integration-static.mjs | 24/24 | Comprobaciones del código fuente; no PostgreSQL |
| admin-creation-local.test.mjs | 5/5 | Handler TypeScript real con cliente Supabase sustituido localmente; no RLS ni red |
| Worker index.test.mjs | 9/9 | Pruebas unitarias; no Worker desplegado |
| Total final | 38 aprobadas, 0 fallidas | Exit 0 |

Node informa que stripTypeScriptTypes es experimental. Esa advertencia no es un fallo; el nuevo test necesita Node 22.13+ y se ejecutó con Node 24.19.0.

Las dos nuevas regresiones de 021 fallaron antes de corregir el SQL (20/22); las dos pruebas de creación sin defaults UUID fallaron antes de corregir el handler (3/5). La regresión de ACL por defecto de 020 también falló antes del cambio (0/1). Todos esos casos pasan en la batería final.

## Tres preflights de staging

Antes de ejecutarlos se inspeccionó cada archivo: únicamente SELECT y WITH ... SELECT, con consultas de catálogos o agregados y funciones de inspección sin escrituras. Cada sentencia se ejecutó por separado para conservar todos los resultados.

| Archivo | Ejecución | Hallazgo |
| --- | --- | --- |
| dashboard-security-preflight.sql | 6/6 sentencias sin error SQL | Faltan category y label; los tipos de los otros 24 campos comprobados coinciden; RLS habilitado en las seis tablas. Los true de safe_for_020_preflight solo cubren sus campos, no aprueban toda la migración. |
| registration-privilege-checks.sql | 6/6 sentencias sin error SQL | RPC de registro y limitador ejecutables por service_role/propietario; sin EXECUTE de PUBLIC, anon o authenticated. private.app_is_admin tiene EXECUTE/USAGE para authenticated. No existe el trigger de espejo esperado. |
| historical-event-reconciliation.sql | 4/4 sentencias sin error SQL | 64 elegibles: 62 NFC y 2 QR; 51 resueltos por tarjeta y 13 por nombre único. Sin fechas faltantes ni resoluciones ambiguas en esos resultados. Cero importados, cero grupos duplicados y cero discrepancias entre filas importadas y legado. El último cero es vacuo porque no hay importados. |

Que una consulta se ejecute correctamente NO equivale a aprobar sus condiciones de seguridad.

## Hallazgos demostrados por metadatos

1. **Privilegios excesivos:** authenticated conserva INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN en app_businesses y app_business_cards. No hay políticas de escritura visibles en esas tablas, por lo que los grants DML por sí solos no demuestran que esas escrituras atraviesen RLS; TRUNCATE no queda protegido por RLS. anon conserva MAINTAIN en ambas tablas.
2. **Destino público:** anon y authenticated tienen SELECT de target_url; la política de tarjetas permite tarjetas activas no archivadas de negocios aprobados sin condición de membresía. No se consultaron filas de tarjetas.
3. **Secuencias/defaults:** app_business_events.id y app_business_review_snapshots.id son bigint NOT NULL sin identity/default ni secuencia propia. Los UUID id de negocios y tarjetas tampoco tienen default. nfc_events.id sí es identity ALWAYS, secuencia propiedad de postgres, incremento 1 y sin ciclo.
4. **Secuencia legado:** anon y authenticated tienen USAGE, SELECT y UPDATE de nfc_events_id_seq aunque las escrituras de tabla estén bloqueadas. No se llamó nextval, setval ni ninguna función de registro.
5. **ACL por defecto:** los nuevos objetos public del propietario postgres heredan amplios grants para anon/authenticated, incluidas secuencias. No basta esperar a 021 para retirar esos permisos de las secuencias creadas por 020.
6. **Perfiles y reseñas actuales:** authenticated no puede actualizar full_name, role o status según los privilegios efectivos; no tiene INSERT de tabla en reseñas y no existe política INSERT de reseñas. Son operaciones todavía pendientes de la propuesta 021.
7. **Funciones:** las funciones sensibles presentes son SECURITY DEFINER, propietario postgres con BYPASSRLS y search_path vacío. Esto confirma su contexto privilegiado, no demuestra la corrección de sus cuerpos. No se devolvieron esos cuerpos. La RPC actual devuelve jsonb; su contrato y comportamiento completo siguen sin verificarse mediante integración.
8. **Migraciones y despliegues:** 019 figura en el historial como 20261019064522/restrict_anonymous_business_writes y las escrituras anónimas de tabla comprobadas están revocadas. No hay registro de 020/021 y sus efectos requeridos no están presentes. No están desplegadas manage-business-administration, manage-business-card-token ni la ruta de producto register-business-card-event. Los endpoints E2E/secure-test no se consideran sustitutos.
9. **Espejo:** no aparece mirror_legacy_nfc_event_to_business entre las funciones buscadas ni un trigger de nfc_events. No se creó ninguno.

## Correcciones preparadas en la rama

- **021:** mover UPDATE(full_name) después del último barrido de ACL por columna. Antes, la migración revocaba su propio grant legítimo.
- **021:** comprobar que NO exista INSERT de tabla en reseñas; mantener las comprobaciones afirmativas de las tres columnas permitidas. Antes, dos bloques exigían condiciones opuestas.
- **021:** retirar y verificar los permisos de navegador sobre la secuencia legado de nfc_events, preservando las concesiones del servidor/propietario.
- **020:** retirar y verificar permisos efectivos de navegador en las secuencias nuevas o verificadas antes de COMMIT, para cerrar la ventana creada por los default ACL de staging. 021 vuelve a conceder solo el USAGE autorizado de reseñas.
- **Administración:** generar id con crypto.randomUUID() en el servidor para business_create y card_create. No se añade un default UUID a staging ni se acepta id suministrado por el navegador.
- Añadir regresiones estáticas y cinco pruebas locales del handler; actualizar el procedimiento PostgreSQL y conservar esta evidencia.

Estas correcciones de SQL están revisadas a nivel de fuente y cubiertas por regresiones estáticas. NO se han ejecutado en PostgreSQL.

## PostgreSQL local: bloqueo real

Se buscaron PostgreSQL/psql/pg_dump/createdb en PATH, ubicaciones habituales, runtime incluido, servicios y aplicaciones instaladas accesibles. No se encontraron herramientas ni servidor utilizables. Docker no está disponible y WSL informa que no está instalado. No hay conexión de base configurada para pg_dump. La conexión MCP permite SELECT autorizados, pero no proporciona un volcado pg_dump fiel.

No se instalaron herramientas, no se fabricó un esquema equivalente, no se exportaron cuerpos por consultas SQL y no se creó una base descartable. Un resumen de catálogos no se presentó como dump.

| Operación solicitada | Estado |
| --- | --- |
| Dump de esquema sin datos, con ACL/dependencias | Bloqueado; no obtenido |
| Restauración fiel en PostgreSQL 17 local | Bloqueada; no intentada sin herramientas/dump |
| 020 primera y segunda ejecución local | Pendientes, no ejecutadas |
| 021 primera y segunda ejecución local | Pendientes, no ejecutadas |
| Privilegios finales después de 020/021 | Pendientes de PostgreSQL real |
| RLS funcional con dos usuarios/negocios | Pendiente; sin fixture ni cambios de staging |
| NFC/QR integral | Pendiente de ruta de producto y configuración autorizadas |

## Próximo paso mínimo

Proveer un PostgreSQL 17 local accesible con psql/pg_dump/createdb y una conexión privada para el dump autorizado de este staging, sin pegar credenciales en informes o Git. Continuar el procedimiento POSTGRES_MIGRATION_VALIDATION.md conservando roles, propietarios, herencia, default ACL, extensiones y dependencias. La autorización vigente ya cubre la validación local y lectura/exportación; no hace falta renovarla para esas operaciones.

Después de una restauración fiel, ejecutar 020 dos veces y 021 dos veces SOLO en la base local, revisar los privilegios finales y corregir cualquier fallo. No recomiendo solicitar todavía la aplicación en staging: falta esa prueba PostgreSQL. Aplicar migraciones, modificar datos de staging o desplegar funciones/Worker/web siguen requiriendo nueva autorización expresa.
