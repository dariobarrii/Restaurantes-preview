// Real headless browser, all requests fulfilled locally or aborted. No Supabase traffic.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
const require=createRequire(process.env.NQ_NODE_MODULES?join(process.env.NQ_NODE_MODULES,'package.json'):import.meta.url);
let chromium;try{({chromium}=require('playwright'))}catch{throw Error('Playwright is unavailable. Set NQ_NODE_MODULES to an existing installation; do not install dependencies automatically.')}
const root=resolve('.'),origin='https://nq-browser-test.invalid';
const html=await readFile(join(root,'index.html'),'utf8');
const sdk=`export function createClient(){return window.__nqLocalSdk}`;
const init=({role})=>{
 window.__nqQueries=[];const user={id:'unit-user-a',email:'unit@example.invalid'};
 const businesses=[{id:'unit-business-a',name:'Local A',status:'approved',category:null},{id:'unit-business-b',name:'Local B',status:'approved',category:null}];
 const day=new Date().toISOString();const events=[{id:1,business_id:businesses[0].id,event_type:'nfc_tap',created_at:day},{id:2,business_id:businesses[0].id,event_type:'qr_scan',created_at:day},{id:3,business_id:businesses[1].id,event_type:'qr_scan',created_at:day}];
 window.Chart=class{constructor(ctx,options){this.data=options.data;this.options=options.options}destroy(){}update(){}};
 window.__nqLocalSdk={auth:{getSession:async()=>({data:{session:{user}},error:null}),getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},functions:{invoke:async(name,{body})=>({error:null,data:body.action==='dashboard'?{businesses,events,reviews:[],profiles:[{user_id:user.id,role:'admin',status:'approved'}]}:body.action==='cards'?{cards:[],events:[]}:{profiles:[]}})},from(table){let biz;const q={select(){return q},eq(key,value){if(key==='business_id')biz=value;return q},order(){return q},lte(){return q},range(){return q},maybeSingle:async()=>({data:{user_id:user.id,status:'approved',role,full_name:'Local test'},error:null}),then(ok,bad){window.__nqQueries.push({table,biz});const rows=table==='app_business_members'?businesses.map(app_businesses=>({app_businesses})):table==='app_business_events'?events.filter(e=>e.business_id===biz):[];return Promise.resolve({data:rows,count:rows.length,error:null}).then(ok,bad)}};return q}};
};
const browser=await chromium.launch({headless:true,...(process.env.NQ_BROWSER_EXECUTABLE?{executablePath:process.env.NQ_BROWSER_EXECUTABLE}:{})});
let cases=0;const unexpected=[];
try{
 for(const role of ['owner','admin'])for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});await context.addInitScript(init,{role});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{const url=route.request().url();
   if(url===origin+'/index.html')return route.fulfill({contentType:'text/html',body:html});
   if(url===origin+'/nq-central-staging-config.js')return route.fulfill({contentType:'text/javascript',body:`window.NQ_CENTRAL_STAGING_CONFIG={supabaseUrl:'https://unit.invalid',publishableKey:'unit-placeholder',eventGatewayUrl:''};`});
   if(url===origin+'/nq-central-data.mjs')return route.fulfill({contentType:'text/javascript',body:await readFile(join(root,'nq-central-data.mjs'),'utf8')});
   if(url==='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')return route.fulfill({contentType:'text/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}});
   if(url==='https://cdn.jsdelivr.net/npm/chart.js')return route.fulfill({contentType:'text/javascript',body:'/* Chart stub installed by init script. */'});
   if(url===origin+'/favicon.ico')return route.fulfill({status:204});unexpected.push(url);return route.abort();
  });
  await page.goto(origin+'/index.html');
  if(role==='owner'){
   await page.waitForFunction(()=>document.querySelector('#clientNfcToday')?.textContent==='1',null,{timeout:5000});
   await page.selectOption('#clientBusinessSelect','unit-business-b');
   await page.waitForFunction(()=>document.querySelector('#clientNfcToday')?.textContent==='0'&&document.querySelector('#clientQrToday')?.textContent==='1',null,{timeout:5000});
   assert.ok((await page.evaluate(()=>window.__nqQueries.filter(x=>x.table==='app_business_events'))).every(x=>x.biz));
  }else await page.waitForFunction(()=>document.querySelector('#totalNfc')?.textContent==='1'&&document.querySelector('#totalQr')?.textContent==='2',null,{timeout:5000});
  assert.deepEqual(errors,[],role+' browser errors');
  if(width===390){const touch=await page.locator(role==='owner'?'.client-nav button':'#refreshBtn').first().boundingBox();assert.ok(touch.height>=44,`${role}: touch target below 44px (${touch.height})`);const font=await page.locator(role==='owner'?'#clientBusinessSelect':'#adminReportBusiness').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert.ok(font>=16)}
  const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
  if(size.scroll>size.width+1) console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).slice(0,14).map(e=>({id:e.id,tag:e.tagName,class:e.className,width:Math.round(e.getBoundingClientRect().width)}))));
  assert.ok(size.scroll<=size.width+1,`${role} ${width}: horizontal overflow ${size.scroll}`);
  console.log(`PASS browser ${role} viewport ${width}: dashboard and isolation of client queries (API substituted)`);cases++;await context.close();
 }
 assert.deepEqual(unexpected,[]);console.log(`Browser cases passed: ${cases}; actual staging/RLS and chart library rendering not tested.`);
}finally{await browser.close()}
