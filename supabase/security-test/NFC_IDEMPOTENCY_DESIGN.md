# Idempotencia NFC/QR: contrato candidato, sin integrar

Estado: diseno y modelo local exclusivamente. card.html, Worker, Edge y RPC de producto NO cambian de contrato. No hay nueva migracion ni endpoint inventado. No esta implementada durabilidad PostgreSQL.

## Semantica propuesta

- Una apertura deliberada de enlace crea un request_id UUID v4 aleatorio en memoria del navegador. Reintentos de ESA solicitud conservan el mismo ID. Otra visita deliberada crea otro. No guardar el token en storage para posibilitar retries.
- El cliente nunca suministra business_id ni canal; servidor los obtiene de la tarjeta. La clave idempotente es (card_id, request_id). El registro debe vincularse tambien a una generacion de credencial emitida por servidor, sin almacenar el token original.
- Antes de leer una respuesta repetida se comprueban token actual, generacion, tarjeta activa/no archivada, negocio aprobado y destino HTTPS seguro. Revocacion/pausa invalida tambien el replay: una respuesta cacheada no autoriza redireccion.
- Misma clave y mismo contenido canonico: exactamente un evento, misma fecha/atribucion original, sin consumo adicional del limite por tarjeta. Se valida el destino ACTUAL antes de devolverlo; no se usa un destino obsoleto cacheado.
- Misma clave con otra generacion/dispositivo/atribucion: conflicto, cero evento nuevo. No reutilizar request_id despues de rotar credencial.
- Otro request_id: nueva interaccion sujeta al limite por tarjeta. NFC/QR permanecen derivados de channel de tarjeta. Limites global/cliente siguen aplicandose a las peticiones de red, incluidos replays.
- La respuesta publica de exito puede conservar {ok:true,target_url}; el modelo usa campos internos simplificados y NO es una especificacion desplegada. La eleccion de codigos HTTP del conflicto debe revisarse junto a los consumidores existentes antes de integrar.

## Almacenamiento propuesto (no columnas verificadas ni SQL preparado)

Hace falta un identificador persistente de generacion de credencial, una clave unica permanente de intento asociada a tarjeta y un registro atomico de evento/resultado. Las tablas actuales no se dan por dotadas de esos campos. La futura migracion se disena tras revisar el catalogo real y todos los consumidores; no se crea en esta fase.

Mantener la unicidad durante toda la retencion de eventos, no solo dos segundos o un TTL del gateway. Eliminar la clave despues de 24 horas permitiria duplicados tardios. Los eventos legados mantendrian identificador de intento NULL y sus fechas/negocio/canal actuales; no crear claves ficticias ni modificar la importacion historica.

La RPC debe validar y bloquear en una transaccion: credencial -> tarjeta -> negocio, con orden consistente en rotacion/pausa/revocacion; comprobar idempotencia; aplicar limite de tarjeta solo si es nueva; insertar evento y referencia unica; confirmar juntos. Usar restricciones unicas de PostgreSQL y rollback real. No sustituirlas por caché Worker, memoria Edge o una secuencia de consultas separadas. Reintentos deben funcionar despues de reiniciar Edge/Worker.

Un fallo despues del COMMIT y antes de la respuesta debe poder repetirse sin segundo evento. Un fallo antes del COMMIT no debe dejar claves huerfanas ni consumir permanentemente el intento. Deadlocks/serialization errors requieren estrategia acotada que conserve request_id; no reintentar escrituras con un ID nuevo.

## Evidencia local y limites

`node --test supabase/security-test/idempotency-contract.test.mjs`

9/9 pruebas ejecutadas: 20 llamadas concurrentes a un intento; repeticion despues de ventana; nueva visita limitada; pausa/archivo/revocacion/aprobacion; rotacion; cambio de payload; dos tarjetas/negocios/canales; entradas fallidas; destino inseguro en replay.

idempotency-contract-model.mjs usa Maps y una cola por tarjeta: modela la semantica, no ejecuta handlers de producto, SQL ni RLS. No prueba transacciones, indices, aislamiento, durabilidad, fallos de COMMIT ni reinicios de procesos. No debe importarse desde archivos del producto.

## Pruebas PostgreSQL/staging futuras, pendientes

1. Dos conexiones concurrentes con misma clave: un unico evento, ninguna fecha o atribucion reescrita.
2. Misma clave tras reiniciar gateway/Edge: cero duplicados.
3. Rollback en cada punto entre limite/insert/ledger/commit: sin estado parcial.
4. Respuesta perdida despues del commit: replay seguro.
5. Pausa/revocacion/rotacion concurrente: comportamiento linealizable definido, sin replay que autorice una credencial ya revocada.
6. Dos negocios con IDs/tokens cruzados: acceso denegado, conteos separados.
7. Repeticion a largo plazo y limpieza autorizada: no perder clave de unicidad mientras exista evento.
8. Clientes anteriores y nuevos: compatibilidad explicita; no habilitar retries automaticos antes de desplegar y validar todo el contrato candidato en staging con autorizacion.

Proximo cambio de producto solo tras decision de contrato y migracion revisada. Esta fase no conecta endpoints E2E, no genera credenciales reales y no escribe datos.
