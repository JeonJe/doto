import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {fileURLToPath} from 'node:url';
import {desktopAppLocations} from '../inventory.mjs';
const watch={source:'github',target:'stablyai/orca'};
test('Orca는 저장소와 번들 식별자를 확인하고 중복 경로와 잘못된 버전을 구분',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'doto-app-'));
 try{
  const app=path.join(dir,'Applications/Orca.app');await mkdir(path.join(app,'Contents'),{recursive:true});await writeFile(path.join(app,'Contents/Info.plist'),'fixture');
  let metadata={CFBundleIdentifier:'com.stablyai.orca',CFBundleShortVersionString:'1.4.215'};
  const run=async(command,args)=>{assert.equal(command,'/usr/bin/plutil');assert.equal(args.at(-1),path.join(app,'Contents/Info.plist'));return JSON.stringify(metadata);};
  let locations=await desktopAppLocations(watch,run,[path.dirname(app),path.dirname(app)]);assert.equal(locations.length,1);assert.equal(locations[0].version,'1.4.215');
  assert.deepEqual(await desktopAppLocations({...watch,target:'other/orca'},run,[path.dirname(app)]),[]);
  metadata.CFBundleIdentifier='other.app';assert.deepEqual(await desktopAppLocations(watch,run,[path.dirname(app)]),[]);
  metadata={CFBundleIdentifier:'com.stablyai.orca',CFBundleShortVersionString:'unknown'};await assert.rejects(desktopAppLocations(watch,run,[path.dirname(app)]),/설치 버전/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('등록된 Orca 구독을 설치 비교로 전환하고 외부 업데이트 뒤 알림을 해제',{skip:process.platform!=='darwin',timeout:20000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'doto-orca-'));let child;
 const appDir=path.join(dir,'Applications'),plist=path.join(appDir,'Orca.app/Contents/Info.plist');
 const putVersion=version=>writeFile(plist,`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.stablyai.orca</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`);
 const stop=async()=>{if(child?.exitCode===null){const end=once(child,'exit');child.kill();await end;}};
 const start=async()=>{child=spawn(process.execPath,['--import',path.join(dir,'fetch.mjs'),fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{HOME:dir,PATH:'/usr/bin:/bin',MOMO_APPLICATIONS_DIR:appDir,MOMO_DATA_DIR:dir,MOMO_PORT:'0'},stdio:['ignore','pipe','pipe']});return new Promise((resolve,reject)=>{child.stdout.once('data',s=>resolve(String(s).trim().slice(5)));child.once('error',reject);child.once('exit',code=>reject(new Error(`server exited ${code}`)));});};
 try{
  await mkdir(path.dirname(plist),{recursive:true});await putVersion('1.4.215');
  await writeFile(path.join(dir,'fetch.mjs'),"globalThis.fetch=async()=>new Response(JSON.stringify({tag_name:'v1.4.217',body:''}),{status:200});");
  const item={...watch,id:'orca',name:'stablyai/orca',version:'v1.4.217',installedVersion:null,hours:6,status:'ok',nextCheck:Date.now()+86400000};
  await writeFile(path.join(dir,'state.json'),JSON.stringify({watches:[item,{...item,id:'other',name:'Other',target:'example/other'}],notifications:[],onboarded:true}));
  let origin=await start();const get=async()=>await(await fetch(origin+'/api/state')).json();let s=await get(),w=s.watches[0];
  assert.equal(w.name,'Orca');assert.equal(w.installedVersion,'1.4.215');assert.equal(w.update.version,'v1.4.217');assert.equal(w.update.before,'1.4.215');assert.equal(w.canUpdate,false);assert.equal(w.localApp,'Orca');assert.equal(s.notifications.length,1);
  assert.equal(s.watches[1].installedVersion,null);assert.equal(s.watches[1].update,undefined);
  const response=await fetch(origin+'/api/manage',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'update',id:'orca'})});assert.equal(response.status,409);
  await stop();await putVersion('1.4.217');origin=await start();s=await get();assert.equal(s.watches[0].installedVersion,'1.4.217');assert.equal(s.watches[0].update,null);assert.equal(s.notifications.length,0);
  const post=data=>fetch(origin+'/api/manage',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
  await post({action:'remove',id:'orca'});await putVersion('1.4.215');
  const preview=await(await fetch(origin+'/api/preview',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({input:'https://github.com/stablyai/orca'})})).json();
  assert.equal(preview.name,'Orca');assert.equal(preview.installedVersion,'1.4.215');
  assert.equal((await post({action:'add',input:'https://github.com/stablyai/orca',hours:6})).status,200);
  for(let i=0;i<80;i++){s=await get();if(!s.checking)break;await new Promise(r=>setTimeout(r,30));}
  const added=s.watches.find(w=>w.target==='stablyai/orca');assert.equal(added.update.before,'1.4.215');assert.equal(added.update.version,'v1.4.217');
  await stop();await rm(path.join(appDir,'Orca.app'),{recursive:true});origin=await start();s=await get();const missing=s.watches.find(w=>w.target==='stablyai/orca');assert.equal(missing.status,'error');assert.match(missing.installationIssue,/찾지 못/);assert.equal(missing.installedVersion,null);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
