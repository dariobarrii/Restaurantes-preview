# Auditoría inicial de seguridad — 19 octubre 2026

Inspección de solo lectura. No certifica que el sistema esté libre de vulnerabilidades.

## Entornos identificados
- Portal existente: proyecto Supabase Tzura SteakHouse (qcvhxrudzjlgqlhvnkkl).
- Entorno de pruebas de seguridad: NQ Central Security Test (rxxbmqilnozcnpwguqga).
- El index.html de Restaurantes-preview referencia actualmente el proyecto Tzura SteakHouse. No cambiarlo sin plan de migración.

## Avisos del asesor de seguridad
- Ambos proyectos: leaked password protection disabled (WARN). Evaluar disponibilidad, costo y activación autorizada antes de cambiar Auth.
- Proyecto portal: RLS sin políticas en nfc_events, nfc_stats y veta_daily_review_totals (INFO). Puede ser intencional; comprobar roles/grants y rutas de escritura antes de agregar políticas.
- Proyecto test: RLS sin políticas en siete tablas técnicas, incluidas nfc_events y tablas de tokens/rate limit (INFO). No habilitar acceso público por reflejo.
- Documentación: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- Documentación: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Políticas observadas en el portal
- app_profiles: select self/admin, update self/admin.
- app_businesses: select público de aprobados, select miembro/admin, escritura admin.
- app_events: select miembro/admin e insert admin.
- app_review_snapshots: select miembro/admin, insert miembro, escritura admin.
- La existencia de políticas NO demuestra aislamiento correcto: revisar expresiones USING/WITH CHECK y ejecutar pruebas con dos usuarios de negocios distintos.

## Siguientes comprobaciones
- [ ] Revisar definiciones de políticas y funciones auxiliares sin cambios de esquema.
- [ ] Validar permisos cruzados con cuentas de prueba.
- [ ] Probar recuperación de contraseña con enlace real y configuración Auth Redirect URLs.
- [ ] Revisar los avisos y decidir acciones antes de publicar.

No modificar main ni producción sin revisión explícita.