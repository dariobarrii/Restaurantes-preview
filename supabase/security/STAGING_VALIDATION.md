# Staging security corrections and verification

These files are branch-only proposals. Nothing here has been applied to Supabase or deployed.

## RPC/table access control

Migration 016 explicitly revokes EXECUTE on the registration RPC from PUBLIC, anon and authenticated, then grants it to service_role. It also discovers the rate-limit RPC by catalog name and signature, restricts its EXECUTE to service_role, and asserts these effective permissions. It removes client INSERT on both event tables so a direct table write cannot bypass the gateway or invoke the legacy mirror; token-table access is limited to service_role.

Migration 018 similarly removes client EXECUTE from the SECURITY DEFINER legacy mirror trigger function. The existing trigger should continue to fire; confirm this in staging after the migration.

### Read-only staging verification

Review supabase/security/registration-privilege-checks.sql manually and run it only against the staging project. Expected results:
- registration and rate-limit functions: public_execute_acl=false, anon_can_execute=false, authenticated_can_execute=false, service_role_can_execute=true;
- legacy mirror: no PUBLIC/anon/authenticated EXECUTE;
- anon/authenticated INSERT=false on app_business_events and nfc_events;
- inspect RLS and remaining SELECT/UPDATE privileges against the actual portal behavior.

The migration contains post-change assertions, but they have not been run. These checks do not prove runtime isolation by themselves.

## Rate limits

The Edge Function has a global ceiling of 600 calls per 60 seconds and a per-card database cooldown of 2 seconds. The new Worker candidate adds a hashed per-client key using Cloudflare's trusted CF-Connecting-IP and a RATE_LIMITER binding. It fails closed if the client IP, binding, or limit service is unavailable. Its threshold/window must be configured in the Cloudflare binding by the operator; this branch does not configure or deploy a service. The Worker source was not present among the branch files that could be located, so the candidate lives under workers/nq-central-card-gateway and is not connected until its staging URL is reviewed and set in the blank frontend config.

## Historical events

Migration 017 imports only events with a source timestamp and a unique card/business or exact normalized business-name match. Ambiguous and unmatched names remain in nfc_events. Conflict handling inserts by legacy_event_id and only fills missing device/card attribution; it never overwrites an existing business_id, channel or timestamp. Migration 018 uses the card's business_id first, then a unique normalized name; it ignores rows with missing timestamp and leaves ambiguous rows unassigned.

## Test status

Offline source assertions and mocked Worker unit tests are prepared. They do not verify deployed Cloudflare limits, SQL ACLs, triggers, RLS, or two-restaurant isolation. Those checks remain pending in staging.
