import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('// Shared gate'),html.indexOf("$('authForm').onsubmit="));
function fixture({profile={role:'restaurant',status:'approved'},profileError=null,sessionError=null,logoutError=null,wait=null}={}){
 const nodes=new Map(),messages=[],calls=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{add(){},remove(){}}});return nodes.get(id)};
 const ctx={$,portalSessionVersion:0,currentUserId:null,msg:(...args)=>messages.push(args),load:async()=>calls.push('admin'),loadClient:async id=>calls.push(id),resetPortalSession:()=>{ctx.portalSessionVersion++;calls.push('reset')},supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'user-a'}}},error:sessionError}),signOut:async()=>({error:logoutError})},from:table=>{assert.equal(table,'app_profiles');return{select(){return this},eq(key,value){assert.equal(key,'user_id');assert.equal(value,'user-a');return this},async maybeSingle(){if(wait)await wait;return{data:profile,error:profileError}}}}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return{ctx,calls,messages,enter:()=>ctx.enterPortal({id:'user-a',email:'a@example.invalid'}),restore:()=>ctx.restorePortalSession(),logout:()=>ctx.logoutPortal()};
}
for(const role of ['admin','restaurant'])test(`approved ${role} passes the shared login/restore gate`,async()=>{
 for(const method of ['enter','restore']){const f=fixture({profile:{role,status:'approved'}});await f[method]();assert.deepEqual(f.calls,[role==='admin'?'admin':'user-a']);}
});
for(const profile of [null,{role:'owner',status:'approved'},{role:'unexpected',status:'approved'},{role:'admin',status:'pending'},{role:'restaurant',status:'rejected'}])test(`denies unsupported/missing profile ${JSON.stringify(profile)}`,async()=>{
 const f=fixture({profile});await assert.rejects(f.enter());assert.deepEqual(f.calls,[]);
 await f.restore();assert.deepEqual(f.calls,['reset']);assert.equal(f.messages.at(-1)[2],true);
});
test('profile read failures are visible and never load a dashboard',async()=>{const f=fixture({profileError:{message:'denied'}});await f.restore();assert.deepEqual(f.calls,['reset']);assert.match(f.messages[0][1],/perfil/)});
test('session recovery errors are visible',async()=>{const f=fixture({sessionError:{message:'expired'}});await f.restore();assert.deepEqual(f.calls,['reset']);assert.match(f.messages[0][1],/sesión/)});
test('late profile cannot reopen a portal after logout/session replacement',async()=>{let release;const wait=new Promise(r=>release=r),f=fixture({wait});const pending=f.enter();f.ctx.portalSessionVersion++;release();await pending;assert.deepEqual(f.calls,[])});
test('logout clears private presentation and reports returned errors',async()=>{const f=fixture({logoutError:{message:'offline'}});await f.logout();assert.deepEqual(f.calls,['reset']);assert.equal(f.messages[0][2],true);assert.match(f.messages[0][1],/No se pudo confirmar/)});
test('successful logout reports confirmed completion',async()=>{const f=fixture();await f.logout();assert.equal(f.messages[0][1],'Sesión cerrada.');assert.notEqual(f.messages[0][2],true)});
test('an absent saved session leaves the login screen without data queries',async()=>{const f=fixture();f.ctx.supabase.auth.getSession=async()=>({data:{session:null},error:null});await f.restore();assert.deepEqual(f.calls,[]);assert.deepEqual(f.messages,[])});
test('a late saved session cannot reopen the portal after session replacement',async()=>{let release;const wait=new Promise(r=>release=r),f=fixture();f.ctx.supabase.auth.getSession=async()=>{await wait;return{data:{session:{user:{id:'user-a'}}},error:null}};const pending=f.restore();f.ctx.portalSessionVersion++;release();await pending;assert.deepEqual(f.calls,[])});
test('thrown logout failures are also reported without retaining private presentation',async()=>{const f=fixture();f.ctx.supabase.auth.signOut=async()=>{throw Error('offline')};await f.logout();assert.deepEqual(f.calls,['reset']);assert.equal(f.messages[0][2],true)});
test('administrative diagnostics distinguish status/network failures without raw server text',async()=>{const f=fixture();for(const [error,expected]of [[{context:{status:401}},/sesión/],[{context:{status:403}},/denegado/],[{context:{status:404}},/no está disponible/],[{context:{status:503}},/esquema/],[{name:'FunctionsFetchError'},/conectar/],[{message:'sensitive internal detail'},/datos administrativos/]]){const message=await f.ctx.administrativeErrorMessage(error);assert.match(message,expected);assert.doesNotMatch(message,/sensitive internal detail|aplicar la migración/)}});
