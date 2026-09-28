import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {brewItems,npmItems,createInventory,compareBrewVersions,nameOrder} from '../inventory.mjs';

test('직접 설치한 공식 Homebrew 항목만 읽고 의존 패키지와 HEAD를 제외한다',()=>{
 const f=(name,tap,requested,version='1.0')=>({name,tap,installed:[{version,installed_on_request:requested}]});
 const items=brewItems({formulae:[f('zebra','homebrew/core',true),f('library','homebrew/core',false),f('private','custom/tap',true),f('development','homebrew/core',true,'HEAD-abc')],casks:[{token:'alpha',name:['Alpha'],tap:'homebrew/cask',installed:'2.0',version:'2.0'},{token:'unversioned',tap:'homebrew/cask',installed:'latest',version:'latest'}]});
 assert.deepEqual(items.sort(nameOrder).map(i=>i.id),['homebrew:cask/alpha','homebrew:formula/zebra']);
});
test('npm 전역 루트만 읽고 하위 의존성은 조회하지 않는다',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'momo-inventory-'));
 try{
  for(const [name,pkg] of [['alpha',{name:'alpha',version:'1.0.0'}],['@scope/beta',{name:'@scope/beta',version:'2.0.0'}],['alpha/node_modules/transitive',{name:'transitive',version:'3.0.0'}]]){await mkdir(path.join(root,name),{recursive:true});await writeFile(path.join(root,name,'package.json'),JSON.stringify(pkg));}
  assert.deepEqual((await npmItems(root)).map(i=>i.target).sort(),['@scope/beta','alpha']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('한 설치 관리자가 실패해도 다른 목록과 재시도 결과를 보존한다',async()=>{
 let fail=true,calls=0;
 const scan=createInventory(async(command,args)=>{calls++;if(command==='npm'||args.includes('root'))throw new Error('missing');if(fail)throw new Error('missing');return JSON.stringify({formulae:[{name:'git',tap:'homebrew/core',installed:[{version:'2.0',installed_on_request:true}]}]});});
 let result=await scan();assert.equal(result.items.length,0);assert.equal(result.warnings.length,2);
 fail=false;result=await scan(true);assert.equal(result.items.length,1);assert.equal(result.warnings.length,1);const before=calls;await scan();assert.equal(calls,before);
});
test('Homebrew 숫자 버전과 revision을 비교하고 알 수 없는 형식은 최신으로 단정하지 않는다',()=>{
 assert.equal(compareBrewVersions('1.2.3_2','1.2.3_1'),1);assert.equal(compareBrewVersions('2.0','3.0'),-1);assert.equal(compareBrewVersions('2026.9,12','2026.9,11'),1);assert.equal(compareBrewVersions('1.0rc1','1.0'),null);assert.equal(compareBrewVersions('1.0','1.0'),0);
});

test('안내용 claude 패키지를 구분하고 공식 패키지와 혼동하지 않는다',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'momo-notice-'));
 try{
  await mkdir(path.join(root,'claude'));await writeFile(path.join(root,'claude','package.json'),JSON.stringify({name:'claude',version:'0.1.1',repository:{url:'git+https://github.com/bcherny/redirect-claude.git'}}));
  assert.equal((await npmItems(root))[0].noticePackage,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
