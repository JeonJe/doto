import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const server=fileURLToPath(new URL('../server.mjs',import.meta.url));
test('중복 CLI 설치는 선택 전 업데이트를 막고 선택한 절대 경로만 업데이트/검증한다',{timeout:20000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'doto-path-'));let child;
 try{
  const a=path.join(dir,'a'),b=path.join(dir,'b');for(const folder of[a,b]){await mkdir(folder);await writeFile(path.join(folder,'claude.version'),'1.0.0');await writeFile(path.join(folder,'claude'),'#!/bin/sh\nif [ "$1" = "--version" ]; then /bin/cat "$0.version"; elif [ "$2" = "--help" ]; then echo update; else echo 2.0.0 > "$0.version"; fi\n',{mode:0o755});}
  await writeFile(path.join(dir,'fetch.mjs'),'globalThis.fetch=async()=>new Response(JSON.stringify({version:"2.0.0"}),{status:200});');
  await writeFile(path.join(dir,'state.json'),JSON.stringify({onboarded:true,notifications:[],watches:[{id:'claude',name:'Claude Code',source:'npm',target:'@anthropic-ai/claude-code',installedVersion:'1.0.0',version:'2.0.0',update:{before:'1.0.0',version:'2.0.0'},hours:6,nextCheck:Date.now()+86400000,status:'ok'}]}));
  const start=async(searchPath)=>{child=spawn(process.execPath,['--import',path.join(dir,'fetch.mjs'),server],{env:{HOME:dir,PATH:searchPath,MOMO_DATA_DIR:dir,MOMO_PORT:'0'},stdio:['ignore','pipe','pipe']});return await new Promise((resolve,reject)=>{child.stdout.once('data',d=>resolve(String(d).trim().slice(5)));child.once('error',reject);});};
  let origin=await start(`${a}:${b}:/usr/bin:/bin`);const state=async()=>await(await fetch(origin+'/api/state')).json();const post=data=>fetch(origin+'/api/manage',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
  let s=await state();assert.equal(s.watches[0].canUpdate,false);assert.equal(s.watches[0].installLocations.length,2);assert.equal((await post({action:'update',id:'claude'})).status,409);
  assert.equal((await post({action:'select-location',id:'claude',locationId:'/bin/sh'})).status,400);
  const chosen=s.watches[0].installLocations.find(x=>x.path===path.join(b,'claude'));
  assert.equal((await post({action:'select-location',id:'claude',locationId:chosen.id})).status,200);
  for(let i=0;i<80;i++){s=await state();if(!s.checking)break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(s.watches[0].canUpdate,true);assert.equal((await post({action:'update',id:'claude'})).status,200);
  for(let i=0;i<80;i++){s=await state();if(!s.updatingId)break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(s.watches[0].installedVersion,'2.0.0');assert.equal(s.watches[0].updateVerification.path,path.join(b,'claude'));assert.equal((await readFile(path.join(a,'claude.version'),'utf8')).trim(),'1.0.0');assert.equal((await readFile(path.join(b,'claude.version'),'utf8')).trim(),'2.0.0');
  let end=once(child,'exit');child.kill();await end;
  await rm(path.join(b,'claude'));origin=await start(`${a}:/usr/bin:/bin`);s=await state();assert.equal(s.watches[0].canUpdate,false);assert.equal(s.watches[0].selectedLocationId,chosen.id);assert.match(s.watches[0].installationIssue,/찾지 못/);
 }finally{if(child?.exitCode===null){const end=once(child,'exit');child.kill();await end;}await rm(dir,{recursive:true,force:true});}
});
test('npm 중복 설치는 선택한 전역 루트에만 쓰고 다른 루트의 버전으로 성공 판정하지 않는다',{timeout:20000},async()=>{
 const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'doto-npm-path-')));let child;
 try{
  const fs=await import('node:fs/promises');const bins=[];const roots=[];
  for(const name of ['a','b']){
   const bin=path.join(dir,name,'bin'),root=path.join(dir,name,'lib','node_modules');bins.push(bin);roots.push(root);await mkdir(path.join(root,'test-tool'),{recursive:true});await mkdir(bin,{recursive:true});await fs.symlink(process.execPath,path.join(bin,'node'));await writeFile(path.join(root,'test-tool','package.json'),JSON.stringify({name:'test-tool',version:'1.0.0'}));
   await writeFile(path.join(bin,'npm'),`const fs=require('fs'),path=require('path');const args=process.argv.slice(2);if(args[0]==='root')console.log(${JSON.stringify(root)});else {const prefix=args[args.indexOf('--prefix')+1];if(prefix!==${JSON.stringify(path.join(dir,name))})process.exit(2);fs.writeFileSync(path.join(prefix,'lib/node_modules/test-tool/package.json'),JSON.stringify({name:'test-tool',version:'2.0.0'}));}`);
  }
  await writeFile(path.join(dir,'fetch.mjs'),'globalThis.fetch=async()=>new Response(JSON.stringify({version:"2.0.0"}),{status:200});');
  await writeFile(path.join(dir,'state.json'),JSON.stringify({onboarded:true,notifications:[],watches:[{id:'tool',name:'Tool',source:'npm',target:'test-tool',installation:{id:'npm:test-tool',manager:'npm'},version:'2.0.0',installedVersion:'1.0.0',update:{version:'2.0.0'},status:'ok',hours:6,nextCheck:Date.now()+86400000}]}));
  child=spawn(process.execPath,['--import',path.join(dir,'fetch.mjs'),server],{env:{HOME:dir,PATH:bins.join(':')+':/usr/bin:/bin',MOMO_DATA_DIR:dir,MOMO_PORT:'0'},stdio:['ignore','pipe','pipe']});const origin=await new Promise((resolve,reject)=>{child.stdout.once('data',d=>resolve(String(d).trim().slice(5)));child.once('error',reject);});
  const state=async()=>await(await fetch(origin+'/api/state')).json();const post=data=>fetch(origin+'/api/manage',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
  let s=await state();assert.equal(s.watches[0].canUpdate,false);assert.equal(s.watches[0].installLocations.length,2);
  const chosen=s.watches[0].installLocations.find(x=>x.path===path.join(roots[1],'test-tool'));assert.equal((await post({action:'select-location',id:'tool',locationId:chosen.id})).status,200);
  for(let i=0;i<100;i++){s=await state();if(!s.checking)break;await new Promise(r=>setTimeout(r,30));}
  assert.equal((await post({action:'update',id:'tool'})).status,200);
  for(let i=0;i<100;i++){s=await state();if(!s.updatingId)break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(s.updateBatch.items[0].status,'succeeded');assert.equal(s.watches[0].updateVerification.path,chosen.path);
  assert.equal(JSON.parse(await readFile(path.join(roots[0],'test-tool/package.json'),'utf8')).version,'1.0.0');assert.equal(JSON.parse(await readFile(path.join(roots[1],'test-tool/package.json'),'utf8')).version,'2.0.0');
 }finally{if(child?.exitCode===null){const end=once(child,'exit');child.kill();await end;}await rm(dir,{recursive:true,force:true});}
});
