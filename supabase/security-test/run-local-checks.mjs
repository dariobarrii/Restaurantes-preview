// Explicitly local-only suite. Never discovers or runs the staging fixture.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const checks=['supabase/security-test/staging-acceptance.mjs','supabase/security-test/postgres-validation.mjs','nq-central-data.mjs'];
for(const file of checks){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status!==0)process.exit(1)}
const html=readFileSync('index.html','utf8');
const inline=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!m[1].includes('src='));
for(const [,attrs,code] of inline){
 const args=attrs.includes('module')?['--input-type=module','--check']:['--check'];
 const r=spawnSync(process.execPath,args,{input:code,encoding:'utf8'});
 if(r.status!==0){process.stderr.write(r.stderr);process.exit(1)}
}

const suites=['supabase/security-test/staging-integration-static.mjs','supabase/security-test/admin-creation-local.test.mjs','workers/nq-central-card-gateway/src/index.test.mjs','supabase/security-test/postgres-plan-local.test.mjs','supabase/security-test/portal-data-local.test.mjs','supabase/security-test/profile-local.test.mjs','supabase/security-test/card-credentials-local.test.mjs','supabase/security-test/card-flow-local.test.mjs'];
const result=spawnSync(process.execPath,['--test',...suites],{stdio:'inherit'});process.exit(result.status??1);
