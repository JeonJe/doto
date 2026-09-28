import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {updateFixture} from './update-fixture.mjs';
const server=fileURLToPath(new URL('../server.mjs',import.meta.url));
test('일괄 업데이트: 사전 검증, 중복 실행 방지, 순차 실행, 부분 실패와 재실행 복구',{timeout:25000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'doto-bulk-'));let child;
 try{
  const {bin}=await updateFixture(dir);
  const start=async()=>{child=spawn(process.execPath,[server],{env:{HOME:dir,PATH:bin+':/usr/bin:/bin',MOMO_DATA_DIR:dir,MOMO_PORT:'0'},stdio:['ignore','pipe','pipe']});return await new Promise((resolve,reject)=>{child.stdout.once('data',buf=>resolve(String(buf).trim().slice(5)));child.once('error',reject);});};
  let origin=await start();const get=async()=>await(await fetch(origin+'/api/state')).json();const post=data=>fetch(origin+'/api/manage',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await get()).watches.find(w=>w.id==='news').canUpdate,false);
  assert.equal((await post({action:'update-many',ids:['npm-success','news']})).status,409);
  assert.equal((await post({action:'update-many',ids:['npm-success','npm-success']})).status,400);
  const concurrent=await Promise.all(Array.from({length:4},()=>post({action:'update-many',ids:['npm-success','npm-failure','brew-success']})));
  assert.equal(concurrent.filter(r=>r.status===200).length,1);assert.equal(concurrent.filter(r=>r.status===409).length,3);
  assert.equal((await post({action:'remove',id:'brew-success'})).status,409);
  let state;for(let i=0;i<100;i++){state=await get();if(!state.updateBatch?.running)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(state.updateBatch.running,false);assert.deepEqual(state.updateBatch.items.map(i=>i.status),['succeeded','failed','succeeded']);
  assert.equal(state.watches[0].installedVersion,'2.0.0');assert.equal(state.watches[0].update,null);assert.ok(state.watches[1].update);assert.ok(state.watches[3].update);
  assert.deepEqual((await readFile(path.join(dir,'commands.log'),'utf8')).trim().split('\n'),['start npm test-success@2.0.0','end npm test-success@2.0.0','start npm test-failure@2.0.0','end npm test-failure@2.0.0','start brew test-brew','end brew test-brew']);
  let end=once(child,'exit');child.kill();await end;
  const persisted=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));assert.equal(persisted.updateBatch.items[1].status,'failed');
  persisted.updateBatch.running=true;persisted.updateBatch.items[1].status='queued';await writeFile(path.join(dir,'state.json'),JSON.stringify(persisted));
  origin=await start();state=await get();assert.equal(state.updateBatch.running,false);assert.equal(state.updateBatch.items[1].status,'failed');assert.match(state.updateBatch.items[1].error,/중단/);
 }finally{if(child?.exitCode===null){const end=once(child,'exit');child.kill();await end;}await rm(dir,{recursive:true,force:true});}
});
