// Execute real Edge handler source with local clients only. No requests to Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { Script } from 'node:vm';
import { webcrypto } from 'node:crypto';
const cardId='11111111-1111-4111-8111-111111111111';
const sources=Object.fromEntries(await Promise.all(['manage-business-card-token','register-business-card-event'].map(async name=>[name,stripTypeScriptTypes((await readFile(`supabase/functions/${name}/index.ts`,'utf8')).replace(/^import .*;\r?\n/gm,''))])));

function fixture(name,{approved=true,tokenError=false,cardState='active',archived=false,businessApproved=true,missingCard=false,globalAllowed=true,rpcResult={ok:true,target_url:'https://example.invalid/destination'}}={}) {
  let handler;const writes=[],rpcs=[];let authCalls=0;
  const client={auth:{getUser:async()=>{authCalls++;return{data:{user:{id:cardId}},error:null}}},rpc:async(operation,params)=>{rpcs.push({operation,params});return{data:operation==='consume_business_card_rate_limit'?globalAllowed:rpcResult,error:null}},from(table){let patch;const q={select(){return q},eq(){return q},update(value){patch=value;writes.push({table,value});return q},upsert(value){writes.push({table,value});return Promise.resolve({error:tokenError?{}:null})},async maybeSingle(){
    if(table==='app_profiles')return{data:{role:'admin',status:approved?'approved':'pending'},error:null};
    if(table==='app_business_cards')return{data:missingCard?null:{id:cardId,business_id:cardId,status:cardState,archived_at:archived?'2026-10-19T00:00:00Z':null},error:null};
    if(table==='app_businesses')return{data:{status:businessApproved?'approved':'pending'},error:null};
    return{data:{card_id:cardId,...patch},error:tokenError?{}:null};
  }};return q}};
  const env={ADMIN_ALLOWED_ORIGINS:'https://unit.invalid',SUPABASE_URL:'https://unit.invalid',SUPABASE_ANON_KEY:'unit-placeholder',SUPABASE_SERVICE_ROLE_KEY:'unit-server-placeholder',NQ_GATEWAY_SHARED_SECRET:'unit-gateway-placeholder'};
  new Script(sources[name]).runInNewContext({Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn}},createClient:()=>client,URL,Response,TextEncoder,TextDecoder,Uint8Array,crypto:{subtle:webcrypto.subtle,getRandomValues:bytes=>bytes.fill(0x11)},console:{error(){}}});
  return{writes,rpcs,get authCalls(){return authCalls},async invoke(body,{type='application/json',stream,gatewaySecret=env.NQ_GATEWAY_SHARED_SECRET}={}){
    const request=new Request('https://unit.invalid/edge',{method:'POST',headers:{origin:'https://unit.invalid',authorization:'Bearer unit-user-placeholder','x-nq-gateway-secret':gatewaySecret,'content-type':type},body:stream||JSON.stringify(body),...(stream?{duplex:'half'}:{})});
    if(stream) request.text=async()=>{throw new Error('Unbounded req.text must not be used in this streamed-body test')};
    const response=await handler(request);return{status:response.status,body:await response.json()};
  }};
}

test('credential body is stream-bounded and cancelled before authorization',async()=>{
  const f=fixture('manage-business-card-token');let cancelled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(4097))},cancel(){cancelled=true}});
  const r=await f.invoke(null,{stream});assert.equal(r.status,413);assert.equal(cancelled,true);assert.equal(f.authCalls,0);assert.equal(f.writes.length,0);
});

test('credential operations reject unapproved users and unexpected fields',async()=>{
  assert.equal((await fixture('manage-business-card-token',{approved:false}).invoke({operation:'issue',card_id:cardId})).status,403);
  const f=fixture('manage-business-card-token');const result=await f.invoke({operation:'issue',card_id:cardId,business_id:cardId});assert.equal(result.status,400);assert.equal(f.writes.length,0);
});

test('issue stores only a digest and returns the unit token only on success',async()=>{
  const f=fixture('manage-business-card-token'),r=await f.invoke({operation:'issue',card_id:cardId});assert.equal(r.status,201);assert.equal(r.body.token,'11'.repeat(32));assert.match(f.writes[0].value.token_hash,/^[a-f0-9]{64}$/);assert.notEqual(f.writes[0].value.token_hash,r.body.token);assert.equal(f.writes[0].value.token,undefined);
  const failed=await fixture('manage-business-card-token',{tokenError:true}).invoke({operation:'rotate',card_id:cardId});assert.equal(failed.status,503);assert.equal(failed.body.token,undefined);
});

test('revoke disables the credential without returning its original token',async()=>{
  const f=fixture('manage-business-card-token'),r=await f.invoke({operation:'revoke',card_id:cardId});assert.equal(r.status,200);assert.equal(r.body.token,undefined);assert.equal(f.writes[0].value.active,false);
});

test('registration rejects an unsupported media type before calling RPCs',async()=>{
  const f=fixture('register-business-card-event'),r=await f.invoke({card_id:cardId,token:'11'.repeat(32)},{type:'text/plain'});assert.equal(r.status,415);assert.equal(f.rpcs.length,0);
});

test('registration error response never forwards extra RPC fields',async()=>{
  const f=fixture('register-business-card-event',{rpcResult:{ok:false,error:'invalid_card',target_url:'https://example.invalid/private',debug:'unit-private-placeholder'}});
  const r=await f.invoke({card_id:cardId,token:'11'.repeat(32),device_type:'mobile'});assert.equal(r.status,200);assert.deepEqual(r.body,{ok:false,error:'invalid_card'});
});

test('registration hashes the raw unit token and preserves device contract',async()=>{
  const f=fixture('register-business-card-event'),r=await f.invoke({card_id:cardId,token:'11'.repeat(32),device_type:'tablet'});assert.equal(r.status,200);assert.equal(r.body.target_url,'https://example.invalid/destination');const call=f.rpcs.find(x=>x.operation==='register_business_card_event_with_token');assert.equal(call.params.p_card_id,cardId);assert.equal(call.params.p_device_type,'tablet');assert.notEqual(call.params.p_token_hash,'11'.repeat(32));
});


test('credential creation rejects inactive, archived, missing cards and unapproved businesses',async()=>{
 for(const [options,status] of [[{cardState:'inactive'},404],[{archived:true},404],[{missingCard:true},404],[{businessApproved:false},409]]){
  const f=fixture('manage-business-card-token',options),r=await f.invoke({operation:'rotate',card_id:cardId});assert.equal(r.status,status);assert.equal(r.body.token,undefined);assert.equal(f.writes.length,0);
 }
});
test('public registration cannot bypass the gateway header',async()=>{
 const f=fixture('register-business-card-event'),r=await f.invoke({card_id:cardId,token:'11'.repeat(32)},{gatewaySecret:'wrong-unit-placeholder'});assert.equal(r.status,403);assert.equal(f.rpcs.length,0);
});
test('global limits and limiter failures prevent a registration RPC',async()=>{
 for(const [globalAllowed,status] of [[false,429],[null,429]]){const f=fixture('register-business-card-event',{globalAllowed}),r=await f.invoke({card_id:cardId,token:'11'.repeat(32)});assert.equal(r.status,status);assert.equal(f.rpcs.length,1)}
});
test('invalid identifiers, raw tokens and device values never call registration',async()=>{
 for(const patch of [{card_id:'other'},{token:'invalid'},{device_type:'iOS'}]){const f=fixture('register-business-card-event'),r=await f.invoke({card_id:cardId,token:'11'.repeat(32),...patch});assert.equal(r.status,400);assert.equal(f.rpcs.filter(x=>x.operation==='register_business_card_event_with_token').length,0)}
});
