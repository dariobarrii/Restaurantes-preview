// Browser + actual card/Worker/Edge code with a substituted SQL client.
// Every browser request is fulfilled locally or aborted; never contacts Supabase/Google.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createRequire,stripTypeScriptTypes} from 'node:module';import {Script} from 'node:vm';import {webcrypto,createHash} from 'node:crypto';import {join} from 'node:path';import worker from '../../workers/nq-central-card-gateway/src/index.mjs';
const require=createRequire(process.env.NQ_NODE_MODULES?join(process.env.NQ_NODE_MODULES,'package.json'):import.meta.url);let chromium;try{({chromium}=require('playwright'))}catch{throw Error('Use an existing Playwright installation via NQ_NODE_MODULES; no automatic install.')}
const html=await readFile('card.html','utf8'),source=stripTypeScriptTypes((await readFile('supabase/functions/register-business-card-event/index.ts','utf8')).replace(/^import .*;\r?\n/gm,''));
const origin='https://nq-browser-test.invalid',gateway='https://gateway.example.invalid/event',edge='https://rxxbmqilnozcnpwguqga.supabase.co/functions/v1/register-business-card-event';
const target='https://www.google.com/maps?cid=local-test-only',token='a'.repeat(64),card='11111111-1111-4111-8111-111111111111';
const secret='unit-browser-gateway-placeholder',digest=value=>createHash('sha256').update(value).digest('hex');
let state,handler;const env={SUPABASE_URL:'https://unit.invalid',SUPABASE_SERVICE_ROLE_KEY:'unit-server-placeholder',NQ_GATEWAY_SHARED_SECRET:secret};
new Script(source).runInNewContext({Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn}},URL,Response,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,console:{error(){}},createClient:()=>({rpc:async(name,params)=>{
 if(name==='consume_business_card_rate_limit')return{data:!state.globalLimited,error:null};
 assert.equal(name,'register_business_card_event_with_token');state.registrationCalls++;
 if(state.invalid||params.p_card_id!==card||params.p_token_hash!==digest(token))return{data:{ok:false,error:'invalid_card'},error:null};
 state.events.push({business_id:'unit-business-a',event_type:state.channel==='qr'?'qr_scan':'nfc_tap'});
 return{data:{ok:true,target_url:target},error:null};
}})});
const browser=await chromium.launch({headless:true,...(process.env.NQ_BROWSER_EXECUTABLE?{executablePath:process.env.NQ_BROWSER_EXECUTABLE}:{})});const realFetch=globalThis.fetch;let passed=0;const unexpected=[];
try{
 globalThis.fetch=async(url,options)=>{assert.equal(url,edge);if(state.upstreamFailure)throw Error('unit failure');return handler(new Request(url,options))};
 for(const scenario of [{name:'NFC',channel:'nfc',redirect:true},{name:'QR',channel:'qr',redirect:true},{name:'invalid credential',incoming:'b'.repeat(64),redirect:false},{name:'SQL invalid_card response',invalid:true,redirect:false},{name:'client limited',clientLimited:true,redirect:false},{name:'global limited',globalLimited:true,redirect:false},{name:'gateway upstream failure',upstreamFailure:true,redirect:false},{name:'malformed link',incoming:'invalid',redirect:false,noGateway:true}]){
  state={channel:'nfc',events:[],registrationCalls:0,...scenario};let calls=0;const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{const r=route.request(),url=r.url();
   if(url.startsWith(origin+'/card.html'))return route.fulfill({contentType:'text/html',body:html});
   if(url===origin+'/nq-central-staging-config.js')return route.fulfill({contentType:'text/javascript',body:`window.NQ_CENTRAL_STAGING_CONFIG={eventGatewayUrl:'${gateway}'};`});
   if(url===gateway){if(r.method()==='POST'){calls++;assert.equal(await page.evaluate(()=>location.hash),'');assert.equal(r.headers().referer,undefined)}
    const headers={...r.headers(),'cf-connecting-ip':'192.0.2.10'};const response=await worker.fetch(new Request(url,{method:r.method(),headers,...(r.method()==='POST'?{body:r.postData()}:{})}),{ALLOWED_ORIGINS:origin,STAGING_PROJECT_REF:'rxxbmqilnozcnpwguqga',SUPABASE_FUNCTION_URL:edge,NQ_GATEWAY_SHARED_SECRET:secret,RATE_LIMITER:{limit:async()=>({success:!state.clientLimited})}});
    const body=await response.text();assert.equal(body.includes(secret),false);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
   }
   if(url===target)return route.fulfill({contentType:'text/html',body:'<title>Local intercepted destination</title>'});
   if(url.endsWith('/favicon.ico'))return route.fulfill({status:204});unexpected.push(url);return route.abort();
  });
  await page.goto(origin+'/card.html?id='+card+'#token='+(scenario.incoming||token));
  if(scenario.redirect){await page.waitForURL(target,{timeout:5000});assert.equal(state.events.length,1);assert.equal(state.events[0].event_type,scenario.channel==='qr'?'qr_scan':'nfc_tap');assert.equal(calls,1)}
  else{await page.waitForFunction(()=>document.querySelector('#title').textContent==='No se pudo abrir la tarjeta',null,{timeout:5000});assert.equal(state.events.length,0);assert.notEqual(page.url(),target);if(scenario.noGateway)assert.equal(calls,0)}
  assert.deepEqual(errors,[]);console.log('PASS browser pipeline '+scenario.name+' (SQL client substituted)');passed++;await context.close();
 }
 const direct=await handler(new Request(edge,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({card_id:card,token})}));assert.equal(direct.status,403);passed++;
 assert.deepEqual(unexpected,[]);console.log('Browser pipeline checks passed: '+passed+'; RPC SQL/RLS, deployed endpoints and real Google Maps not tested.');
}finally{globalThis.fetch=realFetch;await browser.close()}
