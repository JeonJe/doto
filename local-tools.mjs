import {access,realpath,stat,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';

export function repositoryKey(value){
  if(typeof value!=='string')return null;
  const match=value.match(/^(?:git\+)?https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return match?`${match[1]}/${match[2]}`.toLowerCase():null;
}
export async function appChoices(roots=process.env.MOMO_APPLICATIONS_DIR?[process.env.MOMO_APPLICATIONS_DIR]:[path.join(homedir(),'Applications'),'/Applications']){
  const items=[];
  for(const root of roots){
    if(!path.isAbsolute(root))continue;
    let files;try{files=await readdir(root,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
    for(const file of files){if(file.name.endsWith('.app')&&(file.isDirectory()||file.isSymbolicLink()))items.push({name:file.name.slice(0,-4),caption:path.join(root,file.name),binding:{kind:'app',path:path.join(root,file.name)}});}
  }
  return items;
}
export async function readLocalTool(binding,run){
  if(!binding||!['app','cli'].includes(binding.kind)||typeof binding.path!=='string'||!path.isAbsolute(binding.path)||binding.path.includes('\0'))throw new Error('설치 앱이나 실행 파일의 경로를 선택해 주세요.');
  if(binding.kind==='app'&&!binding.path.endsWith('.app'))throw new Error('.app 파일을 선택해 주세요.');
  const resolved=await realpath(binding.path),info=await stat(resolved);
  if(binding.kind==='app'){
    if(!info.isDirectory())throw new Error('.app 파일을 선택해 주세요.');
    const metadata=JSON.parse(await run('/usr/bin/plutil',['-convert','json','-o','-',path.join(resolved,'Contents/Info.plist')],'',5000));
    if(typeof metadata.CFBundleIdentifier!=='string'||!metadata.CFBundleIdentifier||typeof metadata.CFBundleShortVersionString!=='string'||!metadata.CFBundleShortVersionString)throw new Error('앱의 설치 버전을 읽지 못했어요.');
    if(binding.bundleId&&binding.bundleId!==metadata.CFBundleIdentifier)throw new Error('연결한 앱과 다른 앱이에요. 설치 위치를 다시 선택해 주세요.');
    return {id:`app:${resolved}`,path:resolved,version:metadata.CFBundleShortVersionString.replace(/^v/,''),binding:{kind:'app',path:resolved,bundleId:metadata.CFBundleIdentifier,name:metadata.CFBundleDisplayName||metadata.CFBundleName||path.basename(resolved,'.app')}};
  }
  if(!info.isFile())throw new Error('CLI 실행 파일을 선택해 주세요.');
  await access(resolved,constants.X_OK);
  const output=await run(binding.path,['--version'],'',5000,false,{maxOutput:64000,env:{PATH:path.dirname(binding.path)+path.delimiter+process.env.PATH}});
  const version=output.match(/\bv?(\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/)?.[1];
  if(!version)throw new Error('--version으로 설치 버전을 확인하지 못했어요.');
  return {id:`cli:${binding.path}`,path:binding.path,version,binding:{kind:'cli',path:binding.path,name:path.basename(binding.path)}};
}
export function compareReleaseVersions(latest,installed){
  const parse=value=>typeof value==='string'?value.match(/^v?(\d+(?:\.\d+){1,3})(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/):null;
  const a=parse(latest),b=parse(installed);if(!a||!b)return null;
  // Unordered prerelease labels are not treated as a stable version comparison.
  if(a[2])return latest===installed?0:null;
  const aa=a[1].split('.').map(Number),bb=b[1].split('.').map(Number);
  for(let i=0;i<Math.max(aa.length,bb.length);i++){if((aa[i]||0)!==(bb[i]||0))return (aa[i]||0)>(bb[i]||0)?1:-1;}
  return b[2]?1:0;
}
