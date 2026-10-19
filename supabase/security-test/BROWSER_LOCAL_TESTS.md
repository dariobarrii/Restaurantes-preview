# Pruebas locales de navegador (sin backend real)

Requieren Node 22.13+ para stripTypeScriptTypes, Playwright y Chrome/Chromium YA disponibles. No instalan paquetes ni navegadores. Si falta una herramienta, reportar bloqueo. Los harness usan route.fulfill/abort para TODAS las solicitudes del producto; no hay route.continue ni peticiones reales a Supabase, CDN o Google Maps. Service Workers bloqueados, contexto nuevo por caso. Se sustituyen configuracion/SDK/libreria de graficos en portal y cliente SQL en la cadena de registro.

## Comandos ejecutados

Con el Node 24.19.0 incluido en este entorno, NQ_NODE_MODULES apuntando a su directorio node_modules y NQ_BROWSER_EXECUTABLE a Chrome instalado:

`node supabase/security-test/run-local-checks.mjs --browser`

Variables opcionales, no secretas: NQ_NODE_MODULES para una instalacion existente de Playwright; NQ_BROWSER_EXECUTABLE para un ejecutable existente. Sin esas variables usa resolucion normal del paquete/browser. No poner URLs reales, claves ni credenciales en estos tests.

Comandos individuales:

`node supabase/security-test/portal-browser-local.mjs`

`node supabase/security-test/card-browser-smoke.mjs`

## Resultados reales

- Portal: 4 casos aprobados, owner/admin a 390 y 1280px. Carga de modulo real de index.html, conteos NFC/QR, seleccion del segundo negocio, filtro business_id por consulta, cero errores JS, sin overflow de pagina, controles tocables >=44px comprobados y fuente de campos movil >=16px.
- Cadena: 8 casos browser + 1 llamada directa de Edge denegada = 9 comprobaciones aprobadas. Se ejecutan card.html, Worker y handler Edge reales; SQL/rate limiter de plataforma se sustituyen. NFC y QR, token incorrecto, respuesta SQL invalid_card, cliente/global limitados, upstream caido y enlace malformado. Se comprueba retiro del fragmento antes de pedir, ausencia de Referer, secreto no devuelto y ausencia de redireccion ante fallo.
- Graficos: se ejercitan los datos/codigo de construccion usando Chart sustituido. NO se valida el renderizado de Chart.js real ni su entrega CDN.
- Autorizacion: API/SQL sustituidos NO prueban RLS, permisos reales, estado real de tarjetas ni aislamiento del servidor. El browser solo prueba que las consultas del cliente incluyen negocio y que el cambio de seleccion actualiza contadores.
- Maps: se intercepta una URL Maps como destino; NO se consulta Google ni se verifica la ficha comercial real.

Las regresiones movil/CSV/perfil/medianoche tienen pruebas separadas. No convertir estos resultados en aprobacion del piloto. La evidencia en staging requiere nuevas autorizaciones de despliegue/datos, segun INTEGRAL_ACCEPTANCE_PLAN.md.
