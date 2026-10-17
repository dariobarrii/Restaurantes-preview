# Gateway abuse protection plan

Date: 2026-10-17
Status: branch implementation and unit tests; not deployed.

## Objective

Add per-client abuse protection to the public business-card scan flow without trusting caller-supplied IP headers and without exposing a gateway credential in browser code.

## Proposed request path

Phone / QR / NFC -> custom hostname on Cloudflare Worker -> Supabase Edge Function -> existing server-side token validation RPC.

The Worker obtains client identity from the platform-provided `CF-Connecting-IP` value, which is trustworthy only on requests actually received by Cloudflare. It must not accept a caller-provided substitute header. Apply a per-IP rate limit at the Worker/WAF layer and retain the database global ceiling as defense in depth.

## Origin protection (mandatory)

The Supabase Edge Function remains reachable at its native URL, so merely putting a Worker in front of it is not sufficient. Before cutover, add a server-side gateway-secret check to the Edge Function:
- Store a high-entropy secret in Supabase Edge Function secrets and as a Cloudflare Worker secret.
- The Worker forwards the secret in a dedicated header; browser code must never know or send it.
- The Edge Function rejects missing/incorrect secrets before parsing the body or consuming the database rate-limit bucket.
- The Worker must strip any incoming client header with the same name and set its own value.
- Rotate the secret if it is ever exposed; never put it in Git, HTML, client JavaScript, screenshots, or logs.
- Keep the native Supabase URL private from normal app navigation where practical, but do not treat obscurity as protection.

## Rate-limit design

- Use the trusted client IP only at the Cloudflare edge. Do not trust `X-Forwarded-For`, `X-Real-IP`, or `CF-Connecting-IP` values supplied directly to Supabase.
- Configure a per-IP threshold appropriate for legitimate shared restaurant Wi-Fi and mobile carrier NAT; monitor false positives before tightening.
- Preserve the database global ceiling as a fallback, not as the per-client control.
- Return generic 429 responses with `Cache-Control: no-store`; do not log raw bearer tokens or gateway secrets.
- If the chosen Cloudflare rate-limiting feature requires a paid plan, confirm pricing before enabling it. Do not purchase or change plans automatically.

## Cutover requirements

1. Add a gateway-secret gate to the branch Edge Function and unit/integration tests proving requests without the secret fail closed.
2. Implement the Worker as a separate deployable artifact, with tests for missing client identity, rate-limit rejection, request-size limit, CORS/preflight, and upstream errors.
3. Add configuration documentation for the custom hostname, DNS, Worker secret, Supabase secret, and edge rate-limit rule. No secret values belong in the repository.
4. Deploy to a non-production hostname and isolated Supabase project first.
5. Test both the Worker hostname and direct Supabase function URL. The direct URL must fail closed without the gateway secret.
6. Verify valid scan links, revoked/paused tokens, destination redirects, and event counts on real phone/QR/NFC.
7. Only after all gates pass, coordinate production secret setup, function deployment, DNS cutover, and migration 015. Never enable a half-configured cutover.

## Dependencies / blockers

- A Cloudflare account with permission to create Workers and configure DNS/custom hostnames.
- A domain the project owner controls and can point to Cloudflare.
- Secure secret configuration in both Cloudflare and Supabase.
- Isolated environment to validate the complete request path.
- Real phone and NFC/QR tags for final physical verification.

## Safety notes

This document is a plan only. It does not create DNS records, buy a domain or plan, add secrets, deploy a Worker, deploy an Edge Function, or change production data/settings. The existing production function must not be considered gateway-protected until the direct-origin negative test passes.
## Branch implementation update (2026-10-17)

- [x] Added an initial Cloudflare Worker gateway implementation at `supabase/gateway/cloudflare-worker.js`. It fails closed when required configuration is absent, limits body size, uses the edge-provided client identity, applies the configured rate-limiter binding, and injects the gateway secret server-side.
- [x] Added Node test cases at `supabase/gateway/cloudflare-worker.test.mjs` for missing configuration, missing client identity, rate-limit rejection, secret injection, origin allowlist, and body size.
- [x] Added a gateway-secret check to the branch Edge Function source. Requests without a configured secret or with a missing/mismatched `x-nq-gateway-secret` are rejected with 403 before database access.
- [x] Execute the Worker tests in CI; the initial gateway suite passed in run 2. The expanded suite passed in GitHub Actions run 11: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39039906031.
- [ ] Configure secrets in the isolated environment and prove that direct-origin requests fail closed while Worker-origin requests succeed.
- [ ] Do not deploy this branch Edge Function until the Worker, secret values, rate-limit binding, and endpoint are configured together. The production function remains unchanged.
- [x] Added GitHub Actions workflow `.github/workflows/gateway-tests.yml` to run the Worker unit tests on relevant branch pushes and pull requests.
- [x] Gateway unit tests passed in GitHub Actions run 2: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39039755958
- [x] Worker now fails closed when `ALLOWED_ORIGINS` is missing and returns a generic 502 if the upstream response cannot be read.
- [x] Expanded tests cover preflight, unsupported methods, rate-limiter exceptions, declared and actual body size, upstream network errors, and missing origin allowlist.
- [x] Confirmed expanded gateway test suite passed in CI run 16: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39040237509.
- [x] Security static checks run 89 passed: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39040237592.
- [ ] Production gateway configuration, direct-origin rejection, DNS/custom hostname, and phone-based scan flow remain unverified.


## Latest verification snapshot

- [x] Gateway tests pass in CI run 16: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39040237509.
- [x] Static security checks pass in CI run 89: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39040237592.
- [x] Added `supabase/gateway/README.md` deployment runbook with isolated validation and production release ordering.
- [ ] Infrastructure release gates remain open: no configured shared secret, no deployed isolated Worker/hostname, no verified real Cloudflare rate-limiter binding, and no phone/NFC/QR end-to-end proof. The available connected Supabase actions do not expose a safe secret-setting workflow; do not deploy the Edge Function before the secret is set out-of-band.
- [ ] Production migration 015, Edge Function deployment, DNS cutover, and PR merge remain intentionally blocked until those gates pass.


## Isolated function deployment update (2026-10-17)

- [x] Deployed the branch version of the gateway-protected business-card Edge Function as a separate test-only function, `register-business-card-event-secure-test`, in project `rxxbmqilnozcnpwguqga` (NQ Central Security Test). This does not replace the existing test function or production function.
- [x] Confirmed the isolated project's business-card rate-limit table, maintenance table, and RPC exist.
- [ ] Configure `NQ_GATEWAY_SHARED_SECRET` through Supabase's secret-management UI/CLI and configure the same random value as a Cloudflare Worker secret. No secret was generated, displayed, or stored in Git during this step.
- [ ] Deploy Worker to an isolated hostname and verify direct-origin rejection and successful gateway request. A function deployment alone does not prove gateway security end to end.
- [ ] Production release remains blocked pending Cloudflare configuration, isolated end-to-end tests, and physical NFC/QR validation.


## Follow-up CI verification (2026-10-17)

- [x] Security static checks passed in run 91: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39041399283.
- [x] Gateway tests passed in run 18: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39041399290.
- [ ] Deployed endpoint behavior has not been verified with an actual HTTP request because the available connected tools do not provide a safe invocation/test action. Do not infer end-to-end success from deployment status or unit tests alone.


## CI follow-up (2026-10-17, latest)

- [x] Gateway tests passed in run 19: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39042122907.
- [x] Security static checks passed in run 92: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39042122829.
- [ ] The remaining work is external runtime setup and end-to-end validation, not a known failing CI check: configure a unique shared secret in isolated Supabase and Cloudflare, provision the Worker rate-limiting binding/hostname, verify HTTP direct-origin rejection and successful gateway event, then test NFC/QR on devices.
- [ ] Keep production migration 015, production function deployment, DNS/frontend cutover, and PR merge on hold until the isolated request path is verified. No production changes were made as part of this follow-up.
