import { constants } from 'node:fs';
import { readFile, readdir, access, realpath } from 'node:fs/promises';
import path from 'node:path';

const validNpm = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;
const validBrew = /^[a-z0-9][a-z0-9+@._-]*$/;
export const nameOrder = (a,b) => a.name.localeCompare(b.name,'en',{sensitivity:'base',numeric:true}) || a.id.localeCompare(b.id);
export function brewItems(data) {
  const items=[];
  for(const f of data.formulae||[]) {
    if(f.tap!=='homebrew/core'||!validBrew.test(f.name))continue;
    const installed=f.installed?.find(i=>i.installed_on_request===true&&i.version===f.linked_keg)||f.installed?.filter(i=>i.installed_on_request===true).at(-1);
    if(!installed||!installed.version||installed.version.startsWith('HEAD'))continue;
    items.push({id:`homebrew:formula/${f.name}`,source:'homebrew',target:`formula/${f.name}`,name:f.name,manager:'Homebrew',installedVersion:installed.version});
  }
  for(const c of data.casks||[]) {
    if(c.tap!=='homebrew/cask'||!validBrew.test(c.token)||typeof c.installed!=='string'||!c.installed||c.version==='latest')continue;
    items.push({id:`homebrew:cask/${c.token}`,source:'homebrew',target:`cask/${c.token}`,name:c.name?.[0]||c.token,manager:'Homebrew',installedVersion:c.installed});
  }
  return items;
}
export async function npmItems(root) {
  if(!path.isAbsolute(root))throw new Error('Invalid npm root');
  const paths=[];
  for(const entry of await readdir(root,{withFileTypes:true})) {
    if(entry.name.startsWith('.'))continue;
    if(entry.name.startsWith('@')) {
      for(const sub of await readdir(path.join(root,entry.name)))paths.push(path.join(entry.name,sub));
    }else paths.push(entry.name);
  }
  const items=[];
  for(const relative of paths) {
    try {
      const pkg=JSON.parse(await readFile(path.join(root,relative,'package.json'),'utf8'));
      if(!validNpm.test(pkg.name)||typeof pkg.version!=='string'||!pkg.version)continue;
      items.push({id:`npm:${pkg.name}`,source:'npm',target:pkg.name,name:pkg.name,manager:'npm',installedVersion:pkg.version,noticePackage:pkg.name==='claude'&&!pkg.bin&&String(pkg.repository?.url||'').includes('bcherny/redirect-claude')});
    }catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code)&&!(error instanceof SyntaxError))throw error;}
  }
  return items;
}
async function npmGlobalItems(run) {
  const commands=[],seen=new Set();
  for(const directory of (process.env.PATH||'').split(path.delimiter)) {
    if(!directory||!path.isAbsolute(directory))continue;
    const npm=path.join(directory,'npm'),node=path.join(directory,'node');
    try{await access(node);const resolved=await realpath(npm);if(seen.has(resolved))continue;seen.add(resolved);}catch{continue;}
    // Pair each npm on PATH with its own Node rather than the app's bundled runtime.
    commands.push([node,[npm,'root','--global']]);
  }
  if(!commands.length)commands.push(['npm',['root','--global']]);
  const locations=await Promise.all(commands.map(async([command,args])=>({root:await realpath((await run(command,args,'',12000)).trim()),command,args:args.slice(0,-2)})));
  const groups=await Promise.all(locations.map(async location=>(await npmItems(location.root)).map(item=>({...item,npmRuntime:location}))));
  const items=new Map();
  for(const item of groups.flat()){
    const location={id:`npm:${item.npmRuntime.root}`,path:path.join(item.npmRuntime.root,item.target),version:item.installedVersion,npmRuntime:item.npmRuntime};
    if(!items.has(item.id))items.set(item.id,{...item,locations:[]});
    const locations=items.get(item.id).locations;if(!locations.some(old=>old.id===location.id))locations.push(location);
  }
  return [...items.values()];
}
export function createInventory(run) {
  let cached=null,checkedAt=0,inFlight=null;
  return async function scan(force=false) {
    if(!force&&cached&&Date.now()-checkedAt<60000)return cached;
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      const options={maxOutput:12_000_000,env:{HOMEBREW_NO_AUTO_UPDATE:'1',HOMEBREW_NO_ANALYTICS:'1'}};
      const results=await Promise.allSettled([
        run('brew',['info','--json=v2','--installed'],'',30000,false,options).then(text=>brewItems(JSON.parse(text))),
        npmGlobalItems(run)
      ]);
      const items=[],warnings=[],unavailable=[];
      results.forEach((r,i)=>{if(r.status==='fulfilled')items.push(...r.value);else if(r.reason?.code==='ENOENT')unavailable.push(i===0?'Homebrew':'npm');else warnings.push(i===0?'Homebrew 목록을 읽지 못했어요. 설치 여부를 확인한 뒤 다시 시도해 주세요.':'npm 전역 목록을 읽지 못했어요. 설치 여부를 확인한 뒤 다시 시도해 주세요.');});
      cached={items:[...new Map(items.map(i=>[i.id,i])).values()].sort(nameOrder),warnings,unavailable};checkedAt=Date.now();return cached;
    })().finally(()=>{inFlight=null;});
    return inFlight;
  };
}
export function compareBrewVersions(latest,installed) {
  if(latest===installed)return 0;
  if(!/^\d+(?:[._,]\d+)*$/.test(latest)||!/^\d+(?:[._,]\d+)*$/.test(installed))return null;
  const a=latest.split(/[._,]/).map(Number),b=installed.split(/[._,]/).map(Number);
  for(let i=0;i<Math.max(a.length,b.length);i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0)?1:-1;}
  return 0;
}

export async function commandLocations(command,run){
  const locations=[],seen=new Set();
  for(const directory of (process.env.PATH||'').split(path.delimiter)){
    if(!path.isAbsolute(directory))continue;
    const executable=path.join(directory,command);
    let resolved;try{await access(executable,constants.X_OK);resolved=await realpath(executable);}catch{continue;}
    if(seen.has(resolved))continue;seen.add(resolved);
    let version=null;
    try{version=(await run(executable,['--version'],'',8000,false,{env:{PATH:directory+path.delimiter+process.env.PATH}})).match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0]||null;}catch{}
    locations.push({id:`cli:${executable}`,path:executable,version});
  }
  return locations;
}

const desktopApps = [{repo:'stablyai/orca',name:'Orca',bundleId:'com.stablyai.orca',fileName:'Orca.app'}];
export function desktopAppFor(watch){
  return watch.source==='github'?desktopApps.find(app=>app.repo===watch.target.toLowerCase()):undefined;
}
export async function desktopAppLocations(watch,run,roots){
  const app=desktopAppFor(watch);if(!app)return [];
  const locations=[],seen=new Set();
  for(const root of roots){
    const application=path.join(root,app.fileName),plist=path.join(application,'Contents','Info.plist');
    let resolved;
    try{resolved=await realpath(application);await access(plist);}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))continue;throw error;}
    if(seen.has(resolved))continue;seen.add(resolved);
    const metadata=JSON.parse(await run('/usr/bin/plutil',['-convert','json','-o','-',plist],'',5000));
    if(metadata.CFBundleIdentifier!==app.bundleId)continue;
    const version=String(metadata.CFBundleShortVersionString||'').replace(/^v/,'');
    if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))throw new Error(`${app.name}의 설치 버전을 읽지 못했어요.`);
    locations.push({id:`app:${resolved}`,path:resolved,version});
  }
  return locations;
}
