# Administración: primera fase de solo lectura

## Estado de entrega

Base: `47e40d949e9a4e4406e73e5668e7fdf3fe4c0edc`, rama
`security/nq-central-staging-integration`, copia separada `nq-admin-readonly`.
No se modificaron las copias anteriores. Sin push, despliegue, SQL ni acceso a
Supabase. Los cambios están preparados localmente; no hay commit nuevo.

## Cambios de esta fase

- La función conserva comprobación de JWT mediante `getUser` y perfil
  `admin/approved`, además de `verify_jwt = true` en la configuración existente.
- Después de identificar una acción conocida y ANTES de consultar datasets o
  modificar datos, únicamente permite `dashboard` y `profiles`.
- Las ocho acciones restantes, incluida `cards`, devuelven HTTP 403 con
  `action_not_enabled`. No existe una variable de navegador que habilite escrituras.
- Las lecturas de negocios seleccionan `id,name,slug,status`. No dependen de
  `category`; las dos acciones habilitadas no consultan tarjetas ni `label`.
- Se conservan los límites de paginación, los errores y `Cache-Control: no-store`.
- El panel indica solo lectura, deshabilita formularios y botones estáticos y
  dinámicos, bloquea solicitudes administrativas distintas de las dos lecturas
  y no solicita tarjetas. La gestión de credenciales tampoco se invoca desde UI.
- El código de operaciones posteriores permanece preservado detrás de la barrera;
  su existencia NO implica que esté habilitado o validado para esta fase.

Esto no cambia los privilegios de la base ni bloquea posibles accesos directos
preexistentes a Supabase. RLS y permisos efectivos requieren validación separada.
Las capturas y ajustes del portal de restaurantes conservan su comportamiento;
esta restricción afecta a la administración.

## Pruebas locales ejecutadas

Node 24.19.0 y navegador Chrome/Playwright existentes, sin instalar dependencias.

```sh
node supabase/security-test/run-local-checks.mjs
node supabase/security-test/portal-browser-local.mjs
node supabase/security-test/card-browser-smoke.mjs
git diff --check
```

| Suite | Resultado real | Limitación |
|---|---|---|
| Runner local y sintaxis | 126/126 | Incluye siete pruebas nuevas del handler y cuatro PWA. SQL/API sustituidos o inspección estática. |
| Portal Chrome | 22/22 | API/Auth locales; verifica únicamente dashboard/profiles, controles deshabilitados, cuentas y errores a 390/1280 px. |
| Tarjeta/Worker/Edge locales | 9/9 | Cliente SQL sustituido, sin servicios desplegados ni Google Maps real. |
| Diff | Sin errores | No demuestra seguridad de staging. |

El total anterior era 122: cinco pruebas que esperaban crear/modificar se
reemplazaron por dos que exigen bloqueo, y se añadieron siete pruebas de lectura,
autenticación y ausencia de escrituras. No se omitieron suites.
El contexto aislado del test de informes ahora incluye `enforceAdminReadOnly`.
El test estático exige ausencia de `adminRequest('cards')` y presencia de la barrera.

Para navegador, configurar las rutas de instalaciones YA existentes:
`NQ_NODE_MODULES` (directorio node_modules con Playwright) y, si corresponde,
`NQ_BROWSER_EXECUTABLE` (Chrome/Chromium). No instalar automáticamente.

Se compararon con la base sin diferencias: manifiesto, iconos, card.html,
Workers, migraciones/SQL de seguridad, funciones NFC/QR y de tokens, configuración
de staging y config.toml. Instalación PWA real y RLS siguen pendientes.

## Plan exacto futuro: NO ejecutar sin autorización separada

### A. Incorporación de código

1. Guardar el parche fuera del repositorio o mantenerlo sin seguimiento.
2. Confirmar rama, HEAD y directorio limpio. Si la base avanzó, detener la aplicación
   automática, conservar cambios y comparar; nunca forzar ni restaurar archivos.
3. Ejecutar `git apply --check --index /ruta/nq-central-admin-readonly.patch`,
   después `git apply --index /ruta/nq-central-admin-readonly.patch` y repetir tests.
4. Revisar el diff. Commit/push requieren el permiso correspondiente; no incluir
   el parche, credenciales, configuraciones privadas ni archivos de entorno.

### B. Preflight de destino y configuración (autorización de acceso necesaria)

1. Confirmar `NQ Central Security Test` y ref `rxxbmqilnozcnpwguqga` en Dashboard.
2. Comprobar de solo lectura las columnas usadas:
   - `app_profiles`: user_id, role, status, full_name, created_at.
   - `app_businesses`: id, name, slug, status.
   - `app_business_events`: id, business_id, event_type, created_at, device_type, source.
   - `app_business_review_snapshots`: id, business_id, platform, review_count, captured_at.
3. Comprobar que el contexto servidor puede leer esas tablas. No conceder permisos
   ni aplicar migraciones para resolver errores automáticamente.
4. Verificar existencia de SUPABASE_URL, SUPABASE_ANON_KEY y
   SUPABASE_SERVICE_ROLE_KEY en el runtime del proyecto, sin imprimir valores.
   Confirmar que URL y claves corresponden al MISMO proyecto. No copiarlas a Git.
5. Decidir el origen HTTPS exacto del portal de pruebas. No está confirmado aquí.
   NQ_ADMIN_ALLOWED_ORIGINS debe incluir solo los orígenes expresamente autorizados,
   sin comodines ni rutas. Un subdirectorio de GitHub Pages no separa orígenes.
6. El frontend sigue necesitando URL de staging y clave PUBLICABLE. No rellenadas
   por esta fase. Nunca usar la clave privilegiada en el navegador.

### C. Configuración y despliegue SOLO tras nueva autorización

Con CLI existente/autenticada, revisar antes los comandos de su versión:

```sh
supabase --help
supabase functions deploy --help
supabase secrets set --help
supabase projects list
```

Confirmar nuevamente el proyecto. Si falta CLI/autorización, detener el despliegue;
no instalar ni crear recursos automáticamente. Para el origen personalizado,
preferir el editor seguro del Dashboard del proyecto, con aprobación previa.
No sobrescribir otras variables ni crear nuevas claves privilegiadas.

Único comando de despliegue propuesto, que NO se ejecutó:

```sh
supabase functions deploy manage-business-administration --project-ref rxxbmqilnozcnpwguqga
```

No usar despliegue masivo, `--no-verify-jwt`, db push ni workflows. Confirmar
`verify_jwt = true`. Si el JWT real se rechaza, investigar antes de cambiarlo.
No desplegar web, Worker ni otras funciones como parte de este permiso.
Para probar UI sin publicar la web, usar una vista previa privada autorizada,
configurada para staging y con su origen aprobado.

### D. Aceptación real, sin modificaciones de datos

- Admin approved: dashboard/profiles HTTP 200 y conteos de prueba coherentes;
  negocio sin category muestra Sin categoría y no se consulta label ni tarjetas.
- Restaurant approved: ambas acciones HTTP 403 y sin datos administrativos.
- Sin JWT/JWT inválido: rechazo de autenticación; origen no autorizado: rechazo.
- Perfil ausente o no aprobado: rechazo (requiere identidad ya existente para
  probarlo; no modificar perfiles ni crear usuarios en esta fase).
- Con admin, enviar SOLO `{action}` para cada acción deshabilitada, sin IDs ni
  payloads de escritura: debe responder 403/action_not_enabled en todos los casos.
  Detener ante cualquier respuesta inesperada. No enviar datos de creación.
- Inspeccionar Network: solo dashboard/profiles para la carga administrativa;
  no invocaciones a tarjetas/tokens ni mutaciones REST. No exportar HAR sin sanear.
- Controles deshabilitados, aviso visible, logout y portal sin membresía intactos.
- Respuestas no incluyen credenciales; no-store. No guardar sesiones/JWT en informes.

Esta aceptación NO valida el aislamiento completo de RLS ni el recorrido NFC/QR.
La autenticación real puede crear/renovar sesiones de Auth; requiere autorización
para usar las cuentas existentes, aunque no se modifiquen datos de la aplicación.

### E. Detención y recuperación

Si falla aceptación, detener las pruebas y no habilitar escrituras. Como la función
no existía antes, su retirada sería una operación externa nueva que necesita
autorización; no restaurar una versión anterior que permita escrituras. Conservar
el commit revisado, el estado previo de configuración y registros saneados.
No hay migraciones ni cambios de datos que revertir.

Referencias: https://supabase.com/docs/guides/functions/deploy y
https://supabase.com/docs/guides/functions/secrets .
