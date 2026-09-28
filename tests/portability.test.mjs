import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const server=fileURLToPath(new URL('../server.mjs',import.meta.url));
async function launch(dir){
 const child=spawn(process.execPath,[server],{env:{PATH:'/usr/bin:/bin',HOME:dir,MOMO_DATA_DIR:dir,MOMO_PORT:'0'},stdio:['ignore','pipe','pipe']});
 const origin=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('readiness timeout')),10000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/MOMO (http:\/\/127\.0\.0\.1:\d+)\n/);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`early exit ${code}`));});});
 return{child,origin};
}
async function stop(child){if(child.exitCode!==null)return;const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
test('Node/npm/Homebrew 없는 도구 PATH와 분리된 사용자 데이터로 동적 포트 실행',async()=>{
 const dirs=await Promise.all([1,2].map(()=>mkdtemp(path.join(os.tmpdir(),'momo-clean-'))));const sessions=[];
 try{
  sessions.push(await launch(dirs[0]),await launch(dirs[1]));assert.notEqual(sessions[0].origin,sessions[1].origin);
  for(const {origin} of sessions){
   const state=await(await fetch(origin+'/api/state')).json();assert.equal(state.watches.length,0);assert.equal(state.onboarded,false);assert.ok(state.presets.every(p=>p.installedVersion===null));
   const catalog=await(await fetch(origin+'/api/installed')).json();assert.deepEqual(catalog.items,[]);assert.equal(catalog.warnings.length,0);assert.deepEqual(catalog.unavailable.sort(),['Homebrew','npm']);
   const page=await fetch(origin);assert.equal(page.status,200);
   const wrongOrigin=await fetch(origin+'/api/manage',{method:'POST',headers:{Origin:sessions.find(s=>s.origin!==origin).origin,'Content-Type':'application/json'},body:'{"action":"check"}'});assert.equal(wrongOrigin.status,403);
   const validOrigin=await fetch(origin+'/api/manage',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"action":"check"}'});assert.equal(validOrigin.status,200);
  }
 }finally{await Promise.all(sessions.map(s=>stop(s.child)));await Promise.all(dirs.map(dir=>rm(dir,{recursive:true,force:true})));}
});
