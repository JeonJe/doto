const $ = id => document.getElementById(id);
const native = window.webkit?.messageHandlers?.momo;
if (native) document.body.classList.add('native');
const tellNative = (action, data = {}) => native?.postMessage({ action, ...data });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const intervals = [[1,'1시간마다'],[3,'3시간마다'],[6,'6시간마다'],[12,'12시간마다'],[24,'하루에 한 번'],[168,'일주일에 한 번']];
const intervalLabel = hours => intervals.find(([v])=>v===hours)?.[1] || `${hours}시간마다`;
let model = null, epoch = 0, toastTimer, activeNotification = null;
const ui = { locationChoice:'', notes:new Map(), updateChosen:new Set(), view:'loading', selected:null, detail:null, add:null, editHours:6, menu:false, hidden:false, busy:false, error:'', draft:'', inventory:null, inventoryBusy:false, inventoryError:'', filter:'', page:1, monitorQuery:'', monitorFilter:'all', monitorPage:1, monitorSort:'name', removeOrigin:'detail', customOrigin:'installed', customScroll:0, chosen:new Set(), preparedChosen:new Set(), batchOrigin:'installed', batch:[], seen:new Set() };
function toast(text) { clearTimeout(toastTimer); $('toast').textContent=text; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,4500); }
async function api(endpoint,data) {
  const response=await fetch('/api/'+endpoint,data!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'요청을 처리하지 못했어요.');return result;
}
async function mutation(endpoint,data) { epoch++; try {const result=await api(endpoint,data);model=result;return result;} finally {epoch++;} }
async function act(task) {if(ui.busy)return;ui.busy=true;ui.error='';render();try{await task();}catch(error){ui.error=error.message;}finally{ui.busy=false;render();} }
function navigate(view) {ui.view=view;ui.menu=false;ui.error='';render();}
function updateOptions(){return model.watches.filter(w=>w.canUpdate&&w.update&&w.status!=='updating');}
function currentWatch() {return model?.watches.find(w=>w.id===ui.detail);}
function sourceCaption(w){const source=w.source==='github'?'GitHub':w.source==='homebrew'?'Homebrew':'npm';return `${source} / ${w.target}`;}
function previousVersion(w){return w.installedVersion||(w.update?(w.update.before||'확인 전'):(w.version||'확인 대기'));}
function releaseURL(w) {
  const version=w.update?.version||w.version;
  if(w.source==='npm'&&w.target==='@openai/codex'&&/^\d+\.\d+\.\d+$/.test(version||''))return `https://github.com/openai/codex/releases/tag/rust-v${version}`;
  if(w.source==='homebrew')return `https://formulae.brew.sh/${w.target}`;
  if(w.source==='github')return `https://github.com/${w.target}/releases${version?'/tag/'+encodeURIComponent(version):''}`;
  return `https://www.npmjs.com/package/${w.target}${version?'/v/'+encodeURIComponent(version):'?activeTab=versions'}`;
}
function hasNotesSource(w){return w.source==='github'||(w.source==='npm'&&w.target==='@openai/codex');}
function releaseLabel(w){return hasNotesSource(w)?'릴리스 노트':w.source==='homebrew'?'Homebrew에서 보기':'패키지 정보';}
function notesKey(w){return `${w.source}:${w.target}:${w.update?.version||w.version}`;}
function loadNotes(w){
  const key=notesKey(w);if(ui.notes.has(key))return;
  ui.notes.set(key,{status:'loading'});
  api(`release-notes?id=${encodeURIComponent(w.id)}`).then(result=>{
    ui.notes.set(key,result.version===(w.update?.version||w.version)?result:{status:'unavailable'});
  }).catch(()=>ui.notes.set(key,{status:'unavailable'})).finally(()=>{if(ui.view==='detail'&&currentWatch()&&notesKey(currentWatch())===key)render();});
}
function notesSection(w){
  if(!hasNotesSource(w))return '';
  loadNotes(w);const notes=ui.notes.get(notesKey(w));
  const body=notes.status==='loading'?'변경 내용을 불러오고 있어요.':notes.status==='unavailable'?'변경 내용을 불러오지 못했어요.':notes.status==='no-summary'?'이 버전은 공식 변경 요약이 없어요.':notes.body;
  const readable=String(body||'').replace(/^#{1,6}\s+/gm,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1');
  return `<section class="release-section"><h2>변경 내용</h2><div class="release-description" role="status">${esc(readable)}</div>${notes.status==='unavailable'?'<button class="text-button" data-action="retry-notes">다시 불러오기</button>':''}</section>`;
}
function keepBatchHours(items,key){return items.map(item=>({...item,hours:ui.batch.find(old=>item[key]&&old[key]===item[key])?.hours??6}));}
function openCustom(){ui.customOrigin=ui.view==='installed'?'installed':'add';ui.customScroll=$('screen').scrollTop;navigate('custom');$('target-input')?.focus();}
function returnFromCustom(){navigate(ui.customOrigin);$('screen').scrollTop=ui.customScroll;}
function checkTime(value){return Number.isFinite(value)&&value>0?new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'아직 확인 전';}
function lastCheckText(){
  if(model.checking)return '새 버전 확인 중…';
  if(!model.watches.length)return '';
  if(model.watches.some(w=>w.status==='error'))return '확인하지 못한 항목이 있어요.';
  if(model.watches.some(w=>!w.lastCheck))return '첫 확인을 기다리고 있어요.';
  const minutes=Math.max(0,Math.floor((Date.now()-Math.min(...model.watches.map(w=>w.lastCheck)))/60000));
  return minutes<1?'방금 확인':minutes<60?`${minutes}분 전 확인`:minutes<1440?`${Math.floor(minutes/60)}시간 전 확인`:`${Math.floor(minutes/1440)}일 전 확인`;
}
function link(label,url) {return `<a class="install-link" data-external href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`;}
function heading(title){return `<h1 id="screen-title" tabindex="-1">${title}</h1>`;}
function back(action='home',label='모니터링'){return `<button class="back" data-action="${action}">← ${label}</button>`;}
function button(label,action,primary=false,disabled=false){return `<button class="${primary?'primary':'secondary'}" data-action="${action}" ${disabled||ui.busy?'disabled':''}>${label}</button>`;}
function intervalSelect(value,target,label='이 도구의 확인 주기'){return `<select data-interval="${target}" aria-label="${esc(label)}" ${ui.busy?'disabled':''}>${intervals.map(([h,label])=>`<option value="${h}" ${h===value?'selected':''}>${label}</option>`).join('')}</select>`;}
function routeHome(){ui.view=model?.onboarded?'home':'add';ui.error='';ui.menu=false;render();}
async function loadInventory(force=false){
  if(ui.inventoryBusy)return;ui.inventoryBusy=true;ui.inventoryError='';render();
  try{ui.inventory=await api(force?'installed?refresh=1':'installed');}catch{ui.inventoryError='설치 목록을 불러오지 못했어요. 다시 시도해 주세요.';}
  finally{ui.inventoryBusy=false;render();}
}
function installedOptions(){return (ui.inventory?.items||[]).filter(item=>!model.watches.some(w=>w.source===item.source&&w.target===item.target)).filter(item=>`${item.name} ${item.target} ${item.manager}`.toLowerCase().includes(ui.filter.trim().toLowerCase()));}
const monitorPageSize=5;
function watchGroup(w){
  if(w.status==='error'||w.status==='waiting')return 'errors';
  if(w.status==='updating'||w.update)return 'updates';
  if(w.status!=='ok'||w.comparisonUnknown)return 'errors';
  return 'unchanged';
}
function monitorCounts(){
  const counts={updates:0,unchanged:0,errors:0};
  for(const w of model.watches)counts[watchGroup(w)]++;
  return counts;
}
const monitorSorts=[['name','이름순'],['discovered','새 버전 발견순'],['added','최근 추가순']];
function openUpdates(){
  ui.monitorQuery='';ui.monitorFilter='updates';ui.monitorPage=1;ui.detail=null;
  navigate('home');$('screen').scrollTop=0;$('monitor-filter-updates')?.focus();
}
function monitorResults(){
  const query=ui.monitorQuery.trim().toLocaleLowerCase();
  const addedOrder=new Map(model.watches.map((w,index)=>[w.id,index]));
  const discoveredAt=w=>watchGroup(w)==='updates'?(Number.isFinite(w.update?.at)?w.update.at:0):-1;
  const items=model.watches.filter(w=>(ui.monitorFilter==='all'||watchGroup(w)===ui.monitorFilter)&&
    `${w.name} ${sourceCaption(w)}`.toLocaleLowerCase().includes(query))
    .sort((a,b)=>(ui.monitorSort==='discovered'?discoveredAt(b)-discoveredAt(a):ui.monitorSort==='added'?addedOrder.get(b.id)-addedOrder.get(a.id):0)||a.name.localeCompare(b.name,'ko',{numeric:true,sensitivity:'base'})||sourceCaption(a).localeCompare(sourceCaption(b))||a.id.localeCompare(b.id));
  const pages=Math.max(1,Math.ceil(items.length/monitorPageSize));
  ui.monitorPage=Math.max(1,Math.min(ui.monitorPage,pages));
  return {items,pages,rows:items.slice((ui.monitorPage-1)*monitorPageSize,ui.monitorPage*monitorPageSize)};
}
function watchStatus(w){return w.status==='updating'?'업데이트 중':w.status==='error'?'확인 필요':w.status==='waiting'?'확인 대기':w.update?'새 버전 있음':watchGroup(w)==='errors'?'확인 필요':'새 버전 없음';}
function monitorList(editing=false){
  const {items,pages,rows}=monitorResults();
  const counts=monitorCounts();
  const filters=[['all','전체',model.watches.length],['updates','새 버전',counts.updates],['unchanged','새 버전 없음',counts.unchanged],['errors','확인 필요',counts.errors]];
  return `<div class="monitor-heading"><div>${heading(editing?'목록 편집':'모니터링 중')}<p>${editing?'목록에서 뺄 항목을 골라 주세요.':'새 버전이 있을 때만 알려드려요.'}</p></div><img src="/pet.svg" alt="" width="48" height="48"></div>
    ${model.watches.length?`<label class="sr-only" for="monitor-search">모니터링 검색</label><input id="monitor-search" type="search" placeholder="이름이나 패키지 검색" value="${esc(ui.monitorQuery)}" autocomplete="off">
    <div class="monitor-filters" role="group" aria-label="모니터링 상태 필터">${filters.map(([key,label,count])=>`<button id="monitor-filter-${key}" data-action="monitor-filter" data-filter="${key}" aria-pressed="${ui.monitorFilter===key}">${label} <span>${count}</span></button>`).join('')}</div>
    ${ui.monitorFilter==='errors'?'<p class="filter-help">조회에 실패했거나, 아직 버전을 비교하지 못한 항목이에요.</p>':''}
    <div class="monitor-summary"><div class="monitor-summary-main">${ui.monitorQuery?`<span role="status">검색 결과 ${items.length}개</span>`:''}${editing?'':'<button class="text-button edit-list-button" data-action="list-edit">목록 편집</button>'}</div><label class="sr-only" for="monitor-sort">모니터링 정렬</label><select id="monitor-sort" aria-label="모니터링 정렬">${monitorSorts.map(([key,label])=>`<option value="${key}" ${ui.monitorSort===key?'selected':''}>${label}</option>`).join('')}</select></div>`:''}
    <div class="monitor-list">${rows.length?rows.map(w=>`${editing?`<div class="watch-row edit-watch-row">`:`<button class="watch-row ${w.update?'updated':''}" data-detail="${esc(w.id)}" id="monitor-row-${esc(w.id)}" aria-label="${esc(w.name)}, ${esc(sourceCaption(w))}, ${intervalLabel(w.hours)} 확인, ${watchStatus(w)}">`}<span class="tool-icon">${esc(w.icon||'⌘')}</span><span class="tool-label"><span class="watch-name">${esc(w.name)}</span><span class="small watch-source" title="${esc(sourceCaption(w))}">${esc(sourceCaption(w))}</span></span>${editing?`<button class="remove-watch-button" data-remove="${esc(w.id)}" aria-label="${esc(w.name)} 목록에서 빼기" ${ui.busy||w.id===model.updatingId?'disabled':''}>빼기</button></div>`:`<span class="watch-state"><span class="status ${w.status==='error'?'error':''}">${watchStatus(w)}</span><span class="small">${intervalLabel(w.hours)} 확인</span></span><span class="chevron" aria-hidden="true">›</span></button>`}`).join(''):
    `<div class="empty">${!model.watches.length?(editing?'목록에 남은 항목이 없어요.':'추가를 눌러 모니터링을 시작해 보세요.'):ui.monitorQuery?'검색 결과가 없어요.':ui.monitorFilter==='updates'?'새 버전이 있는 항목이 없어요.':ui.monitorFilter==='unchanged'?'해당하는 항목이 없어요.':'확인이 필요한 항목이 없어요.'}${model.watches.length?'<br><button class="text-button" data-action="monitor-reset">전체 목록 보기</button>':''}</div>`}</div>
    ${items.length>monitorPageSize?`<nav class="pagination monitor-pagination" aria-label="모니터링 페이지"><button id="monitor-prev" data-action="monitor-prev" ${ui.monitorPage===1?'disabled':''}>이전</button><span role="status">${ui.monitorPage} / ${pages}</span><button id="monitor-next" data-action="monitor-next" ${ui.monitorPage===pages?'disabled':''}>다음</button></nav>`:''}
    ${editing?'':`<div class="latest"><span>${lastCheckText()}</span><button id="monitor-check" class="text-button" data-action="check" ${!model.watches.length||model.checking||ui.busy||!!model.updatingId?'disabled':''}>↻ 다시 확인</button></div>`}`;
}
async function startPreparedBatch(){
  await act(async()=>{const {items}=await api('presets/preview-batch',{ids:[...ui.preparedChosen]});ui.batch=keepBatchHours(items,'presetId');ui.batchOrigin='presets';ui.view='bulk-confirm';});
}
async function startInstalledBatch(){
  await act(async()=>{const {items}=await api('installed/preview-batch',{ids:[...ui.chosen]});ui.batch=keepBatchHours(items,'installedId');ui.batchOrigin='installed';ui.view='bulk-confirm';});
}

function render(){
  $('app-window').hidden=ui.hidden;$('reopen-bar').hidden=!ui.hidden;
  if(!model){$('screen').innerHTML=ui.error?`<div class="loading">${esc(ui.error)}<br><button data-action="retry" class="text-button">다시 연결</button></div>`:'<div class="loading" role="status"><span class="spinner"></span>설치된 도구를 확인하고 있어요.</div>';return;}
  if(['detail','monitor-edit','remove-confirm','location-select'].includes(ui.view)&&!currentWatch()){ui.view='home';}
  const w=currentWatch(), toolPage=ui.view==='detail';if(!toolPage)ui.menu=false;
  $('tool-menu-button').hidden=!toolPage;$('tool-menu-button').disabled=ui.busy||!!model.updatingId;
  $('tool-menu-button').setAttribute('aria-expanded',String(ui.menu));$('tool-menu').hidden=!ui.menu;
  const updates=monitorCounts().updates;
  $('update-indicator').hidden=!updates; $('update-indicator').textContent=`새 버전 ${updates}개`;
  const screen=$('screen');screen.className=ui.view==='installed'?'screen inventory-screen':['home','list-edit'].includes(ui.view)?'screen monitor-screen':'screen';
  let html='',end='';const error=ui.error?`<p class="operation-error" role="alert">${esc(ui.error)}</p>`:'';
  if(ui.view==='onboarding'){
    const found=model.presets.filter(p=>['claude','codex'].includes(p.id)&&p.installedVersion);
    html=`<div class="intro"><img class="pet" src="/pet.svg" alt="도토">${heading(found.length?'모니터링할 도구를 골라 주세요':'모니터링할 도구를 추가해 주세요')}<p>${found.length?'이 컴퓨터에 설치된 도구예요.':'설치하지 않은 도구도 추가할 수 있어요.'}</p></div>${found.length?`<div class="presets">${found.map(p=>`<label class="preset-row"><input data-select="${p.id}" type="checkbox" ${ui.selected.has(p.id)?'checked':''} ${ui.busy?'disabled':''}><span class="tool-icon">${p.icon}</span><span class="tool-label">${esc(p.name)}</span><span class="tag">설치됨</span></label>`).join('')}</div>`:''}`;
    end=`<div class="bottom">${found.length?button('모니터링 시작 →','start',true,!ui.selected.size):button('＋ 추가','add',true)}<p class="hint">${found.length?'6시간마다 새 버전을 확인해요.':'추가할 때 확인 주기를 정할 수 있어요.'}</p></div>`;
  }else if(ui.view==='home'){
    html=monitorList();
    end=`<div class="bottom home-actions">${model.updateBatch?.running?button('업데이트 진행 보기','update-progress',true):updateOptions().length?button(`한꺼번에 업데이트 (${updateOptions().length})`,'update-select',true):''}${button('＋ 추가','add',!updateOptions().length&&!model.updateBatch?.running)}</div>${model.updateBatch&&!model.updateBatch.running?'<button class="text-button" data-action="update-progress">최근 업데이트 결과</button>':''}`;
  }else if(ui.view==='list-edit'){
    html=monitorList(true);
    end=`<div class="bottom">${button('완료','home',true)}</div>`;
  }else if(ui.view==='add'){
    const prepared=model.presets;
    const monitored=p=>model.watches.some(w=>w.source===p.source&&w.target===p.target);
    ui.preparedChosen=new Set([...ui.preparedChosen].filter(id=>prepared.some(p=>p.id===id&&!monitored(p))));
    html=`${model.onboarded?back():''}${heading(model.onboarded?'추가':'새 버전을 알려드려요')}${model.onboarded?'<h2 class="prepared-title">미리 준비했어요</h2>':''}<p class="description">${model.onboarded?'고르기만 하면 새 버전을 알려드려요.':'모니터링할 도구를 골라 주세요.'}</p><div class="prepared-list">${prepared.map(p=>monitored(p)?`<div class="preset-row prepared-item already-monitored"><span class="tool-icon">${esc(p.icon)}</span><span class="tool-label">${esc(p.name)}</span><span class="registered-tag">모니터링 중</span></div>`:`<label class="preset-row prepared-item"><input type="checkbox" id="prepared-${p.id}" data-prepared="${p.id}" aria-label="${esc(p.name)} 선택" ${ui.preparedChosen.has(p.id)?'checked':''} ${ui.busy?'disabled':''}><span class="tool-icon">${esc(p.icon)}</span><span class="tool-label">${esc(p.name)}<span class="small">${p.installationCount>1?`설치 위치 ${p.installationCount}개`:p.installedVersion?`설치 버전 ${esc(p.installedVersion)}`:'새 버전 소식 받기'}</span></span></label>`).join('')}</div>`;
    end=`<div class="bottom prepared-actions"><p class="selection-count" role="status">${ui.preparedChosen.size?`${ui.preparedChosen.size}개 선택`:prepared.every(monitored)?'준비된 도구는 모두 모니터링 중이에요.':''}</p>${button(ui.busy?'버전 확인 중…':'다음','review-prepared',true,!ui.preparedChosen.size)}<button class="text-button other-tools-link" data-action="installed" ${ui.busy?'disabled':''}>다른 도구 찾기 →</button></div>`;
  }else if(ui.view==='installed'){
    if(ui.inventory){const available=new Set(ui.inventory.items.filter(item=>!model.watches.some(w=>w.source===item.source&&w.target===item.target)).map(item=>item.id));ui.chosen=new Set([...ui.chosen].filter(id=>available.has(id)));}
    const items=installedOptions(),pages=Math.max(1,Math.ceil(items.length/5));ui.page=Math.min(ui.page,pages);
    const rows=items.slice((ui.page-1)*5,ui.page*5);
    html=`${back('add','추가')}${heading('설치된 도구에서 추가')}<p class="description inventory-help">Homebrew 도구와 npm 전역 패키지를 보여드려요.</p><label class="sr-only" for="installed-search">설치된 도구 검색</label><input id="installed-search" type="search" placeholder="설치된 도구 검색" value="${esc(ui.filter)}" autocomplete="off"><div class="inventory-toolbar"><span>이름순${ui.inventory?` / ${items.length}개`:''}</span><button class="text-button" data-action="refresh-installed" ${ui.inventoryBusy?'disabled':''}>${ui.inventoryBusy?'불러오는 중…':'새로고침'}</button></div>${ui.busy?'<p class="inventory-warning" role="status">버전 정보를 확인하고 있어요.</p>':''}${ui.inventoryError?`<p class="operation-error" role="alert">${esc(ui.inventoryError)}</p>`:''}${ui.inventory?.warnings.map(w=>`<p class="inventory-warning">${esc(w)}</p>`).join('')||''}${ui.inventoryBusy&&!ui.inventory?'<p class="loading" role="status">설치된 도구를 찾고 있어요.</p>':rows.length?`<div class="installed-list">${rows.map(item=>`<label class="recommendation installed-item selectable-item"><input type="checkbox" id="installed-option-${esc(item.id)}" data-installed="${esc(item.id)}" aria-label="${esc(item.name)} 선택" ${ui.chosen.has(item.id)?'checked':''} ${ui.busy?'disabled':''}><span class="tool-icon">${esc(item.icon)}</span><span class="tool-label">${esc(item.name)}<span class="small">${esc(item.installedVersion)} / ${esc(item.manager)}</span></span></label>`).join('')}</div><nav class="pagination" aria-label="설치 목록 페이지"><button data-action="previous-page" ${ui.page===1?'disabled':''}>이전</button><span aria-live="polite">${ui.page} / ${pages}</span><button data-action="next-page" ${ui.page===pages?'disabled':''}>다음</button></nav>`:`<div class="empty">${ui.filter?'검색 결과가 없어요.':'추가할 수 있는 도구가 없어요.'}</div>`}`;
    end=`<div class="bottom selection-actions"><div class="selection-summary"><span role="status">${ui.chosen.size}개 선택</span>${ui.chosen.size?`<button class="text-button" data-action="clear-selection" ${ui.busy?'disabled':''}>선택 해제</button>`:''}</div>${button(ui.busy?'버전 확인 중…':'다음','review-selection',true,!ui.chosen.size||ui.inventoryBusy)}<button class="text-button direct-entry" data-action="custom">목록에 없나요? 직접 입력</button></div>`;
  }else if(ui.view==='bulk-confirm'){
    html=`${back('selection-back',ui.batchOrigin==='presets'?'추가':'설치된 도구')}${heading('확인 주기를 정해 주세요')}<p class="description">선택한 ${ui.batch.length}개 도구를 추가해요.</p><div class="batch-items">${ui.batch.map((item,index)=>`<section class="batch-item"><h2>${esc(item.name)}</h2>${!item.installedVersion?'<p class="small">새 버전 소식 받기</p>':''}<div class="interval-control"><span>확인 주기</span>${intervalSelect(item.hours,'batch-'+index,`${item.name} 확인 주기`)}</div></section>`).join('')}</div>`;
    end=`<div class="bottom">${button(ui.busy?'추가 중…':`${ui.batch.length}개 추가`,'confirm-batch',true,!ui.batch.length)}</div>`;
  }else if(ui.view==='custom'){
    html=`${back('custom-back',ui.customOrigin==='installed'?'설치된 도구':'추가')}${heading('직접 입력')}<form id="target-form" class="search-form add-target-form"><label class="field-label" for="target-input">GitHub 링크 또는 npm 패키지 이름</label><input id="target-input" type="text" maxlength="300" autocomplete="off" spellcheck="false" placeholder="예: https://github.com/oven-sh/bun 또는 typescript" value="${esc(ui.draft)}" aria-describedby="target-help" ${ui.busy?'disabled':''}><p id="target-help" class="description">GitHub는 공개 저장소의 정식 릴리스만 지원해요.</p><button class="primary" type="submit" ${ui.busy?'disabled':''}>${ui.busy?'확인 중…':'버전 확인'}</button></form>`;
  }else if(ui.view==='add-confirm'){
    const item=ui.add;if(!item){ui.view='add';return render();}
    const sourceLabel=item.installedId?`${item.manager} / 설치 버전 ${item.installedVersion}`:item.target!==item.name?item.target:'';
    html=`${back('edit-add',ui.add.installedId?'설치된 도구':'직접 입력')}${heading('확인 주기를 정해 주세요')}<div class="detail-heading"><span class="tool-icon">${esc(item.icon||'⌘')}</span><h2>${esc(item.name)}</h2></div>${sourceLabel||item.version?`<p class="request-quote">${esc(sourceLabel)}${sourceLabel&&item.version?'<br>':''}${item.version?`최신 버전 ${esc(item.version)}`:''}</p>`:''}<div class="interval-control"><span>확인 주기</span>${intervalSelect(item.hours,'add')}</div><p class="description">새 버전이 나오면 알려드려요.</p>`;
    end=`<div class="bottom">${button(ui.busy?'추가 중…':'추가','confirm-add',true)}</div>`;
  }else if(ui.view==='detail'){
    const updating=w.status==='updating',changed=!!w.update;
    html=`${back()}<div class="detail-heading"><span class="tool-icon">${esc(w.icon||'⌘')}</span>${heading(esc(w.name))}</div><p class="description">${esc(sourceCaption(w))}</p>${w.source==='npm'&&w.target==='claude'?'<p class="operation-error">이 패키지는 공식 Claude Code와 달라요.<br>공식 패키지명은 @anthropic-ai/claude-code예요.</p>':''}<div class="version-panel ${changed?'':'neutral'}"><p>${updating?'업데이트 중…':w.status==='error'?'확인이 필요해요.':changed?'새 버전이 나왔어요.':w.status==='waiting'?'아직 버전을 확인하지 못했어요.':w.comparisonUnknown?'설치 버전과 비교하지 못했어요.':'새 버전이 없어요.'}</p><div class="versions"><span><small>${w.installedVersion?'설치 버전':changed?'이전 확인 버전':'확인 버전'}</small>${esc(previousVersion(w))}</span>${changed?`<span>→</span><span><small>새 버전</small>${esc(w.update.version)}</span>`:''}</div>${updating?'<p role="status"><span class="spinner"></span>완료 후 설치 버전을 다시 확인해요.</p>':''}</div>${!w.canUpdate&&!w.installationIssue?'<p class="description">새 버전 소식만 알려드려요.</p>':''}${w.error&&!w.installationIssue?`<p class="operation-error">${esc(w.error)}</p>`:''}${w.installLocations?.length?`<div class="installation-location"><span class="small">설치 위치</span><p>${esc(w.installationIssue||w.installLocations.find(item=>item.id===w.selectedLocationId)?.path||'위치를 선택해 주세요.')}</p>${button(w.installationIssue?'설치 위치 선택':'위치 변경','location-select',!!w.installationIssue,!!model.updatingId||model.checking)}</div>`:''}${w.updateVerification?`<p class="small">업데이트 확인: ${esc(w.updateVerification.before)} → ${esc(w.updateVerification.after)}</p>`:''}${notesSection(w)}<dl class="check-times"><div><dt>마지막 확인</dt><dd>${checkTime(w.lastCheck)}</dd></div><div><dt>다음 확인</dt><dd>${Number.isFinite(w.nextCheck)&&w.nextCheck>Date.now()?checkTime(w.nextCheck):'곧 확인'}</dd></div></dl>`;
    end=`<div class="bottom detail-actions">${changed&&w.canUpdate?button(updating?'업데이트 중…':'업데이트','update',true,updating||model.checking):''}${w.status==='error'?button('다시 확인','check-one'):''}<div class="detail-links">${link(releaseLabel(w),releaseURL(w))}${ui.notes.get(notesKey(w))?.compareUrl?link('변경 내역 비교',ui.notes.get(notesKey(w)).compareUrl):''}${w.guide&&w.status==='error'&&!w.installationIssue?link('해결 방법',w.guide):''}</div></div>`;
  }else if(ui.view==='update-select'){
    const options=updateOptions();
    ui.updateChosen=new Set([...ui.updateChosen].filter(id=>options.some(w=>w.id===id)));
    const excluded=model.watches.filter(w=>w.update&&!w.canUpdate).length;
    html=`${back()}${heading('업데이트할 도구를 골라 주세요')}<div class="selection-summary"><span>${ui.updateChosen.size}개 선택</span><button class="text-button" data-action="update-toggle-all">${ui.updateChosen.size===options.length?'전체 해제':'전체 선택'}</button></div><div class="update-selection">${options.map(w=>`<label class="preset-row"><input type="checkbox" id="update-choice-${esc(w.id)}" data-update-select="${esc(w.id)}" aria-label="${esc(w.name)} 업데이트 선택" ${ui.updateChosen.has(w.id)?'checked':''} ${ui.busy?'disabled':''}><span class="tool-label">${esc(w.name)}<span class="small">${esc(w.installedVersion)} → ${esc(w.update.version)}</span><span class="small">${esc(sourceCaption(w))}</span></span></label>`).join('')}</div>${excluded?`<p class="description">앱에서 업데이트할 수 없는 ${excluded}개는 제외했어요.</p>`:''}`;
    end=`<div class="bottom">${button(`${ui.updateChosen.size}개 업데이트`,'update-run',true,!ui.updateChosen.size||!!model.updatingId||model.checking)}</div>`;
  }else if(ui.view==='update-progress'){
    const batch=model.updateBatch;
    const labels={queued:'대기 중',running:'업데이트 중',succeeded:'완료',failed:'실패'};
    const failed=batch?.items.filter(item=>item.status==='failed')||[];
    html=`${back()}${heading(batch?.running?'업데이트하고 있어요':'업데이트 결과')}<div role="status">${(batch?.items||[]).map(item=>`<div class="update-result"><div><strong>${esc(item.name)}</strong><span>${labels[item.status]||'확인 필요'}</span></div>${item.error?`<p class="operation-error">${esc(item.error)}</p>`:''}</div>`).join('')}</div>`;
    end=`<div class="bottom detail-actions">${!batch?.running&&failed.length?button('실패한 항목 다시 선택','update-retry'):''}${button(batch?.running?'목록으로':'완료','home',true)}</div>`;
  }else if(ui.view==='location-select'){
    html=`${back('detail','상세')}${heading('설치 위치를 골라 주세요')}<p class="description">선택한 위치의 버전을 확인하고 업데이트해요.</p><div class="location-options">${(w.installLocations||[]).map((item,index)=>`<label class="preset-row"><input type="radio" name="location" id="location-${index}" data-location="${esc(item.id)}" ${ui.locationChoice===item.id?'checked':''}><span class="tool-label"><span class="location-path">${esc(item.path)}</span><span class="small">${esc(item.version||'버전 확인 불가')}</span></span></label>`).join('')}</div>`;
    end=`<div class="bottom">${button('선택','save-location',true,!ui.locationChoice||!!model.updatingId||model.checking)}</div>`;
  }else if(ui.view==='monitor-edit'){
    html=`${back('detail','상세')}${heading('확인 주기 변경')}<div class="detail-heading"><span class="tool-icon">${esc(w.icon||'⌘')}</span><h2>${esc(w.name)}</h2></div><div class="interval-control"><span>확인 주기</span>${intervalSelect(ui.editHours,'edit')}</div>`;
    end=`<div class="bottom">${button('저장','save-monitor',true)}</div>`;
  }else if(ui.view==='remove-confirm'){
    html=`${back('cancel-remove',ui.removeOrigin==='list-edit'?'목록 편집':'상세')}<div class="remove-question">${heading(`${esc(w.name)}<br>목록에서 뺄까요?`)}<p class="description">설치된 도구는 유지돼요.</p></div>`;
    end=`<div class="bottom detail-actions">${button('목록에서 빼기','confirm-remove',true)}${button('취소','cancel-remove')}</div>`;

  }
  const next=html+error+end;
  if(screen.rendered!==next){const focused=document.activeElement?.id;const start=document.activeElement?.selectionStart;const finish=document.activeElement?.selectionEnd;screen.innerHTML=next;screen.rendered=next;if(focused&&$(focused)){const el=$(focused);el.focus();if(typeof start==='number'&&el.setSelectionRange)el.setSelectionRange(start,finish);}}
}
function notificationState(){
  const latest=model.notifications.at(-1);
  if(!latest){activeNotification=null;$('notification').hidden=true;return;}
  if(activeNotification?.id===latest.id)return;
  activeNotification=latest;
  $('notification-title').textContent=`${latest.name}에 새 버전이 있어요`;
  $('notification-copy').textContent=`${latest.before} → ${latest.version}`;
  if(!ui.seen.has(latest.id)){ui.seen.add(latest.id);$('notification').hidden=!(ui.hidden||document.body.classList.contains('notice-mode'));tellNative('notification',{id:latest.id});}
}
let refreshing=false;
async function refresh(){
  if(refreshing)return;refreshing=true;const revision=epoch;
  try{const result=await api('state');if(revision!==epoch)return;model=result;if(ui.selected===null)ui.selected=new Set(model.presets.filter(p=>['claude','codex'].includes(p.id)&&p.installedVersion).map(p=>p.id));if(ui.view==='loading')ui.view=model.onboarded?'home':'add';
    render();notificationState();
  }catch(error){if(!model){ui.error='도토에 연결하지 못했어요. 다시 연결하거나 앱을 다시 열어 주세요.';render();}else{ui.error='연결이 끊겼어요. 앱을 다시 열어 주세요.';render();}}
  finally{refreshing=false;}
}
async function previewInput(){if(ui.busy)return;await act(async()=>{const item=await api('preview',{input:ui.draft});ui.add={...item,hours:6};ui.view='add-confirm';});}
document.addEventListener('click',async event=>{
  const external=event.target.closest('a[data-external]');if(external&&native){event.preventDefault();tellNative('openExternal',{url:external.href});return;}
  if(ui.busy&&!event.target.closest('[data-action=hide]'))return;
  const remove=event.target.closest('[data-remove]');if(remove){if(remove.disabled||!model.watches.some(w=>w.id===remove.dataset.remove))return;ui.detail=remove.dataset.remove;ui.removeOrigin='list-edit';navigate('remove-confirm');return;}
  const selected=event.target.closest('[data-detail]');if(selected){ui.detail=selected.dataset.detail;navigate('detail');return;}
  const control=event.target.closest('[data-action]');if(!control){if(ui.menu&&!event.target.closest('#tool-menu')){ui.menu=false;render();}return;}if(control.disabled)return;
  const action=control.dataset.action;
  if(action==='hide'){if(native)tellNative('hide');else{ui.hidden=true;render();$('notification').hidden=!activeNotification;$('reopen').focus();}return;}
  if(action==='reopen'){ui.hidden=false;$('notification').hidden=true;render();$('screen-title')?.focus();return;}
  if(action==='home'){routeHome();return;}
  if(action==='update-select'||action==='update-retry'){const failed=model.updateBatch?.items.filter(i=>i.status==='failed').map(i=>i.id)||[];ui.updateChosen=new Set(updateOptions().filter(w=>action==='update-select'||failed.includes(w.id)).map(w=>w.id));navigate('update-select');return;}
  if(action==='update-toggle-all'){ui.updateChosen=ui.updateChosen.size===updateOptions().length?new Set():new Set(updateOptions().map(w=>w.id));render();return;}
  if(action==='update-progress'){navigate('update-progress');return;}
  if(action==='list-edit'){navigate('list-edit');return;}
  if(action==='cancel-remove'){navigate(ui.removeOrigin);return;}
  if(action==='show-updates'){openUpdates();return;}
  if(action==='monitor-filter'){ui.monitorFilter=control.dataset.filter;ui.monitorPage=1;render();return;}
  if(action==='monitor-reset'){ui.monitorQuery='';ui.monitorFilter='all';ui.monitorPage=1;render();$('monitor-search')?.focus();return;}
  if(action==='monitor-prev'||action==='monitor-next'){ui.monitorPage+=action==='monitor-prev'?-1:1;render();const pageButton=$(control.id);if(pageButton?.disabled)$('monitor-row-'+monitorResults().rows[0]?.id)?.focus();return;}
  if(action==='retry'){ui.error='';render();await refresh();return;}
  if(action==='tool-menu'){ui.menu=!ui.menu;render();return;}
  if(action==='add'){ui.add=null;navigate('add');return;}
  if(action==='installed'){navigate('installed');await loadInventory();return;}
  if(action==='review-prepared'){await startPreparedBatch();return;}
  if(action==='clear-selection'){ui.chosen.clear();render();return;}
  if(action==='selection-back'){navigate(ui.batchOrigin==='presets'?'add':'installed');return;}
  if(action==='review-selection'){await startInstalledBatch();return;}
  if(action==='refresh-installed'){await loadInventory(true);return;}
  if(action==='previous-page'){ui.page=Math.max(1,ui.page-1);render();return;}
  if(action==='next-page'){ui.page=Math.min(Math.ceil(installedOptions().length/5),ui.page+1);render();return;}
  if(action==='custom'){openCustom();return;}
  if(action==='custom-back'){returnFromCustom();return;}
  if(action==='edit-add'){navigate(ui.add?.installedId?'installed':'custom');return;}
  if(action==='retry-notes'){ui.notes.delete(notesKey(currentWatch()));render();return;}
  if(action==='detail'){navigate('detail');return;}
  if(action==='location-select'){ui.locationChoice=currentWatch().selectedLocationId||'';navigate('location-select');return;}
  if(action==='monitor-edit'){ui.editHours=currentWatch().hours;navigate('monitor-edit');return;}
  if(action==='remove-start'){ui.removeOrigin='detail';navigate('remove-confirm');return;}
  if(action==='open-notification'){const n=activeNotification;ui.detail=model.watches.find(w=>w.id===n?.watchId||(!n?.watchId&&w.name===n?.name))?.id||null;ui.hidden=false;document.body.classList.remove('notice-mode');navigate(ui.detail?'detail':'home');tellNative('show');await act(async()=>{if(n)await mutation('manage',{action:'dismiss',id:n.id});$('notification').hidden=true;activeNotification=null;});return;}
  if(action==='dismiss-notification'){await act(async()=>{if(activeNotification)await mutation('manage',{action:'dismiss',id:activeNotification.id});$('notification').hidden=true;activeNotification=null;if(native&&document.body.classList.contains('notice-mode'))tellNative('hide');});return;}
  await act(async()=>{
    const firstAddition=!model.onboarded;
    if(action==='start'){await mutation('onboarding',{presetIds:[...ui.selected]});ui.view='home';}
    else if(action==='confirm-batch'){const count=ui.batch.length;await mutation('manage',{action:ui.batchOrigin==='presets'?'add-presets':'add-many',items:ui.batch.map(item=>({...(item.presetId?{presetId:item.presetId}:{installedId:item.installedId}),hours:item.hours}))});ui.chosen.clear();ui.preparedChosen.clear();ui.batch=[];ui.view='home';toast(firstAddition?'창을 숨겨도 확인해요. 메뉴 막대에서 다시 열 수 있어요.':`${count}개 도구를 추가했어요.`);}
    else if(action==='confirm-add'){await mutation('manage',{action:'add',hours:ui.add.hours,...(ui.add.installedId?{installedId:ui.add.installedId}:ui.add.input?{input:ui.add.input}:{presetId:ui.add.id})});ui.add=null;ui.draft='';ui.view='home';toast(firstAddition?'창을 숨겨도 확인해요. 메뉴 막대에서 다시 열 수 있어요.':'모니터링을 추가했어요.');}
    else if(action==='save-location'){await mutation('manage',{action:'select-location',id:ui.detail,locationId:ui.locationChoice});ui.view='detail';}
    else if(action==='save-monitor'){await mutation('manage',{action:'schedule',id:ui.detail,hours:ui.editHours});ui.view='detail';toast('확인 주기를 저장했어요.');}
    else if(action==='confirm-remove'){await mutation('manage',{action:'remove',id:ui.detail});ui.detail=null;ui.view=ui.removeOrigin==='list-edit'?'list-edit':'home';toast('목록에서 뺐어요.');}
    else if(action==='check'||action==='check-one')await mutation('manage',{action:'check',...(action==='check-one'?{id:ui.detail}:{})});
    else if(action==='update'){await mutation('manage',{action:'update',id:ui.detail});ui.view='update-progress';}
    else if(action==='update-run'){await mutation('manage',{action:'update-many',ids:[...ui.updateChosen]});ui.view='update-progress';}
  });
});
document.addEventListener('change',event=>{if(event.target.matches('[data-location]')){ui.locationChoice=event.target.dataset.location;render();return;}if(event.target.matches('[data-update-select]')){event.target.checked?ui.updateChosen.add(event.target.dataset.updateSelect):ui.updateChosen.delete(event.target.dataset.updateSelect);render();return;}if(event.target.matches('[data-prepared]')){const id=event.target.dataset.prepared;event.target.checked?ui.preparedChosen.add(id):ui.preparedChosen.delete(id);render();return;}if(event.target.id==='monitor-sort'){if(!monitorSorts.some(([key])=>key===event.target.value))return;ui.monitorSort=event.target.value;ui.monitorPage=1;render();return;}if(event.target.matches('[data-installed]')){const id=event.target.dataset.installed;event.target.checked?ui.chosen.add(id):ui.chosen.delete(id);ui.error='';render();return;}if(event.target.matches('[data-select]')){const id=event.target.dataset.select;event.target.checked?ui.selected.add(id):ui.selected.delete(id);render();}if(event.target.matches('[data-interval]')){const value=Number(event.target.value);if(!intervals.some(([h])=>h===value))return;if(event.target.dataset.interval.startsWith('batch-')){const index=Number(event.target.dataset.interval.slice(6));if(ui.batch[index])ui.batch[index].hours=value;}else if(event.target.dataset.interval==='add')ui.add.hours=value;else ui.editHours=value;}});
document.addEventListener('input',event=>{if(event.target.id==='target-input')ui.draft=event.target.value;if(event.target.id==='monitor-search'){ui.monitorQuery=event.target.value;ui.monitorPage=1;render();}if(event.target.id==='installed-search'){ui.filter=event.target.value;ui.page=1;render();}});
document.addEventListener('submit',event=>{if(event.target.id==='target-form'){event.preventDefault();previewInput();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&ui.menu){ui.menu=false;render();$('tool-menu-button').focus();}});
if(native)window.momoDesktop={open(){ui.hidden=false;document.body.classList.remove('notice-mode');$('notification').hidden=true;render();},notification(){document.body.classList.add('notice-mode');$('notification').hidden=!activeNotification;}};
refresh();setInterval(refresh,4000);
