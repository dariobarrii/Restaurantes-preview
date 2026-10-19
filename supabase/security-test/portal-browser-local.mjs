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
const init=({role,noMembership=false,profileError=false,logoutError=false,login=false,loginError=false,adminStatus=null})=>{
 window.__nqQueries=[];window.__nqAdminCalls=[];const user={id:'unit-user-a',email:'unit@example.invalid'};
 const businesses=[{id:'unit-business-a',name:'Local A',status:'approved',category:null},{id:'unit-business-b',name:'Local B',status:'approved',category:null}];
 const day=new Date().toISOString();const events=[{id:1,business_id:businesses[0].id,event_type:'nfc_tap',created_at:day},{id:2,business_id:businesses[0].id,event_type:'qr_scan',created_at:day},{id:3,business_id:businesses[1].id,event_type:'qr_scan',created_at:day}];
 window.Chart=class{constructor(ctx,options){this.data=options.data;this.options=options.options}destroy(){}update(){}};
 window.__nqLocalSdk={auth:{getSession:async()=>({data:{session:login?null:{user}},error:null}),signInWithPassword:async()=>({data:{user:loginError?null:user},error:loginError?{message:'Credenciales de prueba incorrectas'}:null}),getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:logoutError?{message:'offline'}:null})},functions:{invoke:async(name,{body})=>{window.__nqAdminCalls.push({name,action:body.action});return({error:adminStatus?{context:{status:adminStatus}}:null,data:body.action==='dashboard'?{businesses,events,reviews:[],profiles:[{user_id:user.id,role:'admin',status:'approved'}]}:body.action==='cards'?{cards:[],events:[]}:{profiles:[{user_id:'unit-user-a',role:'admin',status:'approved'},{user_id:'unit-user-b',role:'restaurant',status:'approved'}]}})}},from(table){let biz;const q={select(){return q},eq(key,value){if(key==='business_id')biz=value;return q},order(){return q},lte(){return q},range(){return q},maybeSingle:async()=>({data:{user_id:user.id,status:'approved',role,full_name:'Local test'},error:profileError?{message:'profile denied'}:null}),then(ok,bad){window.__nqQueries.push({table,biz});const rows=table==='app_business_members'?(noMembership?[]:businesses).map(app_businesses=>({app_businesses})):table==='app_business_events'?events.filter(e=>e.business_id===biz):[];return Promise.resolve({data:rows,count:rows.length,error:null}).then(ok,bad)}};return q}};
};
const browser=await chromium.launch({headless:true,...(process.env.NQ_BROWSER_EXECUTABLE?{executablePath:process.env.NQ_BROWSER_EXECUTABLE}:{})});
let cases=0;const unexpected=[];
try{
 const scenarios=[{role:'restaurant'},{role:'admin'},{role:'restaurant',noMembership:true},{role:'unexpected'},{role:'admin',profileError:true},{role:'restaurant',logoutError:true},{role:'admin',login:true},{role:'restaurant',login:true},{role:'admin',adminStatus:404},{role:'admin',adminStatus:403},{role:'restaurant',login:true,loginError:true}];
 for(const scenario of scenarios)for(const width of [390,1280]){const{role}=scenario;
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});await context.addInitScript(init,scenario);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{const url=route.request().url();
   if(url===origin+'/index.html')return route.fulfill({contentType:'text/html',body:html});
   if(url===origin+'/nq-central-staging-config.js')return route.fulfill({contentType:'text/javascript',body:`window.NQ_CENTRAL_STAGING_CONFIG={supabaseUrl:'https://unit.invalid',publishableKey:'unit-placeholder',eventGatewayUrl:''};`});
   if(url===origin+'/nq-central-data.mjs')return route.fulfill({contentType:'text/javascript',body:await readFile(join(root,'nq-central-data.mjs'),'utf8')});
   if(url==='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')return route.fulfill({contentType:'text/javascript',body:sdk,headers:{'access-control-allow-origin':'*'}});
   if(url==='https://cdn.jsdelivr.net/npm/chart.js')return route.fulfill({contentType:'text/javascript',body:'/* Chart stub installed by init script. */'});
   if(url===origin+'/manifest.webmanifest')return route.fulfill({contentType:'application/manifest+json',body:await readFile(join(root,'manifest.webmanifest'),'utf8')});
   if(url.startsWith(origin+'/assets/pwa/')&&['icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png'].includes(url.split('/').pop()))return route.fulfill({contentType:'image/png',body:await readFile(join(root,'assets/pwa',url.split('/').pop()))});
   if(url===origin+'/favicon.ico')return route.fulfill({status:204});unexpected.push(url);return route.abort();
  });
  await page.goto(origin+'/index.html');
  if(scenario.login){await page.fill('#email','unit@example.invalid');await page.fill('#password','local-placeholder-only');await page.locator('#submitBtn').click();}
  if(role==='unexpected'||scenario.profileError||scenario.loginError){await page.waitForFunction(()=>document.querySelector('#loginStatus').classList.contains('show'));assert.equal(await page.locator('#clientView').evaluate(el=>el.classList.contains('hidden')),true);assert.equal(await page.locator('#appView').evaluate(el=>el.classList.contains('hidden')),true);assert.deepEqual(errors,[]);console.log(`PASS browser ${JSON.stringify(scenario)} viewport ${width}`);cases++;await context.close();continue;}
  if(scenario.adminStatus){await page.waitForFunction(()=>document.querySelector('#appStatus').classList.contains('show'));assert.match(await page.locator('#appStatus').textContent(),scenario.adminStatus===404?/no está disponible/:/denegado/);assert.deepEqual(errors,[]);console.log(`PASS browser ${JSON.stringify(scenario)} viewport ${width}`);cases++;await context.close();continue;}
  if(scenario.noMembership){await page.waitForFunction(()=>document.querySelector('#clientStatus').textContent.includes('todavía no tiene un negocio asignado'));assert.equal((await page.evaluate(()=>window.__nqQueries.filter(x=>x.table==='app_business_events'))).length,0);assert.deepEqual(errors,[]);console.log(`PASS browser ${JSON.stringify(scenario)} viewport ${width}`);cases++;await context.close();continue;}
  if(role==='restaurant'){
   await page.waitForFunction(()=>document.querySelector('#clientNfcToday')?.textContent==='1',null,{timeout:5000});
   await page.selectOption('#clientBusinessSelect','unit-business-b');
   await page.waitForFunction(()=>document.querySelector('#clientNfcToday')?.textContent==='0'&&document.querySelector('#clientQrToday')?.textContent==='1',null,{timeout:5000});
   assert.ok((await page.evaluate(()=>window.__nqQueries.filter(x=>x.table==='app_business_events'))).every(x=>x.biz));
  }else await page.waitForFunction(()=>document.querySelector('#totalNfc')?.textContent==='1'&&document.querySelector('#totalQr')?.textContent==='2',null,{timeout:5000});
  assert.deepEqual(errors,[],role+' browser errors');
  if(role==='admin'){await page.waitForFunction(()=>document.querySelectorAll('[data-user]').length>0);const calls=await page.evaluate(()=>window.__nqAdminCalls);assert.ok(calls.length>=2);assert.ok(calls.every(x=>x.name==='manage-business-administration'&&['dashboard','profiles'].includes(x.action)));assert.ok(calls.some(x=>x.action==='profiles'));const enabled=await page.locator('#businessForm input:not(:disabled),#businessForm select:not(:disabled),#businessForm button:not(:disabled),#memberForm input:not(:disabled),#memberForm select:not(:disabled),#memberForm button:not(:disabled),#adminCardForm input:not(:disabled),#adminCardForm select:not(:disabled),#adminCardForm button:not(:disabled),#adminCardsRefresh:not(:disabled),[data-user]:not(:disabled),[data-edit-business]:not(:disabled),[data-status]:not(:disabled)').count();assert.equal(enabled,0);assert.match(await page.locator('#adminReadOnlyNotice').textContent(),/solo lectura/);assert.equal(await page.locator('#businessesBody').textContent().then(t=>t.includes('Sin categoría')),true);}
  if(width===390){const touch=await page.locator(role==='restaurant'?'.client-nav button':'#refreshBtn').first().boundingBox();assert.ok(touch.height>=44,`${role}: touch target below 44px (${touch.height})`);const font=await page.locator(role==='restaurant'?'#clientBusinessSelect':'#adminReportBusiness').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert.ok(font>=16)}
  const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
  if(size.scroll>size.width+1) console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).slice(0,14).map(e=>({id:e.id,tag:e.tagName,class:e.className,width:Math.round(e.getBoundingClientRect().width)}))));
  assert.ok(size.scroll<=size.width+1,`${role} ${width}: horizontal overflow ${size.scroll}`);
  if(scenario.logoutError){await page.locator('#clientLogout').click();await page.waitForFunction(()=>document.querySelector('#loginStatus').textContent.includes('No se pudo confirmar'));assert.equal(await page.locator('#clientView').evaluate(el=>el.classList.contains('hidden')),true);assert.equal(await page.locator('#retryLogoutBtn').isVisible(),true);await page.locator('#retryLogoutBtn').click();await page.waitForFunction(()=>!document.querySelector('#retryLogoutBtn').classList.contains('hidden'));}
  console.log(`PASS browser ${JSON.stringify(scenario)} viewport ${width}: dashboard and isolation of client queries (API substituted)`);cases++;await context.close();
 }
 assert.deepEqual(unexpected,[]);console.log(`Browser cases passed: ${cases}; actual staging/RLS and chart library rendering not tested.`);
}finally{await browser.close()}
