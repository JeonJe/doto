import {mkdir,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
export async function updateFixture(dir){
 const bin=path.join(dir,'bin'),root=path.join(dir,'packages');await mkdir(bin,{recursive:true});await mkdir(root,{recursive:true});
 await symlink(process.execPath,path.join(bin,'node'));
 for(const name of ['test-success','test-failure']){await mkdir(path.join(root,name));await writeFile(path.join(root,name,'package.json'),JSON.stringify({name,version:'1.0.0'}));}
 const script=`#!/usr/bin/env node
const fs=require('fs'),path=require('path');const dir=${JSON.stringify(dir)},root=${JSON.stringify(root)};const args=process.argv.slice(2),tool=path.basename(process.argv[1]);
const log=text=>fs.appendFileSync(path.join(dir,'commands.log'),text+'\\n');
if(tool==='npm'&&args[0]==='root'){console.log(root);process.exit(0);}
if(tool==='brew'&&args[0]==='info'){console.log(JSON.stringify({formulae:[{name:'test-brew',tap:'homebrew/core',linked_keg:fs.existsSync(path.join(dir,'brew-updated'))?'2.0.0':'1.0.0',installed:[{version:fs.existsSync(path.join(dir,'brew-updated'))?'2.0.0':'1.0.0',installed_on_request:true}]}],casks:[]}));process.exit(0);}
if((tool==='npm'&&args[0]==='install')||(tool==='brew'&&args[0]==='upgrade')){const target=args.at(-1);log('start '+tool+' '+target);setTimeout(()=>{log('end '+tool+' '+target);if(target.startsWith('test-failure'))process.exit(1);if(tool==='npm'){const name=target.slice(0,target.lastIndexOf('@'));fs.writeFileSync(path.join(root,name,'package.json'),JSON.stringify({name,version:'2.0.0'}));}else fs.writeFileSync(path.join(dir,'brew-updated'),'yes');},350);}
else process.exit(1);
`;
 for(const name of ['npm','brew'])await writeFile(path.join(bin,name),script,{mode:0o755});
 const watch=(id,source,target,manager)=>({id,name:id,source,target,hours:6,version:'2.0.0',installedVersion:'1.0.0',update:{before:'1.0.0',version:'2.0.0'},installation:{id:`${source}:${target}`,manager},status:'ok',lastCheck:Date.now(),nextCheck:Date.now()+86400000,demo:false});
 const watches=[watch('npm-success','npm','test-success','npm'),watch('npm-failure','npm','test-failure','npm'),watch('brew-success','homebrew','formula/test-brew','Homebrew'),{id:'news',name:'소식만 받기',source:'github',target:'example/news',hours:6,version:'2.0.0',update:{before:'1.0.0',version:'2.0.0'},status:'ok',nextCheck:Date.now()+86400000}];
 await writeFile(path.join(dir,'state.json'),JSON.stringify({watches,notifications:[],onboarded:true}));
 return {bin,root};
}
