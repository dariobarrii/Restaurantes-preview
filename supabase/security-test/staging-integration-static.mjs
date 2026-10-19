// Offline static checks for the staging integration. Run from repository root with Node.js.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const [index, card, rpc, issuer, migration] = await Promise.all([
 readFile("index.html","utf8"), readFile("card.html","utf8"),
 readFile("supabase/functions/register-business-card-event/index.ts","utf8"),
 readFile("supabase/functions/manage-business-card-token/index.ts","utf8"),
 readFile("supabase/migrations/016_secure_multi_business_card_events.sql","utf8"),
]);
assert.match(index,/\.eq\(['"]business_id['"],\s*businessId\)/);
assert.match(index,/manage-business-card-token/);
assert.doesNotMatch(index,/\.from\(['"]app_business_card_tokens['"]\)/);
assert.doesNotMatch(index,/\.from\(['"]nfc_events['"]\)\.insert/);
assert.match(card,/eventGatewayUrl/);
assert.match(card,/credentials:\s*['"]omit['"]/);
assert.doesNotMatch(card,/https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1/i);
assert.match(rpc,/x-nq-gateway-secret/);
assert.match(rpc,/register_business_card_event_with_token/);
assert.match(issuer,/crypto\.getRandomValues/);
assert.match(issuer,/SHA-256/);
assert.match(migration,/INSERT INTO public\.app_business_events/);
assert.match(migration,/v_card\.business_id/);
assert.doesNotMatch(migration,/INSERT INTO public\.nfc_events/i);
console.log("Staging integration static source checks passed.");
