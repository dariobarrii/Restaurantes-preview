import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const html=await readFile('card.html','utf8');
const source=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/run\(\);\s*$/,'');
async function open({configured=true,id='11111111-1111-4111-8111-111111111111',token='11'.repeat(32),result={ok:true,target_url:'https://example.invalid/destination'},status=200,networkFailure=false}={}){
 const elements=new Map();const requests=[],history=[],redirects=[];
 const context={URL,URLSearchParams,navigator:{userAgent:'iPad'},document:{getElementById(key){if(!elements.has(key))elements.set(key,{hidden:true,textContent:'',href:''});return elements.get(key)}},window:{NQ_CENTRAL_STAGING_CONFIG:configured?{eventGatewayUrl:'https://gateway.example.invalid/events'}:{}},location:{search:'?id='+id,hash:'#token='+token,pathname:'/card.html',replace:value=>redirects.push(value)},history:{replaceState:(a,b,url)=>history.push(url)},fetch:async(url,options)=>{assert.equal(history.length,1);requests.push({url,options});if(networkFailure)throw Error('unit failure');return{ok:status>=200&&status<300,json:async()=>result}},console:{error(){}}};
 new Script(source).runInNewContext(context);await context.run();return{elements,requests,history,redirects};
}
test('card scrubs the fragment even when the gateway is not configured',async()=>{const f=await open({configured:false});assert.equal(f.requests.length,0);assert.equal(f.history.length,1);assert.ok(!f.history[0].includes('token'));assert.equal(f.redirects.length,0)});
test('invalid credentials never call the gateway',async()=>{const f=await open({token:'invalid'});assert.equal(f.requests.length,0);assert.equal(f.redirects.length,0)});
test('valid card uses only the configured gateway with tablet device and no referrer',async()=>{const f=await open();assert.equal(f.requests.length,1);const r=f.requests[0];assert.equal(r.url,'https://gateway.example.invalid/events');assert.equal(r.options.referrerPolicy,'no-referrer');assert.equal(r.options.credentials,'omit');assert.equal(JSON.parse(r.options.body).device_type,'tablet');assert.deepEqual(f.redirects,['https://example.invalid/destination'])});
for(const error of ['invalid_card','rate_limited','global_rate_limited'])test(`card does not redirect on ${error}`,async()=>{const f=await open({result:{ok:false,error}});assert.equal(f.redirects.length,0);assert.notEqual(f.elements.get('message').textContent,'')});
test('unsafe destination and network failures never redirect',async()=>{for(const options of [{result:{ok:true,target_url:'javascript:alert(1)'}},{result:{ok:true,target_url:'https://user:pass@example.invalid'}},{networkFailure:true}]){const f=await open(options);assert.equal(f.redirects.length,0)}});
