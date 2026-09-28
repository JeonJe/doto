import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
const server=fileURLToPath(new URL('../server.mjs',import.meta.url));
test('예약이 지난 항목만 자동 조회하고 확인한 알림을 반복 생성하지 않는다', {timeout:45000}, async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'momo-schedule-'));let child;
 try{
  const clock=Date.now();const watch=(id,nextCheck)=>({id,name:id,source:'npm',target:id,hours:6,version:'1.0.0',lastCheck:clock-100000,nextCheck,status:'ok',demo:false});
  await writeFile(path.join(dir,'state.json'),JSON.stringify({watches:[watch('due',0),watch('later',clock+3600000)],notifications:[],onboarded:true}));
  const preload=path.join(dir,'fetch.mjs');await writeFile(preload,"globalThis.fetch=async()=>new Response(JSON.stringify({version:'1.1.0'}),{status:200});");
  child=spawn(process.execPath,['--import',preload,server],{env:{HOME:dir,PATH:'/usr/bin:/bin',MOMO_DATA_DIR:dir,MOMO_PORT:'0'},stdio:['ignore','pipe','pipe']});
  const origin=await new Promise((resolve,reject)=>{child.stdout.once('data',buf=>resolve(String(buf).trim().slice(5)));child.once('error',reject);});
  let state;const started=Date.now();
  while(Date.now()-started<38000){state=await(await fetch(origin+'/api/state')).json();if(state.notifications.length)break;await new Promise(r=>setTimeout(r,500));}
  assert.equal(state.notifications.length,1);assert.equal(state.watches[0].version,'1.1.0');assert.equal(state.watches[1].version,'1.0.0');assert.equal(state.watches[1].lastCheck,clock-100000);
  const post=body=>fetch(origin+'/api/manage',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  await post({action:'dismiss',id:state.notifications[0].id});await post({action:'check',id:'due'});
  for(let i=0;i<20;i++){state=await(await fetch(origin+'/api/state')).json();if(!state.checking)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(state.notifications.length,0);assert.ok(state.watches[0].update);const persisted=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));assert.equal(persisted.watches[0].version,'1.1.0');
 }finally{if(child?.exitCode===null){const end=once(child,'exit');child.kill('SIGTERM');await end;}await rm(dir,{recursive:true,force:true});}
});
