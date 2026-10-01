import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
function harness(watches){
  const elements=new Map();
  const context=vm.createContext({
    window:{}, document:{addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',setAttribute(){},focus(){}});return elements.get(id);}},
    fetch:()=>new Promise(()=>{}),setInterval(){},setTimeout(){},clearTimeout(){}
  });
  vm.runInContext(source,context);
  context.fixtures=watches;
  vm.runInContext('model={watches:fixtures};',context);
  return expression=>JSON.parse(JSON.stringify(vm.runInContext(expression,context)));
}
const fixtures=Array.from({length:100},(_,i)=>({id:String(i),name:'Tool '+(100-i),source:'npm',target:'tool-'+(100-i),status:i%7===0?'error':'ok',update:i%3===0?{version:'2'}:null}));
test('100개를 이름순으로 중복이나 누락 없이 5개씩 탐색',()=>{
  const run=harness(fixtures);const ids=[];
  for(let page=1;page<=20;page++){
    const result=run('ui.monitorPage='+page+'; monitorResults()');
    assert.equal(result.pages,20);assert.equal(result.rows.length,5);
    ids.push(...result.rows.map(w=>w.id));
  }
  assert.equal(new Set(ids).size,100);
  assert.deepEqual(run('ui.monitorPage=1; monitorResults().rows.map(w=>w.name)'),['Tool 1','Tool 2','Tool 3','Tool 4','Tool 5']);
});
test('검색은 페이지 밖의 이름과 출처를 찾고 상태 필터와 함께 적용',()=>{
  const run=harness([...fixtures,{id:'official',name:'Claude Code',source:'npm',target:'@anthropic-ai/claude-code',status:'ok',update:null},{id:'other',name:'claude',source:'github',target:'example/claude',status:'error',update:{version:'2'}}]);
  assert.deepEqual(run('ui.monitorQuery="@anthropic-ai"; monitorResults().rows.map(w=>w.id)'),['official']);
  assert.deepEqual(run('ui.monitorQuery="claude"; ui.monitorFilter="updates"; monitorResults().rows.map(w=>w.id)'),[]);
  assert.deepEqual(run('ui.monitorQuery="github"; ui.monitorFilter="errors"; monitorResults().rows.map(w=>w.id)'),['other']);
  assert.equal(run('ui.monitorQuery="없음"; monitorResults().items.length'),0);
});
test('삭제와 상태 변경 후 마지막 페이지와 빈 결과를 보정하고 원본 순서를 보존',()=>{
  const run=harness(fixtures.slice(0,6));
  assert.equal(run('ui.monitorPage=2; monitorResults().rows.length'),1);
  assert.equal(run('model.watches.pop(); monitorResults().pages'),1);
  assert.equal(run('ui.monitorPage'),1);
  assert.equal(run('model.watches[0].id'),'0');
  assert.equal(run('model.watches=[]; monitorResults().pages'),1);
  assert.deepEqual(run('monitorResults().rows'),[]);
});


test('상태별 필터는 빠짐과 중복 없이 전체 개수와 일치하고 릴리스 구독을 최신 설치로 표시하지 않음',()=>{
  const common={source:'npm',target:'example',status:'ok',update:null};
  const run=harness([
    {...common,id:'new',name:'New',installedVersion:'1',update:{version:'2'}},
    {...common,id:'current',name:'Current',installedVersion:'2'},
    {...common,id:'subscription',name:'Subscription',source:'github'},
    {...common,id:'failed',name:'Failed',status:'error',update:{version:'2'}},
    {...common,id:'pending',name:'Pending',status:'waiting'},
    {...common,id:'unknown',name:'Unknown',installedVersion:'x',comparisonUnknown:true},
    {...common,id:'installing',name:'Installing',status:'updating',update:{version:'2'}}
  ]);
  assert.deepEqual(run('monitorCounts()'),{updates:2,unchanged:2,errors:3});
  const ids=[];
  for(const group of ['updates','unchanged','errors'])ids.push(...run('ui.monitorFilter="'+group+'"; monitorResults().items.map(w=>w.id)'));
  assert.equal(ids.length,7);assert.equal(new Set(ids).size,7);
  assert.equal(run('watchStatus(model.watches[1])'),'새 버전 없음');
  assert.equal(run('watchStatus(model.watches[2])'),'구독 중');
  assert.equal(run('watchStatus(model.watches[3])'),'확인 필요');
});

test('새 버전 발견순과 최근 추가순은 원본을 보존하며 검색과 함께 동작',()=>{
  const base={source:'npm',status:'ok',hours:6};
  const run=harness([
    {...base,id:'a',name:'Alpha',target:'alpha',update:{at:200,version:'2'}},
    {...base,id:'z',name:'Zulu',target:'zulu',update:{at:300,version:'2'}},
    {...base,id:'b',name:'Beta',target:'beta',update:{version:'2'}},
    {...base,id:'c',name:'Current',target:'current',installedVersion:'1'},
    {...base,id:'e',name:'Error',target:'error',status:'error',update:{at:500,version:'2'}}
  ]);
  assert.deepEqual(run('ui.monitorSort="discovered"; monitorResults().items.map(w=>w.id)'),['z','a','b','c','e']);
  assert.deepEqual(run('ui.monitorSort="added"; monitorResults().items.map(w=>w.id)'),['e','c','b','z','a']);
  assert.deepEqual(run('ui.monitorQuery="alpha"; monitorResults().items.map(w=>w.id)'),['a']);
  assert.deepEqual(run('model.watches.map(w=>w.id)'),['a','z','b','c','e']);
});
test('상단 새 버전 버튼은 검색과 페이지를 초기화하고 정렬을 유지해 전체 새 버전을 보여줌',()=>{
  const run=harness(fixtures);
  run('ui.monitorQuery="없는 검색";ui.monitorFilter="unchanged";ui.monitorPage=10;ui.monitorSort="added";ui.view="detail";ui.detail="old";openUpdates();0');
  assert.deepEqual(run('({view:ui.view,query:ui.monitorQuery,filter:ui.monitorFilter,page:ui.monitorPage,sort:ui.monitorSort,detail:ui.detail})'),{view:'home',query:'',filter:'updates',page:1,sort:'added',detail:null});
  assert.equal(run('monitorResults().items.length'),run('monitorCounts().updates'));
});

test('구독 새 버전의 이전 값은 덮어쓴 최신 version이 아닌 update.before를 사용',()=>{
  const run=harness([]);
  assert.equal(run('previousVersion({version:"1.0.41",update:{before:"1.0.40",version:"1.0.41"}})'),'1.0.40');
  assert.equal(run('previousVersion({installedVersion:"1.0.30",version:"1.0.41",update:{before:"1.0.40"}})'),'1.0.30');
  assert.equal(run('previousVersion({version:"1.0.41",update:{version:"1.0.41"}})'),'확인 전');
  assert.equal(run('previousVersion({version:"1.0.41"})'),'1.0.41');
});
test('선택 화면 왕복과 순서 변경 후에도 도구별 확인 주기를 보존',()=>{
  const run=harness([]);
  run('ui.batch=[{presetId:"gemini",hours:3},{presetId:"grok",hours:12}];0');
  assert.deepEqual(run('keepBatchHours([{presetId:"grok"},{presetId:"gemini"},{presetId:"claude"}],"presetId").map(w=>w.hours)'),[12,3,6]);
  assert.deepEqual(run('keepBatchHours([{installedId:"npm:other"}],"installedId").map(w=>w.hours)'),[6]);
});
test('직접 입력에서 원래 설치 목록의 검색과 페이지, 스크롤로 복귀',()=>{
  const run=harness([]);
  run('ui.inventory={items:Array.from({length:20},(_,i)=>({id:"tool-"+i,name:"Tool "+i,target:"tool-"+i,source:"npm",manager:"npm"})),warnings:[]};ui.filter="Tool";ui.page=3;ui.view="installed";$("screen").scrollTop=150;openCustom();0');
  assert.equal(run('ui.view'),'custom');
  run('returnFromCustom();0');
  assert.deepEqual(run('({view:ui.view,query:ui.filter,page:ui.page,scroll:$("screen").scrollTop})'),{view:'installed',query:'Tool',page:3,scroll:150});
});
test('버전 정보 링크는 표시 버전을 지정하고 알 수 없는 값은 대기 상태로 표시',()=>{
  const run=harness([]);
  assert.equal(run('releaseURL({source:"npm",target:"@xai-official/grok",version:"1.0.41",update:{version:"1.0.42"}})'),'https://www.npmjs.com/package/@xai-official/grok/v/1.0.42');
  assert.equal(run('releaseURL({source:"github",target:"example/tool",version:"v1.2.3"})'),'https://github.com/example/tool/releases/tag/v1.2.3');
  assert.equal(run('checkTime(null)'),'아직 확인 전');
  assert.equal(run('checkTime(0)'),'아직 확인 전');
});
test('Codex는 npm 대신 버전별 공식 릴리스로 연결하고 원문은 HTML로 실행하지 않는다',()=>{
 const run=harness([]);
 assert.equal(run('releaseURL({source:"npm",target:"@openai/codex",version:"0.157.1"})'),'https://github.com/openai/codex/releases/tag/rust-v0.157.1');
 assert.equal(run('releaseLabel({source:"npm",target:"@openai/codex",version:"0.157.1"})'),'릴리스 노트');
 const html=run('ui.notes.set("npm:@openai/codex:0.157.1",{status:"available",body:"<script>alert(1)</script>"}); notesSection({source:"npm",target:"@openai/codex",version:"0.157.1"})');
 assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));
});

test('업데이트 대상이 없어지면 빈 선택 화면 대신 복귀 안내를 표시',()=>{
 const run=harness([]);
 const html=run('ui.view="update-select";render();$("screen").innerHTML');
 assert.match(html,/업데이트할 수 있는 항목이 없어요/);
 assert.match(html,/모니터링으로/);
 assert.doesNotMatch(html,/0개 업데이트|전체 해제/);
});
test('재시도할 수 없는 실패는 상세 확인으로 연결하고 빈 재선택을 제공하지 않음',()=>{
 const run=harness([{id:'failed',name:'Easydict',source:'homebrew',target:'cask/easydict',hours:6,status:'error',canUpdate:false,update:{version:'2'}}]);
 const html=run('model.updateBatch={running:false,items:[{id:"failed",name:"Easydict",status:"failed",error:"설치 위치를 확인하지 못했어요."}]};ui.view="update-progress";render();$("screen").innerHTML');
 assert.match(html,/data-detail="failed"/);
 assert.match(html,/상세 확인/);
 assert.doesNotMatch(html,/data-action="update-retry"/);
});
test('목록에서 빼기는 페이지와 검색을 바꿔도 선택을 유지하고 업데이트 중 항목은 선택 불가',()=>{
 const run=harness(fixtures.slice(0,6));
 const html=run('ui.removeChosen=new Set(["0","5"]);model.updatingId="1";ui.view="list-edit";render();$("screen").innerHTML');
 assert.match(html,/2개 빼기/);assert.match(html,/data-remove-select=/);assert.doesNotMatch(html,/data-remove=/);
 run('ui.monitorPage=2;render();ui.monitorQuery="Tool 100";render();0');
 assert.deepEqual(run('[...ui.removeChosen]'),['0','5']);
 assert.equal(run('canRemove(model.watches[1])'),false);
});

test('같은 목록의 상태 갱신은 내부 스크롤을 유지하고 페이지 변경은 맨 위에서 시작',()=>{
 const run=harness(fixtures.slice(0,6));
 run('ui.view="home";render();$("monitor-list").scrollTop=80;model.watches[0].status="waiting";render();0');
 assert.equal(run('$("monitor-list").scrollTop'),80);
 run('ui.monitorPage=2;render();0');
 assert.equal(run('$("monitor-list").scrollTop'),0);
});

test('연결되지 않은 GitHub 상세는 설치 최신 상태가 아닌 릴리스 구독으로 안내',()=>{
 const run=harness([{id:'repo',name:'Repo',source:'github',target:'example/repo',version:'v1.2.3',status:'ok',hours:6,installedVersion:null}]);
 const html=run('ui.detail="repo";ui.view="detail";render();$("screen").innerHTML');
 assert.match(html,/릴리스 소식 구독/);assert.match(html,/최근 릴리스/);assert.doesNotMatch(html,/새 버전이 없어요/);
});

test('공통 연결 화면은 설치 후보를 검색하고 5개씩 탐색하며 구독을 명시적으로 선택',()=>{
 const run=harness([]);
 const html=run('ui.connections=Array.from({length:7},(_,i)=>({name:"Tool "+i,caption:"/Applications/Tool "+i+".app",binding:{kind:"app"}}));ui.view="connect";render();$("screen").innerHTML');
 assert.equal((html.match(/data-connect-index=/g)||[]).length,5);assert.match(html,/소식만 구독/);
 assert.equal((run('ui.connectionPage=2;render();$("screen").innerHTML').match(/data-connect-index=/g)||[]).length,2);
 assert.match(run('ui.connectionQuery="없는 도구";render();$("screen").innerHTML'),/찾는 설치 도구가 없어요/);
});
test('직접 연결한 앱은 중복된 위치 선택 대신 연결 변경만 제공',()=>{
 const run=harness([{id:'app',name:'Novel',source:'github',target:'example/novel',version:'v2.0.0',installedVersion:'1.0.0',status:'ok',hours:6,localBinding:{kind:'app'},localApp:'Novel',selectedLocationId:'app:/Applications/Novel.app',installLocations:[{id:'app:/Applications/Novel.app',path:'/Applications/Novel.app',version:'1.0.0'}],update:{before:'1.0.0',version:'v2.0.0'}}]);
 const html=run('ui.detail="app";ui.view="detail";render();$("screen").innerHTML');
 assert.match(html,/data-action="connect-existing"/);assert.doesNotMatch(html,/data-action="location-select"/);assert.match(html,/업데이트는 해당 도구에서/);
});
