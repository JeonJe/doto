import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const server=fileURLToPath(new URL('../server.mjs',import.meta.url));
test('여러 항목 빼기는 전체를 검증한 뒤 선택 항목과 알림만 제거하고 재시작 후 유지한다',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'doto-remove-'));let child;
 const watches=['a','b','c'].map(id=>({id,name:id,source:'github',target:`example/${id}`,hours:6,version:'1',status:'ok',nextCheck:Date.now()+86400000}));
 const start=async()=>{
  child=spawn(process.execPath,[server],{env:{PATH:'/usr/bin:/bin',MOMO_DATA_DIR:dir,MOMO_PORT:'0'},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{child.stdout.once('data',x=>resolve(String(x).trim().slice(5)));child.once('error',reject);child.once('exit',code=>reject(new Error(`테스트 서버 시작 실패: ${code}`)));});
 };
 const stop=async()=>{if(child?.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}};
 try{
  await writeFile(path.join(dir,'state.json'),JSON.stringify({watches,notifications:watches.map(w=>({id:`n-${w.id}`,watchId:w.id})),onboarded:true}));
  let origin=await start();
  const post=ids=>fetch(origin+'/api/manage',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'remove-many',ids})});
  const get=async()=>await(await fetch(origin+'/api/state')).json();
  for(const ids of [[],['a','a'],[null],Array.from({length:101},(_,i)=>String(i))])assert.equal((await post(ids)).status,400);
  assert.equal((await post(['a','missing'])).status,404);
  assert.deepEqual((await get()).watches.map(w=>w.id),['a','b','c']);
  assert.equal((await post(['a','c'])).status,200);
  let state=await get();assert.deepEqual(state.watches.map(w=>w.id),['b']);assert.deepEqual(state.notifications.map(n=>n.watchId),['b']);
  const persisted=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));assert.deepEqual(persisted.watches.map(w=>w.id),['b']);
  await stop();origin=await start();assert.deepEqual((await get()).watches.map(w=>w.id),['b']);
  assert.equal((await post(['b'])).status,200);state=await get();assert.deepEqual(state.watches,[]);assert.equal(state.onboarded,true);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
