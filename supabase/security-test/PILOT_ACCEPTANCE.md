# Primer restaurante piloto: criterios verificables

Estado de esta continuacion: NO aprobado para uso comercial. Proyecto de pruebas rxxbmqilnozcnpwguqga; no hubo escrituras ni despliegues. La aceptacion exige evidencia real, no porcentajes.

| Criterio | Evidencia disponible | Estado y condicion de aceptacion |
|---|---|---|
| Migraciones 020/021 compatibles e idempotentes | SQL y workflow preparados; sin runtime/export fiel | BLOQUEADO: PostgreSQL 17 real, restauracion con propietarios/roles/ACL/extensiones reales, dos pasadas cada una y snapshots sin diferencias inesperadas |
| Operaciones administrativas | Diez acciones deniegan usuarios sin admin/approved en pruebas locales; UUID/allowlists/self-approval cubiertos | PENDIENTE staging: crear/editar negocio, membresia y tarjeta; comprobar HTTP y estado final de cada accion con identidades reales |
| Perfil propio | UPDATE cero filas ya no declara exito ni modifica metadata; regresion local | PENDIENTE RLS real: full_name permitido, rol/status ajenos denegados, login/recuperacion/cierre/renovacion correctos |
| Dos negocios aislados | Filtro business_id en cada pagina y descarte de respuestas antiguas probado localmente | PENDIENTE: owner A/viewer B con JWT reales; cero lectura/escritura de A sobre B y viceversa; anon denegado |
| Tarjetas y tokens | Emision/rotacion/revocacion y rechazo de estados/negocio probados con cliente sustituido | PENDIENTE: tokens originales solo en entrega autorizada, hashes en DB, rotacion invalida anterior, pausa/archivo/revocacion impiden registro/redireccion |
| Gateway y registro | Ref staging fijo, HTTPS/puerto/origen/media/limites/campos publicos cubiertos localmente | PENDIENTE despliegue autorizado: llamada directa rechazada, global/tarjeta/cliente distintos, fallo upstream controlado, secreto nunca publico |
| NFC y QR | Contratos de dispositivo y no redireccion en fallos probados sin red | PENDIENTE: una tarjeta por canal/negocio, conteo exacto por business_id y canal, destino HTTPS Google Maps aprobado sin credenciales |
| Reintentos | No hay reintento automatico; limite por tarjeta no garantiza idempotencia duradera | PENDIENTE decision: definir un intento frente a nueva visita. No habilitar retries sin request_id persistente y pruebas concurrentes |
| Dashboard y exportacion | Paginacion completa/rechazo de parciales, seleccion B, CSV y cache probados | PENDIENTE: cantidades conocidas en dias/semanas/meses y NFC/QR separados; mas de 50.000 requiere agregacion servidor |
| Resenas | Apertura/cierre mas recientes probados; politica propuesta limita columnas | PENDIENTE: owner/manager guardan solo su negocio, viewer/otro negocio denegados; datos manipulados rechazados |
| Historico | 64 elegibles/62 NFC/2 QR segun evidencia anterior; importacion propuesta por legacy_event_id | PENDIENTE autorizacion: no importar ahora; conciliacion antes/despues, repeticion sin duplicados, sin fechas inventadas ni atribuciones ambiguas |
| Recuperacion y soporte | Plan de reversion y fixtures preparados | PENDIENTE: ensayo autorizado de restauracion/limpieza limitada; responsables y procedimiento para pausar/revocar tarjeta o usuario |

## Un solo comando local, sin staging

Desde la raiz del checkout, con Node 24 disponible:

`node supabase/security-test/run-local-checks.mjs`

Solo ejecuta una lista explicita de suites locales y comprobaciones de sintaxis. No descubre tests por glob, no ejecuta staging-acceptance.mjs, no lanza SQL/Docker/workflows y no instala dependencias. La sintaxis del fixture se comprueba sin ejecutarlo.

## Orden de habilitacion (cada operacion externa requiere autorizacion)

1. Revisar SHA y obtener exportacion schema-only privada de staging; resolver runtime/dependencias. Validar PostgreSQL 17 local o workflow manual aprobado. No registrar el workflow en main sin autorizacion especifica.
2. Revisar preflight de lectura, diff SQL y reversion; dar aprobacion separada a 020/021. Preparar funciones antes de retirar operaciones del navegador: no abrir el portal al piloto entre aplicar permisos y tener sus sustitutos desplegados.
3. Desplegar funciones administrativas/token y ruta de producto/gateway/web solo tras aprobacion separada; validar configuracion exclusivamente de staging. Revisar tambien las dependencias 016/018 frente al catalogo actual: no ejecutar ciegamente todas las migraciones del repositorio, ni crear espejo/importar historico por implicacion.
4. Autorizar escrituras acotadas del fixture, ejecutar INTEGRAL_ACCEPTANCE_PLAN.md, registrar HTTP/estado final por criterio, revisar errores y limpiar solo firmas completas propias. Las pruebas locales no reemplazan esta etapa.
5. Aceptacion del propietario antes de planificar produccion; ninguna accion sobre produccion esta autorizada aqui.

Resultados reales de esta tanda: results/2026-10-19-critical-high-node-tests.txt. La aprobacion local no aprueba esta tabla de aceptacion comercial.
