import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root));
const manifest=JSON.parse(read('manifest.webmanifest'));
test('PWA identity, appearance and standalone entry',()=>{
 assert.equal(manifest.name,'NQ Central');
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.theme_color,'#0b0908');
 assert.equal(manifest.background_color,'#0b0908');
 assert.equal(manifest.id,'./');
 assert.equal(manifest.scope,'./');
 assert.equal(manifest.start_url,'./index.html');
});
test('relative resources resolve at domain root and GitHub Pages subdirectory',()=>{
 for(const base of ['https://example.test/','https://example.test/Restaurantes-preview/']){
  const url=new URL('manifest.webmanifest',base);
  for(const path of [manifest.id,manifest.scope,manifest.start_url,...manifest.icons.map(i=>i.src)]){
   assert.ok(path.startsWith('./'));
   const resolved=new URL(path,url);
   assert.ok(resolved.href.startsWith(base));
   assert.equal(resolved.search,''); assert.equal(resolved.hash,'');
  }
 }
});
test('PNG icons have valid dimensions and opaque pixels',()=>{
 const icons=[...manifest.icons,{src:'./assets/pwa/apple-touch-icon.png',sizes:'180x180'}];
 assert.ok(manifest.icons.some(i=>i.sizes==='192x192'&&i.purpose==='any'));
 assert.ok(manifest.icons.some(i=>i.sizes==='512x512'&&i.purpose==='any'));
 assert.ok(manifest.icons.some(i=>i.purpose==='maskable'));
 for(const icon of icons){
  const b=read(icon.src); assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const width=b.readUInt32BE(16),height=b.readUInt32BE(20);
  assert.equal(`${width}x${height}`,icon.sizes); assert.equal(b[25],2);
  const data=[]; for(let offset=8;offset<b.length;){const n=b.readUInt32BE(offset);if(b.toString('ascii',offset+4,offset+8)==='IDAT')data.push(b.subarray(offset+8,offset+8+n));offset+=12+n;}
  assert.equal(inflateSync(Buffer.concat(data)).length,height*(width*3+1));
 }
});
test('head references local manifest and iOS icon without service worker registration',()=>{
 const html=read('index.html').toString();
 assert.match(html,/<link rel="manifest" href="\.\/manifest\.webmanifest">/);
 assert.match(html,/<link rel="apple-touch-icon" sizes="180x180" href="\.\/assets\/pwa\/apple-touch-icon\.png">/);
 assert.doesNotMatch(html,/serviceWorker\s*\.\s*register|caches\s*\.\s*(?:open|put|add)/);
});
