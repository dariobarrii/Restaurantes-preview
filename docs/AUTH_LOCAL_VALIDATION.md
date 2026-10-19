# Correcciones locales de acceso — 2026-10-19

## Base y conservación

Copia separada: `nq-auth-fixes`, rama `security/nq-central-staging-integration`,
base `2c220b924eabbc3657064b58ccd11417b4700abf`.
La copia anterior `nq-staging-validation` y su índice no se modificaron.
No hay push, despliegue, consultas a Supabase, SQL ni cambios externos.

## Cambios

- `index.html`: login y restauración comparten comprobación de perfil aprobado
  y roles explícitos `admin`/`restaurant`. Errores de perfil/sesión quedan visibles.
- Las respuestas antiguas de sesión/perfil no reabren el portal tras un cambio.
- El login limpia la presentación privada anterior antes de autenticar otra cuenta.
- Logout limpia la presentación privada, comprueba errores y ofrece reintento.
  Un fallo no se presenta como cierre confirmado ni garantiza revocación remota.
- Sin membresía se muestra un aviso en `clientStatus`. El navegador reprodujo
  otro fallo: el código tocaba contadores inexistentes antes de mostrar el aviso;
  ahora comprueba su existencia y no solicita eventos sin negocio.
- El dashboard distingue 401, 403, 404, errores de conexión y fallos del servidor.
  Ya no atribuye todos los errores a una migración pendiente. Las respuestas
  administrativas antiguas no publican errores después de cambiar de sesión.
- Pruebas nuevas de autenticación, ampliación de navegador y registro en el runner.
  El fixture de estadísticas administrativas incorpora la versión de sesión que
  ahora necesita `load`; no cambia la expectativa ni su cálculo.

## Ejecución real, exclusivamente local

Node v24.19.0, Playwright existente y Chrome existente. Sin instalaciones.

```sh
node supabase/security-test/run-local-checks.mjs
node supabase/security-test/portal-browser-local.mjs
node supabase/security-test/card-browser-smoke.mjs
git diff --check
```

Los scripts de navegador necesitan `NQ_NODE_MODULES` apuntando a una instalación
existente de Playwright y, si procede, `NQ_BROWSER_EXECUTABLE` al navegador.
En este entorno Windows se utilizó:

```powershell
$env:NQ_NODE_MODULES='C:/Users/dario/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
$env:NQ_BROWSER_EXECUTABLE='C:/Program Files/Google/Chrome/Application/chrome.exe'
```

| Prueba | Resultado | Alcance |
|---|---|---|
| Runner local y comprobaciones de sintaxis | 122/122, salida 0 | Incluye 16 pruebas nuevas de autenticación y 4 PWA. APIs/SQL sustituidos o inspección estática. |
| Portal en Chrome | 22/22, salida 0 | Once escenarios a 390/1280 px, API/Auth sustituidos. |
| Recorrido de tarjeta en Chrome | 9/9, salida 0 | Código local con cliente SQL sustituido; no servicios desplegados. |
| Revisión de espacios del diff | Sin errores | No valida seguridad real. |

Durante la implementación falló primero la sintaxis del handler y se corrigió;
el caso sin membresía reveló el acceso a nodos inexistentes; una prueba aislada
administrativa necesitó incorporar `portalSessionVersion` en su contexto simulado.
Las ejecuciones finales indicadas pasan después de esas correcciones.

## Archivos protegidos y PWA

Comparación Git contra la base sin diferencias en `assets/pwa/`,
`manifest.webmanifest`, `card.html`, `supabase/functions/`, `supabase/migrations/`
y `nq-central-staging-config.js`. Se conservaron los iconos aprobados.
No se añadió Service Worker. La instalación real iOS/Android sigue pendiente.

## Pendiente / siguiente paso

- Revisar el diff local y autorizar por separado su incorporación remota.
- La configuración pública del proyecto continúa vacía; no se inventaron claves.
- El propietario confirmó que `manage-business-administration` no está desplegada
  en Security Test: el administrador recibirá el diagnóstico, no datos reales.
- Antes de cualquier despliegue, comprobar esquema/columnas y configuración del
  servidor/origen. No aplicar migraciones automáticamente.
- Login real, recuperación por correo, persistencia, logout remoto y RLS con dos
  identidades/negocios siguen sin validar. Las pruebas locales no los sustituyen.
- La revocación de una sesión y el aislamiento efectivo siguen siendo deber del
  servidor; el control visual del cliente no concede permisos.

Los cambios están preparados localmente, sin commit nuevo ni publicación. HEAD
permanece en la base indicada. El parche de entrega permite recuperarlos desde
Codespace sin copiar iconos ni configuración sensible.
