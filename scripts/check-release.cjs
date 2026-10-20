// Static, offline pre-release checks. No credentials, network, or database writes.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
const checks = [
  ['HTML language and viewport', () => assert.match(html, /<html lang="es">[\s\S]*name="viewport"/)],
  ['NQ Business title', () => assert.match(html, /<title>NQ Business \| Portal multisectorial<\/title>/)],
  ['Admin branding', () => assert.match(html, /NQ CENTRAL ADMIN/)],
  ['Client sector label', () => assert.match(html, /id="clientSectorLabel"/)],
  ['Sector mapping', () => ['restaurant:', 'hair_salon:', 'barbershop:', 'beauty:', 'gym:'].forEach(x => assert.ok(html.includes(x), x))],
  ['Business membership lookup', () => assert.ok(html.includes("from('app_business_members')"))],
  ['Events and reviews lookup', () => ['app_business_events','app_business_review_snapshots'].forEach(x => assert.ok(html.includes("from('"+x+"')"), x))],
  ['Preserve selected business', () => assert.ok(html.includes('selectedBusinessId'))],
  ['No-business fallback', () => assert.ok(html.includes('Sin negocio asignado'))],
  ['Admin card control', () => assert.ok(html.includes('data-card-toggle'))],
  ['Client and admin views', () => ['id="clientView"','id="appView"'].forEach(x => assert.ok(html.includes(x), x))],
  ['No server service-role credentials', () => assert.doesNotMatch(html, /service_role|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/i)],
  ['Automatic business slug', () => assert.ok(html.includes('function nqSlugify(value)'))],
  ['Business slug manual override', () => assert.ok(html.includes('nqSlugEdited'))],
  ['Preselect created business for membership', () => assert.ok(html.includes("memberBusiness').value=created.id"))],
  ['Membership still needs admin confirmation', () => assert.ok(html.includes("memberForm').onsubmit=async"))],
  ['Balanced module script tag', () => assert.equal((html.match(/<script type="module">/g)||[]).length, 1)],
];
let failed = 0;
for (const [name, test] of checks) {
  try { test(); process.stdout.write('PASS ' + name + '\n'); }
  catch (error) { failed++; process.stderr.write('FAIL ' + name + ': ' + error.message + '\n'); }
}
process.stdout.write((checks.length-failed) + '/' + checks.length + ' static checks passed\n');
if (failed) process.exitCode = 1;
