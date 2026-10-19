# NQ Central: cierre tecnico y preparacion del piloto — 2026-10-19

**Decision: NO aprobado para lanzamiento.** Codigo y automatizacion avanzaron; falta validar el backend real y obtener aceptacion funcional. No hubo despliegues, datos de staging modificados, importaciones, triggers, cambios de facturacion ni operaciones en produccion.

Repositorio exclusivo dariobarrii/Restaurantes-preview, rama security/nq-central-staging-integration. Base remota verificada caeee9a9efd897abddbb24e36482c0258ae82580. Resolver el HEAD actual en GitHub; este informe se versiona con el cierre. Los sitios y registros de Tzura Steak House, Veta Steak House y Feral Steakhouse no se tocaron. Los nombres/datos de browser son fixtures locales, nunca metricas comerciales.

## Trabajo completado con evidencia

| Area | Correccion o comprobacion | Evidencia ejecutada |
|---|---|---|
| CSV | Informes administrativos y exportacion de negocios usan serializador con neutralizacion de formulas, BOM y saltos reales | Regresion del CSV original fallo; prueba del export real pasa |
| Destinos de tarjetas | Enlaces heredados solo se renderizan si son HTTPS, sin credenciales, sin espacios y dentro de limite de longitud | Prueba de URL javascript/http/credenciales/null rechazada y Maps HTTPS permitido |
| Sesiones | Respuesta de perfil antigua no avanza a metadata ni muestra exito despues de cambiar cuenta | Regresion diferida fallo antes, 4 pruebas de perfil pasan despues |
| Estadisticas | Contador administrativo de hoy usa el mismo calendario Europe/Madrid del resto del panel, solo NFC/QR | El load real contaba 2 en el caso de medianoche; tras cambio cuenta 1 correctamente |
| Movil | Grid y sidebar no ensanchan viewport; campos a 16px | Chrome: antes 789px sobre viewport390; despues sin overflow, owner/admin390/1280, objetivos comprobados >=44px |
| Recorrido local | Browser real + card.html + Worker + handler Edge actuales, con cliente SQL sustituido | 9 comprobaciones: NFC/QR, errores, limites, redireccion interceptada, secreto no devuelto y Edge directo403 |
| Portales | Modulo real de index.html con SDK/Chart sustituidos; seleccion B y consultas por business_id | 4 casos Chrome, contadores correctos y cero errores JS, sin solicitudes externas de la aplicacion |
| PostgreSQL | Bloqueo previo si catalogo restaurado no coincide con origen; public/private helpers, ACL canonicas, hash de funcion sin body | 14 pruebas locales del plan; EXPLAIN sin ANALYZE del SELECT de snapshot paso en staging confirmado |
| Proteccion de archivos | .gitignore para credenciales/dump/logs privados | git check-ignore con rutas ficticias aprobadas |

La revision de esta jornada se concentro en el codigo pendiente y sus consumidores, reutilizando auditorias anteriores. No se afirma una certificacion de todo el repositorio ni de la configuracion desplegada.

## Archivos modificados

- index.html: CSV, URL de tarjetas, perfil/sesion, fecha diaria y CSS movil.
- .gitignore: credenciales y artefactos privados.
- supabase/security-test/admin-report-local.test.mjs y profile-local.test.mjs: regresiones reales.
- portal-browser-local.mjs y card-browser-smoke.mjs: browser offline; se reemplazo el harness antiguo que apuntaba a otra ruta Supabase.
- run-local-checks.mjs: lista explicita ampliada y opcion --browser; sin instalaciones/descubrimiento de fixtures de escritura.
- postgres-validation.mjs, postgres-clone-snapshot.sql y postgres-plan-local.test.mjs: gate de fidelidad ANTES de 020/021 y pruebas.
- BROWSER_LOCAL_TESTS.md, CODESPACE_CONTINUATION.md, INTEGRAL_ACCEPTANCE_PLAN.md, NQ_CENTRAL_HANDOFF.md y este informe: instrucciones y limites.
- results/*launch* y *browser*-final.txt: salidas saneadas de pruebas ejecutadas.

020_add_nullable_dashboard_fields.sql y 021_restrict_dashboard_mutations.sql fueron revisadas y **no modificadas ni ejecutadas**. La primera conserva nulos y usa RESTART transaccional; la segunda coordina ACL/RLS y la funcion administrativa sustituta. Sus pruebas estaticas no demuestran ejecucion PostgreSQL, permisos efectivos ni preservacion de datos reales.

## Pruebas y comandos reales

Con Node24.19.0 incluido en este entorno:

`node supabase/security-test/run-local-checks.mjs`

Resultado final: **102/102**, cero fallos. Incluye 24 estaticas,10 administracion,3 CSV/destino/fecha,11 credenciales,7 scanner,9 modelo idempotencia,9 datos de portal,14 plan PostgreSQL,4 perfil y11 Worker. El modelo usa memoria y no prueba durabilidad. Tambien se comprueba sintaxis del modulo del portal, helper de datos, fixture y exportador sin ejecutarlos contra una base.

`node supabase/security-test/portal-browser-local.mjs`

Resultado final: **4/4** casos Chrome aprobados.

`node supabase/security-test/card-browser-smoke.mjs`

Resultado final: **9/9** comprobaciones aprobadas, incluida llamada directa denegada fuera del browser. No son nueve pruebas de SQL o RLS.

`node supabase/security-test/run-local-checks.mjs --browser`

Tambien ejecutado como bateria combinada durante la jornada (101 Node en esa revision +13 browser); la pasada final Node incluye el gate adicional de catalogo, por eso102. Variables no secretas para usar instalaciones existentes: NQ_NODE_MODULES y NQ_BROWSER_EXECUTABLE. Ver BROWSER_LOCAL_TESTS.md. No se instalaron dependencias.

Evidencia final: results/2026-10-19-launch-node-final.txt, results/2026-10-19-portal-browser-local-final.txt y results/2026-10-19-card-browser-smoke-final.txt. Los errores iniciales de harness (selector/nombre de control y lectura de BOM por Blob.text) se corrigieron y no se presentaron como fallos del producto. Los fallos de CSV, zona horaria, carrera de perfil y overflow si se reprodujeron en el codigo del producto.

## PostgreSQL: estado preciso

El propietario informa precheck aprobado en su contenedor nq-central-pg-validation del Codespace /workspaces/Restaurantes-preview. Codex no tiene acceso al contenedor ni a su registro privado. No se intenta acceder a Docker desde esta PC.

CODESPACE_CONTINUATION.md indica actualizar la revision conservando cambios, resolver ID, verificar contexto, exportar esquema/catalogo/roles privados de lectura, retirar variables remotas, aislar el contenedor y validar. El export nuevo requiere source-catalog.json; no fabricarlo a partir del clon. Comparar ICU, preloads, extensiones/propietarios y ACL/RLS antes de ejecutar 020 dos veces y021 dos veces. Toda diferencia bloquea. Las conexiones de metadata y dump son separadas: evitar DDL concurrente durante la captura.

El EXPLAIN realizado solo comprueba que el SELECT de snapshot se puede planificar en PG17; no ejecuta restore ni migraciones. La version del servidor local, la fidelidad del restore y las cuatro ejecuciones de migracion siguen **PENDIENTES**.

## Checklist de lanzamiento y avance estimado

Doce puertas de aceptacion con el mismo peso; solo cuatro tienen evidencia suficiente para el alcance descrito. **Preparacion evidenciada: 4/12 =33%**. Esta es una estimacion de cierre de este checklist de lanzamiento, no porcentaje de codigo construido, probabilidad de seguridad ni autorizacion comercial.

| Puerta | Estado | Evidencia que falta |
|---|---|---|
| 1. Regresiones locales de codigo | APROBADA local | Ninguna para esta revision; no implica backend real |
| 2. Portales/movil offline | APROBADA local | Alcance limitado a SDK/Chart sustituidos |
| 3. Cadena browser/Worker/Edge offline | APROBADA local | Alcance limitado a SQL/binding sustituidos |
| 4. Automatizacion y guards PostgreSQL | APROBADA local | Solo prepara/bloquea; no aprueba migraciones |
| 5. Restore fiel +020/021 dos veces | BLOQUEADA | Ejecucion y resultados del Codespace |
| 6. RLS/permisos efectivos con dos negocios | PENDIENTE | Dos identidades reales, acceso cruzado y escrituras denegadas |
| 7. Auth/login/recuperacion/sesiones reales | PENDIENTE | Callbacks aprobados, renovacion, cierre y pruebas de concurrencia con Auth real |
| 8. CRUD administrativo real | PENDIENTE | Crear/editar/pausar/archivar, membresias y restauraciones; HTTP+estado final |
| 9. NFC/QR completo real | PENDIENTE | Tokens/estados/limites/atribucion y destino Maps correctos; decision de idempotencia duradera |
| 10. Graficos/reseñas/estadisticas reales | PENDIENTE | Chart.js real, CDN, zona operativa del negocio y conteos conocidos con datos autorizados |
| 11. Historico sin duplicados | PENDIENTE | Importacion futura autorizada, conciliacion y prueba repetida; no importar ahora |
| 12. Operacion/reversion/aceptacion piloto | PENDIENTE | Procedimiento de incidente, restauracion comprobada y aceptacion del propietario |

## Bloqueos y riesgos restantes

- Critico: no hay prueba de 020/021 contra clon fiel ni evidencia funcional del aislamiento real. No aplicar SQL para suplir ese vacio.
- Critico: ruta de producto desplegada/contrato real RPC y permisos efectivos pendientes de comprobar. No usar endpoints E2E como producto ni tocar staging ahora.
- Alto: el limite por tarjeta no es idempotencia duradera. No habilitar retries automaticos; diseno candidato separado sin contrato desplegado nuevo.
- Alto: los tests sustituyen SDK, Chart y SQL. No prueban configuracion Supabase Auth, entrega CDN ni callbacks reales. Los imports CDN siguen sin version exacta/SRI; revisar versionado/entrega con pruebas reales antes de piloto.
- Alto: cambios de cuenta durante recuperacion/cambio de contraseña y mutaciones concurrentes requieren pruebas Auth reales; la correccion de perfil no se presenta como solucion universal a toda concurrencia.
- Operativo: probar la zona horaria esperada por cada piloto; Madrid es ahora consistente con el producto existente, no una ubicacion inferida de restaurantes.
- Escala: mas de50.000 eventos sigue fallando explicitamente; falta agregacion servidor antes de crecer. No afirmar que una respuesta parcial contiene todas las metricas.

## Proximos pasos minimos

1. Ejecutar la continuacion PostgreSQL en el Codespace existente y compartir solo resultados agregados de restore/gates/020/021. No enviar secretos/logs privados. Si falta dump o permisos de lectura, registrar bloqueo; no crear roles ni cambiar staging.
2. Revisar resultados y solicitar autorizaciones separadas para cualquier migracion en staging, despliegue de funciones/Worker/web y escrituras de fixtures. Ninguna esta autorizada aqui. No exponer al piloto una ventana donde permisos retirados carezcan de sus funciones sustitutas.
3. Tras esas autorizaciones, ejecutar INTEGRAL_ACCEPTANCE_PLAN.md con dos negocios/usuarios y casos reales del piloto, preservar los tres restaurantes actuales, revisar cada estado final y limpiar solo fixtures identificados. Aprobar comercializacion solo cuando las ocho puertas reales pendientes tengan evidencia o decision de alcance explicita.
