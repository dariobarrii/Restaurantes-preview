import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { chooseAuthorizedBusiness, readTenantPages, latestReviewDays, serializeCsv } from '../../nq-central-data.mjs';

test('selection preserves an authorized second business and rejects unknown IDs', () => {
  assert.equal(chooseAuthorizedBusiness([{id:'a'},{id:'b'}], 'b'), 'b');
  assert.equal(chooseAuthorizedBusiness([{id:'a'},{id:'b'}], 'other'), 'a');
  assert.equal(chooseAuthorizedBusiness([], 'a'), null);
});

test('pagination handles a server cap smaller than the requested range', async () => {
  const all = Array.from({length:1201}, (_,id)=>({id})), offsets=[];
  const rows = await readTenantPages(async (from) => { offsets.push(from); return { data:all.slice(from,from+200), count:all.length, error:null }; });
  assert.equal(rows.length,1201); assert.deepEqual(offsets,[0,200,400,600,800,1000,1200]);
});

test('pagination rejects truncation, count changes, duplicates and excessive history', async () => {
  for (const response of [{data:[],count:2},{data:[{id:1},{id:1}],count:2},{data:[],count:null},{data:[],count:50001}]) {
    await assert.rejects(readTenantPages(async()=>response));
  }
  let page=0;
  await assert.rejects(readTenantPages(async()=>++page===1?{data:[{id:1}],count:2}:{data:[{id:2}],count:3}));
});

test('review history uses latest opening/closing even when input order changes', () => {
  const rows=[{platform:'Google apertura',review_count:8,captured_at:'2026-10-19T08:00:00Z'},{platform:'Google cierre',review_count:12,captured_at:'2026-10-19T20:00:00Z'},{platform:'Google apertura',review_count:9,captured_at:'2026-10-19T09:00:00Z'}];
  for(const input of [rows,rows.toReversed()]) {
    const day=latestReviewDays(input,d=>d.toISOString().slice(0,10))['2026-10-19'];
    assert.equal(day.open.review_count,9);assert.equal(day.close.review_count,12);
  }
});

test('CSV emits a real BOM and rows and neutralizes spreadsheet formulas', () => {
  const csv=serializeCsv([['Fecha','Canal'],['19/10/2026','NFC'],['=1+1',' @formula'],['a"b','QR']]);
  assert.equal(csv.charCodeAt(0),0xfeff);assert.equal(csv.split('\r\n').length,5);
  assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('"\' @formula"'));assert.ok(csv.includes('"a""b"'));
  assert.ok(!csv.startsWith('\\ufeff'));
});

const html=await readFile('index.html','utf8');
// Execute the actual loadClient function in a local VM with an in-memory API.
// This proves browser behavior, not Supabase RLS or deployed integration.
function clientFixture() {
  const start=html.indexOf('async function loadClient(userId)'),end=html.indexOf("$('businessForm').onsubmit",start);
  assert.ok(start>=0&&end>start);
  const nodes=new Map();
  const element=id=>{
    if(!nodes.has(id)) nodes.set(id,{textContent:'',value:'',style:{setProperty(){}},_html:'',get innerHTML(){return this._html},set innerHTML(v){this._html=v;if(id==='clientBusinessSelect')this.value=v.match(/value="([^"]*)"/)?.[1]||''}});
    if(!nodes.get(id).classList){const classes=new Set();nodes.get(id).classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)}}
    return nodes.get(id);
  };
  const calls=[], errors=[];
  const date='2026-10-19T12:00:00Z';
  class FixedDate extends Date { constructor(value){super(value===undefined?date:value)} }
  const data={a:[],b:[]};
  const pending={};
  const supabase={from(table){let business;let from=0,to=499;const query={select(){return query},eq(key,value){if(key==='business_id')business=value;return query},lte(){return query},order(){return query},range(a,b){from=a;to=b;return query},then(resolve,reject){
    if(table==='app_business_members')return Promise.resolve({data:[{app_businesses:{id:'a',name:'A',status:'approved'}},{app_businesses:{id:'b',name:'B',status:'approved'}}],error:null}).then(resolve,reject);
    calls.push({table,business,from,to});
    return Promise.resolve(pending[business]).then(()=>({data:table==='app_business_events'?data[business].slice(from,Math.min(to+1,from+200)):[],count:table==='app_business_events'?data[business].length:0,error:null})).then(resolve,reject);
  }};return query}};
  const context=vm.createContext({supabase,$:element,chooseAuthorizedBusiness,readTenantPages,clear(){},msg(...x){errors.push(x)},esc:String,clientDateKey:(d=new FixedDate())=>d.toISOString().slice(0,10),clientOffset:(key,n)=>new Date(new Date(key+'T12:00:00Z').getTime()+n*86400000).toISOString().slice(0,10),clientFmtDate:String,window:{},document:{querySelectorAll:()=>[]},Date:FixedDate,Intl,console,updateInteractionView(){},updateReviewView(){},updateReportsView(){},currentUserId:null,clientLoadVersion:0,cachedClientEvents:[],cachedClientDaily:{},currentReviewsCache:[],clientChart:null,summaryWeekChart:null,interactionChart:null,reviewTrendChart:null,reviewVariationChart:null,reportCompareChart:null,reportMonthlyChart:null,reportDaysChart:null,reportHoursChart:null});
  const resetStart=html.indexOf('function resetClientData()'),resetEnd=html.indexOf('function resetPortalSession()',resetStart);
  assert.ok(resetStart>=0&&resetEnd>resetStart);vm.runInContext(html.slice(resetStart,resetEnd),context);
  vm.runInContext(html.slice(start,end),context);
  return {context,element,calls,errors,data,pending,date,load:()=>vm.runInContext("loadClient('unit-user')",context)};
}

test('real portal keeps business B selected and counts all NFC/QR beyond one API page',async()=>{
  const fixture=clientFixture();fixture.element('clientBusinessSelect').value='b';
  fixture.data.b=Array.from({length:1201},(_,id)=>({id,event_type:id===1200?'qr_scan':'nfc_tap',created_at:fixture.date,device_type:'mobile'}));
  await fixture.load();
  assert.equal(fixture.element('clientBusinessSelect').value,'b');
  assert.equal(fixture.element('clientNfcTotal').textContent,(1200).toLocaleString('es-ES'));
  assert.equal(fixture.element('clientQrTotal').textContent,'1');
  assert.ok(fixture.calls.every(c=>c.business==='b'));assert.deepEqual(fixture.errors,[]);
});

test('a failed refresh clears old totals and disables exporting cached rows',async()=>{
  const f=clientFixture();f.element('clientBusinessSelect').value='a';
  f.element('clientNfcTotal').textContent='stale';f.context.cachedClientEvents=[{id:'old'}];
  f.pending.a=Promise.reject(new Error('local API failure'));await f.load();
  assert.equal(f.element('clientNfcTotal').textContent,'—');assert.equal(f.context.cachedClientEvents.length,0);assert.equal(f.element('reportExport').disabled,true);assert.equal(f.errors.length,1);
});

test('session reset clears private caches/forms and invalidates in-flight loads',()=>{
  const f=clientFixture(),input={value:'private local placeholder',type:'password'};
  Object.assign(f.context,{portalSessionVersion:3,currentUserId:'old-user',adminCache:{events:[1]},adminCardsCache:[1],adminCardEvents:[1],cachedClientEvents:[{id:1}]});
  f.context.document.querySelectorAll=selector=>selector.includes('input')?[input]:[];
  const start=html.indexOf('function resetPortalSession()'),end=html.indexOf('supabase.auth.onAuthStateChange',start);
  vm.runInContext(html.slice(start,end)+'resetPortalSession();',f.context);
  assert.equal(f.context.portalSessionVersion,4);assert.equal(f.context.clientLoadVersion,1);assert.equal(f.context.currentUserId,null);
  assert.equal(f.context.cachedClientEvents.length,0);assert.equal(f.context.adminCardsCache.length,0);assert.equal(input.value,'');assert.equal(f.element('clientView').classList.contains('hidden'),true);
});

test('late business A response cannot overwrite a newer business B dashboard',async()=>{
  const f=clientFixture();let release;f.pending.a=new Promise(r=>{release=r});
  f.data.a=[{id:1,event_type:'nfc_tap',created_at:f.date}];f.data.b=[{id:2,event_type:'qr_scan',created_at:f.date}];
  f.element('clientBusinessSelect').value='a';const a=f.load();
  await new Promise(r=>setImmediate(r));f.element('clientBusinessSelect').value='b';await f.load();release();await a;
  assert.equal(f.element('clientBusinessTitle').textContent,'B');assert.equal(f.element('clientNfcTotal').textContent,'0');assert.equal(f.element('clientQrTotal').textContent,'1');
});
