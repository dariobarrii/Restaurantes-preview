import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {Script} from 'node:vm';import {serializeCsv} from '../../nq-central-data.mjs';
const html=await readFile('index.html','utf8');
test('actual admin CSV neutralizes formula fields and uses proper row boundaries',async()=>{
 const start=html.indexOf('function exportAdminReport()'),end=html.indexOf('\n',start);let blob;
 class TestURL{static createObjectURL(value){blob=value;return'blob:unit'}static revokeObjectURL(){}}
 const row={business_id:'a',event_type:'nfc_tap',created_at:'2026-10-19T12:00:00Z',device_type:'mobile',source:'@unit_formula'};
 const c={serializeCsv,adminCache:{businesses:[{id:'a',name:'=1+1'}]},adminFilteredEvents:()=>[row],adminFmtDate:()=> '19/10/2026',adminDateKey:()=> '2026-10-19',Blob,URL:TestURL,document:{createElement:()=>({click(){}})}};
 new Script(html.slice(start,end)).runInNewContext(c);c.exportAdminReport();const csv=await blob.text();assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('"\'@unit_formula"'));assert.deepEqual(Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0,3)),[239,187,191]);assert.ok(csv.includes('\r\n'));
});

test('legacy card destinations cannot create executable or credential-bearing links',()=>{
 const funcs=['safeCardDestination','cardDestinationLink'].map(name=>{const start=html.indexOf('function '+name+'(');assert.ok(start>=0);return html.slice(start,html.indexOf('\n',start))}).join('\n');
 const c={URL,esc:value=>String(value).replace(/"/g,'&quot;')};new Script(funcs).runInNewContext(c);
 for(const value of ['javascript:alert(1)','http://example.invalid','https://user:pass@example.invalid',null])assert.ok(!c.cardDestinationLink(value).includes('href='));
 assert.ok(c.cardDestinationLink('https://maps.google.com/').includes('href="https://maps.google.com/"'));
 assert.ok(html.includes('cardDestinationLink(x.target_url)'));
});

test('actual administrative today count uses Madrid calendar boundaries',async()=>{
 const line=name=>{const start=html.indexOf(name);return html.slice(start,html.indexOf('\n',start))};
 class FixedDate extends Date{constructor(value){super(value===undefined?'2026-10-18T22:30:00Z':value)}setHours(...args){return this.setUTCHours(...args)}}
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',addEventListener(){}});return nodes.get(id)};
 const c={Date:FixedDate,Intl,$,clear(){},msg(){},adminCache:{},adminRequest:async()=>({businesses:[],events:[{event_type:'nfc_tap',created_at:'2026-10-18T21:30:00Z'},{event_type:'qr_scan',created_at:'2026-10-18T22:15:00Z'}],reviews:[],profiles:[]}),renderAdminOverview(){},renderAdminReports(){},renderAdminMonitor(){},loadAdminCards:async()=>{},loadUsers:async()=>{},populateMemberSelectors:async()=>{},document:{querySelectorAll:()=>[]}};
 new Script(line('function adminDateKey(')+'\n'+line('async function load()')).runInNewContext(c);await c.load();assert.equal(nodes.get('todayEvents').textContent,'1');
});
