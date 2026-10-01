import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {appChoices,readLocalTool,compareReleaseVersions} from './local-tools.mjs';
import { createInventory, nameOrder, compareBrewVersions, commandLocations } from './inventory.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
let port = Number(process.env.MOMO_PORT || 4317);
let origin = `http://127.0.0.1:${port}`;
const dataDir = process.env.MOMO_DATA_DIR || path.join(root, '.local');
await mkdir(dataDir, { recursive: true });
const stateFile = path.join(dataDir, 'state.json');
const activeChildren = new Set();
const now = () => Date.now();
let state = { watches: [], notifications: [] };
try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (state.updateBatch?.running) { state.updateBatch.running=false; for(const item of state.updateBatch.items) if(['queued','running'].includes(item.status)){item.status='failed';item.error='업데이트가 중단됐어요. 다시 확인해 주세요.';} }
state.onboarded ??= state.watches.some(w => !w.demo);
for (const watch of state.watches) { if (watch.status === 'updating') { watch.status = 'error'; watch.error = '업데이트가 중단됐어요. 버전을 다시 확인해 주세요.'; watch.nextCheck = now(); } }
let saveQueue = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(state, null, 2);
  saveQueue = saveQueue.catch(() => {}).then(async () => { await writeFile(stateFile + '.tmp', snapshot, { mode: 0o600 }); await rename(stateFile + '.tmp', stateFile); });
  return saveQueue;
}
function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function run(command, args, input = '', timeout = 90000, includeStderr = false, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: dataDir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', ...options.env } });
    activeChildren.add(child);
    child.once('close', () => activeChildren.delete(child));
    let stdout = '', stderr = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(failure('도구의 응답이 늦어요. 잠시 후 다시 시도해 주세요.', 504)); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > (options.maxOutput || 1000000)) { child.kill(); finish(failure('도구의 응답이 너무 커서 중단했어요.', 502)); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
    child.on('error', error => finish(Object.assign(failure(error.code === 'ENOENT' ? `${command} CLI가 설치되어 있지 않아요.` : '도구를 실행하지 못했어요.', 503), {code:error.code})));
    child.on('close', code => finish(code === 0 ? null : failure(`${options.label || path.basename(command)} 명령을 실행하지 못했어요. 설치 권한과 설치 방법을 확인해 주세요.`, 502), includeStderr ? stdout + '\n' + stderr : stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const scanInstalled = createInventory(run);
let updatingId = null;
const PRESETS = [
  { id: 'claude', name: 'Claude Code', icon: '✳', source: 'npm', target: '@anthropic-ai/claude-code', command: 'claude', updateArgs: ['update'], guide: 'https://code.claude.com/docs/en/setup' },
  { id: 'codex', name: 'Codex', icon: '›_', source: 'npm', target: '@openai/codex', command: 'codex', updateArgs: ['update'], guide: 'https://developers.openai.com/codex/quickstart/' },
  { id:'gemini', name:'Gemini CLI', icon:'✧', source:'npm', target:'@google/gemini-cli', command:'gemini', guide:'https://geminicli.com/docs/get-started/installation/' },
  { id:'grok', name:'Grok Build', icon:'𝕏', source:'npm', target:'@xai-official/grok', command:'grok', guide:'https://docs.x.ai/build/overview' },
  { featured:false, id: 'opencode', name: 'OpenCode', icon: '⌘', source: 'npm', target: 'opencode-ai', command: 'opencode', updateArgs: ['upgrade'], guide: 'https://opencode.ai/docs/' },
  { featured:false, id: 'bun', name: 'Bun', icon: 'B', source: 'github', target: 'oven-sh/bun', command: 'bun', updateArgs: ['upgrade'], guide: 'https://bun.sh/docs/installation' }
];
const ALLOWED_HOURS = [1, 3, 6, 12, 24, 168];
let presetCache = null, presetsCheckedAt = 0, presetsInFlight = null;
function presetFor(watch) { return PRESETS.find(p => p.source === watch.source && p.target === watch.target); }
async function presetStatuses(force = false) {
  if (!force && presetCache && now() - presetsCheckedAt < 60000) return presetCache;
  if (presetsInFlight) return presetsInFlight;
  presetsInFlight = Promise.all(PRESETS.filter(p=>p.featured!==false).map(async p => {const probe={...p,isPresetProbe:true};const version=await installedVersion(probe);return {id:p.id,name:p.name,icon:p.icon,source:p.source,target:p.target,guide:p.guide,installedVersion:version,installationCount:probe.installLocations?.length||0};}))
    .then(items => { presetCache = items; presetsCheckedAt = now(); return items; }).finally(() => { presetsInFlight = null; });
  return presetsInFlight;
}
async function publicState() {
  const { schedule: legacySchedule, provider: legacyProvider, ...rest } = state;
  return { ...rest, watches: state.watches.filter(w => !w.demo).map(w => ({ ...w, localApp:w.localBinding?.name||null, monitorMode:w.releaseOnly?'release':(w.localBinding||w.installation||w.installedVersion)?'installation':'release', canUpdate: canUpdate(w), guide: presetFor(w)?.guide || null })), notifications: state.notifications.filter(n => !n.demo), checking, updatingId, presets: await presetStatuses() };
}
async function installedCatalog(force=false) {
  const catalog=await scanInstalled(force);
  return { ...catalog, items:catalog.items.filter(item=>!item.noticePackage).map(item=>({...item,name:presetFor(item)?.name||item.name,icon:presetFor(item)?.icon||'⌘'})).sort(nameOrder) };
}
async function previewInstalled(id) {
  const catalog=await installedCatalog();
  const item=catalog.items.find(item=>item.id===id);
  if(!item)throw failure('설치된 도구를 찾지 못했어요. 목록을 새로고침해 주세요.',404);
  if(state.watches.some(w=>!w.demo&&w.source===item.source&&w.target===item.target))throw failure('이미 모니터링 중인 항목이에요.',409);
  const release=await releaseInfo(item);
  return {...item,version:release.version,installedId:item.id,installation:{id:item.id,manager:item.manager}};
}
function batchIds(ids) {
  if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw failure('중복 없이 1개 이상 선택해 주세요. 한 번에 최대 100개까지 추가할 수 있어요.');
  return ids;
}
async function previewInstalledBatch(ids) {
  batchIds(ids);
  const items=[];
  for(let i=0;i<ids.length;i+=4)items.push(...await Promise.all(ids.slice(i,i+4).map(async id=>{
    try{return await previewInstalled(id);}catch(error){const catalog=await installedCatalog();const name=catalog.items.find(item=>item.id===id)?.name;throw failure(`${name?name+': ':''}${error.message}`,error.status||502);}
  })));
  return items;
}
async function previewPresets(ids) {
  batchIds(ids);
  const selected=ids.map(id=>PRESETS.find(p=>p.id===id&&p.featured!==false));
  if(selected.some(p=>!p))throw failure('미리 준비한 도구 중에서 선택해 주세요.');
  assertBatchAvailable(selected);
  const installed=await presetStatuses();
  return Promise.all(selected.map(async p=>{
    const release=await releaseInfo(p);
    return {presetId:p.id,source:p.source,target:p.target,name:p.name,icon:p.icon,guide:p.guide,version:release.version,installedVersion:installed.find(item=>item.id===p.id)?.installedVersion||null,manager:'npm 정식 버전'};
  }));
}
function assertBatchAvailable(items) {
  if(state.watches.filter(w=>!w.demo).length+items.length>100)throw failure('최대 100개까지 모니터링할 수 있어요.',409);
  if(items.some(item=>state.watches.some(w=>!w.demo&&w.source===item.source&&w.target===item.target)))throw failure('이미 모니터링 중인 항목이 있어요. 선택 목록을 다시 확인해 주세요.',409);
}
function watchById(id) { const watch = state.watches.find(w => w.id === id && !w.demo); if (!watch) throw failure('모니터링 항목을 찾지 못했어요.', 404); return watch; }
function hoursValue(value) { if (!ALLOWED_HOURS.includes(value)) throw failure('확인 주기를 선택해 주세요.'); return value; }
function addWatch(action) {
  if (state.watches.some(w => !w.demo && w.source === action.source && w.target === action.target)) throw failure('이미 모니터링 중인 항목이에요.', 409);
  if (state.watches.filter(w => !w.demo).length >= 100) throw failure('최대 100개까지 모니터링할 수 있어요.', 409);
  const preset = presetFor(action);
  const watch = { id: randomUUID(), name: action.name.trim(), source: action.source, target: action.target, hours: action.hours, icon: preset?.icon || '⌘', ...(action.installation?{installation:action.installation}:{}), ...(action.localBinding?{localBinding:action.localBinding}:{}), ...(action.selectedLocationId?{selectedLocationId:action.selectedLocationId}:{}), releaseOnly:!!action.releaseOnly, demo: false, version: null, installedVersion: null, lastCheck: null, nextCheck: now(), status: 'waiting', error: null };
  state.watches.push(watch); state.onboarded = true; return watch;
}
function canUpdate(watch) {
  if (watch.localBinding || watch.releaseOnly || watch.installationIssue || !watch.installedVersion || watch.demo || watch.comparisonUnknown || (watch.source==='npm' && watch.target==='claude')) return false;
  if (!watch.installation) return !!presetFor(watch)?.updateArgs;
  return (watch.source==='npm' && watch.installation.manager==='npm' && watch.installation.id===`npm:${watch.target}`) ||
    (watch.source==='homebrew' && watch.installation.manager==='Homebrew' && watch.installation.id===`homebrew:${watch.target}`);
}
async function applyUpdate(watch) {
  const before=await installedVersion(watch,true);
  const location=await selectedInstallation(watch,true);
  if(!location || !before)throw failure('업데이트할 설치 위치를 확인해 주세요.',409);
  const expected=watch.update.version;
  const env={PATH:path.dirname(location.npmRuntime?.command||location.path)+path.delimiter+process.env.PATH};
  if(watch.installation){
    if(watch.source==='npm'){
      if(!location.npmRuntime||!/^\d+\.\d+\.\d+$/.test(expected))throw failure('설치 정보를 확인하지 못했어요.',409);
      const runtime=location.npmRuntime;
      await run(runtime.command,[...runtime.args,'install','--global','--prefix',path.dirname(path.dirname(runtime.root)),`${watch.target}@${expected}`],'',180000,false,{label:watch.name,env});
    }else{
      const match=watch.target.match(/^(formula|cask)\/([a-z0-9][a-z0-9+@._-]*)$/);
      if(!match)throw failure('업데이트할 도구를 확인하지 못했어요.',409);
      await run('brew',['upgrade',match[1]==='formula'?'--formula':'--cask',match[2]],'',180000,false,{label:watch.name,env:{HOMEBREW_NO_AUTO_UPDATE:'1',HOMEBREW_NO_ANALYTICS:'1'}});
    }
  }else{
    const preset=presetFor(watch);
    await run(location.path,[...preset.updateArgs,'--help'],'',15000,false,{env});
    await run(location.path,preset.updateArgs,'',180000,false,{env});
  }
  const after=await selectedInstallation(watch,true);
  const installed=after?.version;
  const comparison=installed&&watch.source==='homebrew'?compareBrewVersions(expected,installed):null;
  if(after?.id!==location.id||!installed||(watch.source==='homebrew'?comparison===null||comparison>0:!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(installed)||newerStableRelease(expected,installed)))throw failure('선택한 설치 위치의 업데이트를 확인하지 못했어요. 다시 확인해 주세요.',502);
  watch.updateVerification={path:location.path,before,after:installed,targetVersion:expected,at:now()};
  watch.installedVersion=installed;watch.update=null;watch.status='ok';watch.error=null;watch.lastCheck=now();
  state.notifications=state.notifications.filter(n=>n.watchId!==watch.id);
}
async function updateWatches(ids) {
  if(updatingId || checking)throw failure('진행 중인 작업이 끝난 뒤 업데이트해 주세요.',409);
  if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw failure('업데이트할 항목을 선택해 주세요.');
  const watches=ids.map(watchById);
  if(watches.some(w=>!canUpdate(w)||!w.update))throw failure('업데이트할 수 없는 항목이 있어요. 목록을 다시 확인해 주세요.',409);
  updatingId=watches[0].id;
  state.updateBatch={running:true,items:watches.map(w=>({id:w.id,name:w.name,status:'queued',error:null}))};
  try{await save();}catch(error){updatingId=null;state.updateBatch.running=false;throw error;}
  (async()=>{
    try{
      for(const [index,watch] of watches.entries()){
        const item=state.updateBatch.items[index];updatingId=watch.id;item.status='running';watch.status='updating';watch.error=null;await save();
        try{await applyUpdate(watch);item.status='succeeded';}
        catch(error){item.status='failed';item.error=error.status?error.message:'업데이트하지 못했어요. 다시 시도해 주세요.';watch.status='error';watch.error=item.error;}
        watch.nextCheck=now()+watch.hours*3600000;await save();
      }
    }finally{updatingId=null;state.updateBatch.running=false;presetCache=null;await save();}
  })().catch(console.error);
}
function parseTarget(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 300) throw failure('GitHub 저장소 링크나 npm 패키지 이름을 입력해 주세요.');
  const value = input.trim();
  if (value.startsWith('https://')) {
    let url;
    try { url = new URL(value); } catch { throw failure('링크 형식을 확인해 주세요.'); }
    if (url.username || url.password || url.port || url.search || url.hash) throw failure('GitHub 저장소의 기본 주소만 입력해 주세요.');
    const match = url.hostname === 'github.com' && url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/releases(?:\/latest)?)?\/?$/);
    if (!match) throw failure('GitHub 저장소 링크를 입력해 주세요. 예: https://github.com/oven-sh/bun');
    const target = `${match[1]}/${match[2].replace(/\.git$/, '')}`.toLowerCase();
    if (target.split('/').some(part => !part || part === '.' || part === '..')) throw failure('저장소 이름을 확인해 주세요.');
    return { source: 'github', target };
  }
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(value) || value.length > 214) throw failure('npm 패키지 이름이나 https://github.com/으로 시작하는 저장소 링크를 입력해 주세요.');
  return { source: 'npm', target: value };
}
function notesSource(watch) {
  const version=watch.update?.version||watch.version;
  if(typeof version!=='string'||!version)return null;
  if(watch.source==='npm'&&watch.target==='@openai/codex'&&/^\d+\.\d+\.\d+$/.test(version))return {repo:'openai/codex',tag:`rust-v${version}`,version};
  if(watch.source==='github'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(watch.target))return {repo:watch.target,tag:version,version};
  return null;
}
const notesCache=new Map();
async function releaseNotesFor(watch) {
  const source=notesSource(watch);
  if(!source)return {version:watch.update?.version||watch.version,status:'unsupported',body:null};
  const {repo,tag,version}=source,key=`${repo}:${tag}`,url=`https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
  const cached=notesCache.get(key);if(cached&&now()-cached.at<3600000)return cached.value;
  try{
    const response=await fetch(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Doto','Accept':'application/vnd.github+json'}});
    if(!response.ok)return {version,url,status:'unavailable',body:null};
    const data=await response.json();
    if(data.tag_name!==tag || data.draft)return {version,url,status:'unavailable',body:null};
    const body=typeof data.body==='string'?data.body.slice(0,8000):'';
    const compareUrl=(body.match(/https:\/\/github\.com\/[^\s)<>\]]+/g)||[]).find(value=>value.startsWith(`https://github.com/${repo}/compare/`))||null;
    const value={version,url,compareUrl,status:!body.trim()||body.includes('Release highlights could not be determined')?'no-summary':'available',body};
    if(notesCache.size>=100)notesCache.delete(notesCache.keys().next().value);
    notesCache.set(key,{at:now(),value});return value;
  }catch{return {version,url,status:'unavailable',body:null};}
}
async function releaseInfo(watch) {
  const url = watch.source === 'homebrew' ? `https://formulae.brew.sh/api/${watch.target}.json` : watch.source === 'npm' ? `https://registry.npmjs.org/${encodeURIComponent(watch.target)}/latest` : `https://api.github.com/repos/${watch.target}/releases/latest`;
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Momo-Local-Prototype', 'Accept': 'application/json' } }); }
  catch (error) { throw failure(error.name === 'TimeoutError' ? '응답이 늦어요. 잠시 후 다시 확인해 주세요.' : '네트워크 연결을 확인하고 다시 시도해 주세요.', 502); }
  if (!response.ok) throw failure(response.status === 404 ? '최신 버전을 찾지 못했어요. 패키지 이름이나 저장소의 정식 릴리스가 있는지 확인해 주세요.' : '버전 정보를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.', 502);
  const data = await response.json();
  const version = watch.source === 'homebrew' ? (watch.target.startsWith('formula/') ? (data.versions?.stable ? `${data.versions.stable}${data.revision?'_'+data.revision:''}` : null) : data.version) : watch.source === 'npm' ? data.version : data.tag_name;
  if (typeof version !== 'string' || version === 'latest' || version.length > 100) throw failure('버전 정보를 읽지 못했어요.', 502);
  return { version, releaseNotes: typeof data.body === 'string' ? data.body.slice(0, 5000) : null };
}
async function connectionChoices(target){
  const catalog=await installedCatalog();
  const packages=catalog.items.flatMap(item=>(item.locations||[{id:item.id,path:`${item.manager} / ${item.target}`,version:item.installedVersion}]).map(location=>({name:item.name,caption:location.path,version:location.version,recommended:target.source==='npm'?item.source==='npm'&&item.target===target.target:item.repository===target.target.toLowerCase(),binding:{kind:'package',id:item.id,locationId:location.id}})));
  const apps=await appChoices();
  const slug=target.target.split('/').at(-1).replace(/[^a-z0-9]/gi,'').toLowerCase();
  return [...packages,...apps.map(app=>({...app,recommended:app.name.replace(/[^a-z0-9]/gi,'').toLowerCase()===slug}))].sort((a,b)=>Number(b.recommended)-Number(a.recommended)||a.name.localeCompare(b.name,'ko'));
}
async function resolveConnection(binding){
  if(binding?.kind==='package'){
    const item=(await installedCatalog()).items.find(item=>item.id===binding.id);
    if(!item)throw failure('설치된 패키지를 찾지 못했어요. 다시 선택해 주세요.',404);
    const locations=item.locations||[{id:item.id,path:`${item.manager} / ${item.target}`,version:item.installedVersion}];
    const location=locations.find(location=>location.id===binding.locationId);
    if(!location)throw failure('설치 위치를 다시 선택해 주세요.',409);
    return {name:item.name,installedVersion:location.version,installation:{id:item.id,manager:item.manager},selectedLocationId:location.id,binding:{kind:'package',id:item.id,locationId:location.id}};
  }
  try{const local=await readLocalTool(binding,run);return {name:local.binding.name,installedVersion:local.version,localBinding:local.binding,selectedLocationId:local.id,binding:local.binding};}
  catch(error){throw failure(error.code==='ENOENT'?'설치 경로를 찾지 못했어요.':error.code==='EACCES'?'설치 경로를 읽을 수 없어요.':error.message,400);}
}
async function previewTarget(input) {
  const target = parseTarget(input);
  if (state.watches.some(w => !w.demo && w.source === target.source && w.target.toLowerCase() === target.target.toLowerCase())) throw failure('이미 모니터링 중인 항목이에요.', 409);
  const release = await releaseInfo(target), preset = presetFor(target);
  const candidates=await connectionChoices(target);
  const matches=candidates.filter(item=>item.recommended&&item.binding.kind==='package');
  const automatic=target.source==='npm'&&matches.length===1?await resolveConnection(matches[0].binding):null;
  return { ...target, ...(automatic||{}), name:automatic?.name||preset?.name||target.target, icon:preset?.icon||'⌘', version:release.version, candidates, input:target.source==='github'?`https://github.com/${target.target}`:target.target };
}
let checking = false;
async function installationOptions(watch,force=false){
  if(watch.releaseOnly)return [];
  if(watch.localBinding){
    try{return [await readLocalTool(watch.localBinding,run)];}
    catch(error){watch.installedVersion=null;watch.installationIssue='연결한 설치 도구를 읽지 못했어요. 다시 연결해 주세요.';throw failure(watch.installationIssue,409);}
  }
  if(watch.installation){
    const catalog=await scanInstalled(force);
    if(catalog.warnings.some(w=>w.startsWith(watch.installation.manager)))throw failure('설치 위치를 확인하지 못했어요. 다시 확인해 주세요.',502);
    const item=catalog.items.find(i=>i.id===watch.installation.id);
    if(!item)return [];
    return item.locations||[{id:item.id,path:`Homebrew / ${item.target}`,version:item.installedVersion}];
  }
  const command=presetFor(watch)?.command;
  return command?commandLocations(command,run):[];
}
async function selectedInstallation(watch,force=false){
  const locations=await installationOptions(watch,force);
  watch.installLocations=locations.map(({id,path,version})=>({id,path,version}));
  if(!watch.id||watch.isPresetProbe)return locations.length===1?locations[0]:null;
  if(!watch.selectedLocationId&&locations.length===1)watch.selectedLocationId=locations[0].id;
  const selected=locations.find(item=>item.id===watch.selectedLocationId);
  watch.installationIssue=watch.selectedLocationId&&!selected?'선택한 설치 위치를 찾지 못했어요.':!watch.selectedLocationId&&locations.length>1?'설치 위치가 여러 개예요. 사용할 위치를 선택해 주세요.':null;
  if(watch.installationIssue){watch.installedVersion=null;throw failure(watch.installationIssue,409);}
  return selected||null;
}
async function installedVersion(watch,force=false){return (await selectedInstallation(watch,force))?.version||null;}
async function inspectSavedInstallations(){
  await Promise.all(state.watches.filter(w=>!w.demo&&(w.installation||w.localBinding||w.selectedLocationId?.startsWith('app:')||presetFor(w))).map(async watch=>{
    try{
      if(!watch.localBinding&&!watch.installation&&watch.selectedLocationId?.startsWith('app:')){
        const local=await readLocalTool({kind:'app',path:watch.selectedLocationId.slice(4)},run);watch.localBinding=local.binding;watch.name=local.binding.name;
      }
      watch.installedVersion=await installedVersion(watch);
      if(watch.version)compareWatchVersion(watch,watch.version,watch.installedVersion);
    }catch(error){watch.installedVersion=null;watch.status='error';watch.error=error.message;}
  }));
  await save();
}
function newerStableRelease(latest, installed) {
  const remote = latest.match(/(?:^|v)(\d+)\.(\d+)\.(\d+)$/);
  const local = installed.match(/^(\d+)\.(\d+)\.(\d+)(-.*)?$/);
  if (!remote || !local) return false;
  for (let i = 1; i <= 3; i++) {
    if (+remote[i] !== +local[i]) return +remote[i] > +local[i];
  }
  return !!local[4];
}
function compareWatchVersion(watch,version,local){
  const before = local || watch.version;
  const comparison = local ? (watch.source==='homebrew'?compareBrewVersions(version,local):compareReleaseVersions(version,local)) : null;
  watch.comparisonUnknown = !!local && comparison===null;
  const changed = local ? comparison===1 : !!watch.version && watch.version !== version;
  if (changed && watch.acknowledgedVersion !== version && watch.update?.version !== version) {
    watch.update = { before: watch.update?.before || before, version, at: now() };
    state.notifications.push({ id: randomUUID(), watchId: watch.id, name: watch.name, version, before, at: now(), demo: false });
    state.notifications = state.notifications.slice(-30);
  }
  if (local && !changed && !watch.comparisonUnknown && watch.update) {
    watch.update = null;
    state.notifications = state.notifications.filter(n => n.watchId !== watch.id);
  }
  if(local&&watch.update)watch.update.before=local;
}
async function checkWatches(force = false, onlyId = null) {
  if (checking || updatingId) return;
  checking = true;
  try {
    for (const watch of [...state.watches]) {
      if ((onlyId && watch.id !== onlyId) || watch.demo || (!force && watch.nextCheck > now())) continue;
      try {
        const data = await releaseInfo(watch);
        const version = data.version;
        const local = await installedVersion(watch);
        if (!state.watches.includes(watch)) continue;
        watch.installedVersion = local;
        compareWatchVersion(watch,version,local);
        watch.releaseNotes = data.releaseNotes;
        watch.version = version; watch.status = 'ok'; watch.error = null; watch.lastCheck = now();
      } catch (error) { watch.status = 'error'; watch.error = error.name === 'TimeoutError' ? '응답이 늦어요. 다음 확인 시간에 다시 시도할게요.' : error.message === 'fetch failed' ? '네트워크 연결을 확인해 주세요.' : error.message; }
      watch.nextCheck = now() + watch.hours * 3600000;
    }
    await save();
  } finally { checking = false; }
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 40000) throw failure('입력한 내용이 너무 길어요.', 413); }
  try { return JSON.parse(raw); } catch { throw failure('요청을 읽지 못했어요. 다시 시도해 주세요.'); }
}
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
const installationReadiness=inspectSavedInstallations();
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) throw failure('도토 앱에서 다시 시도해 주세요.', 403);
    if (req.method === 'POST' && (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json')) throw failure('이 요청은 처리할 수 없어요. 도토 앱에서 다시 시도해 주세요.', 403);
    if(req.url.startsWith('/api/'))await installationReadiness;
    if (req.method === 'GET' && req.url.startsWith('/api/release-notes?')) return send(res,200,await releaseNotesFor(watchById(new URL(req.url,origin).searchParams.get('id'))));
    if (req.method === 'GET' && req.url === '/api/state') return send(res, 200, await publicState());
    if (req.method === 'GET' && ['/api/installed','/api/installed?refresh=1'].includes(req.url)) return send(res,200,await installedCatalog(req.url.endsWith('refresh=1')));
    if (req.method === 'POST' && req.url === '/api/installed/preview-batch') {const data=await body(req);return send(res,200,{items:await previewInstalledBatch(data.ids)});}
    if (req.method === 'POST' && req.url === '/api/installed/preview') {const data=await body(req);return send(res,200,await previewInstalled(data.id));}
    if (req.method === 'POST' && req.url === '/api/presets/preview-batch') {const data=await body(req);return send(res,200,{items:await previewPresets(data.ids)});}
    if(req.method==='POST'&&req.url==='/api/connections'){const data=await body(req);return send(res,200,{items:await connectionChoices(data.id?watchById(data.id):parseTarget(data.input))});}
    if(req.method==='POST'&&req.url==='/api/connection-preview'){const data=await body(req);return send(res,200,await resolveConnection(data.binding));}
    if (req.method === 'POST' && req.url === '/api/preview') { const data = await body(req); return send(res, 200, await previewTarget(data.input)); }
    if (req.method === 'POST' && req.url === '/api/onboarding') {
      const data = await body(req);
      if (!Array.isArray(data.presetIds) || !data.presetIds.length || data.presetIds.length > PRESETS.length) throw failure('모니터링할 도구를 선택해 주세요.');
      const selected = [...new Set(data.presetIds)].map(id => PRESETS.find(p => p.id === id));
      if (selected.some(p => !p)) throw failure('추가할 수 없는 도구예요.');
      for (const preset of selected) if (!state.watches.some(w => !w.demo && w.source === preset.source && w.target === preset.target)) addWatch({ ...preset, hours: 6 });
      state.onboarded = true; await save(); checkWatches().catch(console.error); return send(res, 200, await publicState());
    }
    if (req.method === 'POST' && req.url === '/api/manage') {
      const data = await body(req);
      if(data.action==='bind-installation'){
        if(checking||updatingId||state.updateBatch?.running)throw failure('진행 중인 작업이 끝난 뒤 연결해 주세요.',409);
        const watch=watchById(data.id),connection=await resolveConnection(data.binding);
        if(checking||updatingId||state.updateBatch?.running||!state.watches.includes(watch))throw failure('목록이 바뀌었어요. 다시 시도해 주세요.',409);
        delete watch.installation;delete watch.localBinding;delete watch.acknowledgedVersion;
        Object.assign(watch,{name:connection.name,installation:connection.installation,localBinding:connection.localBinding,selectedLocationId:connection.selectedLocationId,installedVersion:connection.installedVersion,releaseOnly:false,update:null,installationIssue:null,status:'ok',error:null});
        state.notifications=state.notifications.filter(n=>n.watchId!==watch.id);if(watch.version)compareWatchVersion(watch,watch.version,watch.installedVersion);
      }else if(data.action==='select-location'){
        if(checking||updatingId)throw failure('진행 중인 작업이 끝난 뒤 선택해 주세요.',409);
        const watch=watchById(data.id),locations=await installationOptions(watch,true);
        if(checking||updatingId)throw failure('진행 중인 작업이 끝난 뒤 선택해 주세요.',409);
        if(!locations.some(item=>item.id===data.locationId))throw failure('설치 목록에서 위치를 선택해 주세요.');
        watch.selectedLocationId=data.locationId;delete watch.updateVerification;watch.installationIssue=null;watch.status='waiting';watch.error=null;
        await save();checkWatches(true,watch.id).catch(console.error);
      }else if(data.action==='add-presets'){
        if(!Array.isArray(data.items))throw failure('추가할 도구를 선택해 주세요.');
        const ids=batchIds(data.items.map(item=>item?.presetId));
        const hours=data.items.map(item=>hoursValue(item.hours));
        const items=await previewPresets(ids);
        assertBatchAvailable(items);
        for(let i=0;i<items.length;i++)addWatch({...items[i],hours:hours[i]});
      } else if(data.action==='add-many'){
        if(!Array.isArray(data.items))throw failure('추가할 도구를 선택해 주세요.');
        const ids=batchIds(data.items.map(item=>item?.installedId));
        const hours=data.items.map(item=>hoursValue(item.hours));
        const items=await previewInstalledBatch(ids);
        assertBatchAvailable(items);
        for(let i=0;i<items.length;i++)addWatch({...items[i],hours:hours[i]});
      } else if (data.action === 'add') {
        const hours = hoursValue(data.hours);
        if(data.installedId!==undefined) addWatch({...await previewInstalled(data.installedId),hours});
        else if (data.input !== undefined){
          const preview=await previewTarget(data.input);
          const connection=data.binding?await resolveConnection(data.binding):preview.binding&&!data.releaseOnly?await resolveConnection(preview.binding):{};
          const {installation,localBinding,selectedLocationId,...remote}=preview;
          addWatch({...remote,...connection,hours,releaseOnly:!!data.releaseOnly});
        }
        else {
          const preset = PRESETS.find(p => p.id === data.presetId);
          if (!preset) throw failure('추가할 항목을 확인해 주세요.');
          addWatch({ ...preset, hours });
        }
      } else if(data.action==='remove-many'){
        const ids=new Set(batchIds(data.ids));
        const watches=[...ids].map(watchById);
        if(watches.some(w=>w.id===updatingId||(state.updateBatch?.running&&state.updateBatch.items.some(item=>item.id===w.id))))throw failure('업데이트가 끝난 뒤 변경해 주세요.',409);
        state.watches=state.watches.filter(w=>!ids.has(w.id));
        state.notifications=state.notifications.filter(n=>!ids.has(n.watchId)||n.demo);
      } else if (data.action === 'schedule' || data.action === 'remove') {
        const watch = watchById(data.id);
        if (watch.id === updatingId || (state.updateBatch?.running && state.updateBatch.items.some(item=>item.id===watch.id))) throw failure('업데이트가 끝난 뒤 변경해 주세요.', 409);
        if (data.action === 'schedule') { watch.hours = hoursValue(data.hours); watch.nextCheck = now() + watch.hours * 3600000; }
        else { state.watches = state.watches.filter(w => w.id !== watch.id); state.notifications = state.notifications.filter(n => n.watchId !== watch.id || n.demo); }
      } else if (data.action === 'update') await updateWatches([data.id]);
      else if (data.action === 'update-many') await updateWatches(data.ids);
      else if (data.action === 'check') { if (data.id) watchById(data.id); checkWatches(true, data.id || null).catch(console.error); }
      else if (data.action === 'dismiss') state.notifications = state.notifications.filter(n => n.id !== data.id);
      else if (data.action === 'acknowledge') {
        const watch = watchById(data.id); if(state.updateBatch?.running&&state.updateBatch.items.some(item=>item.id===watch.id))throw failure('업데이트가 끝난 뒤 변경해 주세요.',409); watch.acknowledgedVersion = watch.update?.version || watch.version; watch.update = null;
        state.notifications = state.notifications.filter(n => n.watchId !== watch.id && !(!n.watchId && n.name === watch.name));
      } else throw failure('지원하지 않는 동작이에요.');
      await save();
      if (data.action === 'add' || data.action === 'add-many' || data.action === 'add-presets') checkWatches().catch(console.error);
      return send(res, 200, await publicState());
    }
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/pet.svg': ['pet.svg', 'image/svg+xml'] };
    if (req.method !== 'GET' || !assets[req.url]) return send(res, 404, { error: '요청한 화면을 찾지 못했어요.' });
    const [file, type] = assets[req.url];
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; img-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
    res.end(await readFile(path.join(root, file)));
  } catch (error) { if (!res.headersSent) send(res, error.status || 500, { code: error.code || `HTTP_${error.status || 500}`, error: error.status ? error.message : '처리하지 못했어요. 잠시 후 다시 시도해 주세요.' }); }
});
server.listen(port, '127.0.0.1', () => {port=server.address().port;origin=`http://127.0.0.1:${port}`;console.log(`MOMO ${origin}`);});
setInterval(() => checkWatches().catch(console.error), 30000).unref();
function shutdown() {
  for (const child of activeChildren) child.kill('SIGTERM');
  server.close();
  saveQueue.finally(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
if (process.env.MOMO_PARENT_PID) setInterval(() => {
  try { process.kill(Number(process.env.MOMO_PARENT_PID), 0); } catch { shutdown(); }
}, 3000).unref();
