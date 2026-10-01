import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {fileURLToPath} from 'node:url';
import {readLocalTool,compareReleaseVersions,repositoryKey} from '../local-tools.mjs';

test('공통 버전 비교는 접두사, 빌드 버전, 사전 버전과 비교 불가 태그를 구분',()=>{
 assert.equal(compareReleaseVersions('v1.4.217','1.4.215'),1);
 assert.equal(compareReleaseVersions('2.4','2.3'),1);
 assert.equal(compareReleaseVersions('2.4.1','2.4.1+build'),0);
 assert.equal(compareReleaseVersions('release-v2.4.1','2.4.0'),null);
 assert.equal(compareReleaseVersions('v2.4.1','2.4.1-beta'),1);
 assert.equal(compareReleaseVersions('v2.4.2-beta','2.4.1'),null);
 assert.equal(repositoryKey('git+https://github.com/example/tool.git'),'example/tool');
});
test('임의 앱과 CLI를 읽고 저장한 앱 식별자가 바뀌면 거절',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'doto-local-tool-'));
 try{
  const app=path.join(dir,'Novel Tool.app');await mkdir(path.join(app,'Contents'),{recursive:true});
  const resolvedApp=await realpath(app);
  let metadata={CFBundleIdentifier:'example.novel',CFBundleName:'Novel Tool',CFBundleShortVersionString:'3.0.0'};
  const run=async(command,args)=>{assert.equal(command,'/usr/bin/plutil');assert.equal(args.at(-1),path.join(resolvedApp,'Contents/Info.plist'));return JSON.stringify(metadata);};
  const result=await readLocalTool({kind:'app',path:app},run);assert.equal(result.version,'3.0.0');assert.equal(result.binding.bundleId,'example.novel');
  metadata.CFBundleIdentifier='example.other';await assert.rejects(readLocalTool(result.binding,run),/다른 앱/);
  const cli=path.join(dir,'novel-cli');await writeFile(cli,'fixture',{mode:0o755});
  const value=await readLocalTool({kind:'cli',path:cli},async(command,args)=>{assert.equal(command,cli);assert.deepEqual(args,['--version']);return 'novel-cli 3.0.0';});assert.equal(value.version,'3.0.0');
  await assert.rejects(readLocalTool({kind:'cli',path:'relative'},run),/경로/);
  await assert.rejects(readLocalTool({kind:'cli',path:cli},async()=> 'unknown'),/확인하지 못/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('임의 GitHub 저장소를 앱 또는 CLI와 연결하고 구독, 재연결, 재시작, 업데이트와 삭제를 구분',{skip:process.platform!=='darwin',timeout:25000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'doto-binding-'));let child;
 const appDir=path.join(dir,'Applications'),app=path.join(appDir,'Novel.app'),plist=path.join(app,'Contents/Info.plist'),cli=path.join(dir,'novel');
 const putVersion=version=>writeFile(plist,`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>example.novel</string><key>CFBundleName</key><string>Novel</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`);
 const stop=async()=>{if(child?.exitCode===null){const end=once(child,'exit');child.kill();await end;}};
 const start=async()=>{child=spawn(process.execPath,['--import',path.join(dir,'fetch.mjs'),fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{HOME:dir,PATH:'/usr/bin:/bin',MOMO_APPLICATIONS_DIR:appDir,MOMO_DATA_DIR:dir,MOMO_PORT:'0'},stdio:['ignore','pipe','pipe']});return new Promise((resolve,reject)=>{child.stdout.once('data',x=>resolve(String(x).trim().slice(5)));child.once('error',reject);child.once('exit',code=>reject(new Error(`server exited ${code}`)));});};
 try{
  await mkdir(path.dirname(plist),{recursive:true});await putVersion('1.0.0');await writeFile(cli,"#!/bin/sh\nprintf 'novel 1.5.0\\n'\n",{mode:0o755});
  await writeFile(path.join(dir,'fetch.mjs'),"globalThis.fetch=async()=>new Response(JSON.stringify({tag_name:'v2.0.0',version:'2.0.0'}),{status:200});");
  let origin=await start();const get=async()=>await(await fetch(origin+'/api/state')).json();
  const request=async(endpoint,data)=>{const response=await fetch(origin+'/api/'+endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:response.status,data:await response.json()};};
  const settle=async()=>{let s;for(let i=0;i<100;i++){s=await get();if(!s.checking)return s;await new Promise(r=>setTimeout(r,30));}throw new Error('확인 대기 초과');};
  const input='https://github.com/someone/novel';const preview=await request('preview',{input});assert.equal(preview.status,200);assert.equal(preview.data.binding,undefined);assert.ok(preview.data.candidates.some(c=>c.binding.path===app));
  assert.equal((await request('manage',{action:'add',input,hours:6,binding:{kind:'app',path:app}})).status,200);
  let s=await settle(),w=s.watches[0];const id=w.id;assert.equal(w.installedVersion,'1.0.0');assert.equal(w.update.version,'v2.0.0');assert.equal(w.canUpdate,false);assert.equal(w.monitorMode,'installation');assert.equal(s.notifications.length,1);
  assert.equal((await request('manage',{action:'update',id})).status,409);
  await stop();await putVersion('2.0.0');origin=await start();s=await get();assert.equal(s.watches[0].update,null);assert.equal(s.notifications.length,0);
  await request('manage',{action:'bind-installation',id,binding:{kind:'cli',path:cli}});s=await get();assert.equal(s.watches[0].installedVersion,'1.5.0');assert.equal(s.watches[0].update.before,'1.5.0');
  assert.equal((await request('manage',{action:'add',input:'https://github.com/example/news',hours:6,releaseOnly:true})).status,200);s=await settle();assert.equal(s.watches[1].monitorMode,'release');assert.equal(s.watches[1].installedVersion,null);assert.equal(s.watches[1].update,undefined);
  await stop();const saved=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));saved.watches[0].version='release-v2.0.0';saved.watches[0].update=null;saved.notifications=[];await writeFile(path.join(dir,'state.json'),JSON.stringify(saved));origin=await start();s=await get();assert.equal(s.watches[0].comparisonUnknown,true);assert.equal(s.watches[0].update,null);
  await stop();await rm(cli);origin=await start();s=await get();assert.equal(s.watches[0].status,'error');assert.equal(s.watches[0].installedVersion,null);assert.equal(s.watches[0].monitorMode,'installation');
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});

test('직접 입력한 npm 패키지는 정확한 설치 위치 하나를 자동 연결',{timeout:20000},async()=>{
 const {updateFixture}=await import('./update-fixture.mjs');const dir=await mkdtemp(path.join(os.tmpdir(),'doto-npm-bind-'));let child;
 try{
  const {bin}=await updateFixture(dir);await writeFile(path.join(dir,'state.json'),JSON.stringify({watches:[],notifications:[],onboarded:true}));await mkdir(path.join(dir,'apps'));
  const preload=path.join(dir,'fetch.mjs');await writeFile(preload,"globalThis.fetch=async()=>new Response(JSON.stringify({version:'2.0.0'}),{status:200});");
  child=spawn(process.execPath,['--import',preload,fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{HOME:dir,PATH:bin+':/usr/bin:/bin',MOMO_APPLICATIONS_DIR:path.join(dir,'apps'),MOMO_DATA_DIR:dir,MOMO_PORT:'0'},stdio:['ignore','pipe','pipe']});
  const origin=await new Promise((resolve,reject)=>{child.stdout.once('data',x=>resolve(String(x).trim().slice(5)));child.once('error',reject);child.once('exit',code=>reject(new Error(`exit ${code}`)));});
  const post=async(endpoint,data)=>{const response=await fetch(origin+'/api/'+endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal(response.status,200);return response.json();};
  const preview=await post('preview',{input:'test-success'});assert.equal(preview.binding.kind,'package');assert.equal(preview.installedVersion,'1.0.0');
  await post('manage',{action:'add',input:'test-success',hours:6});let state;for(let i=0;i<80;i++){state=await(await fetch(origin+'/api/state')).json();if(!state.checking)break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(state.watches[0].installedVersion,'1.0.0');assert.equal(state.watches[0].update.version,'2.0.0');assert.equal(state.watches[0].canUpdate,true);
 }finally{if(child?.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}await rm(dir,{recursive:true,force:true});}
});
