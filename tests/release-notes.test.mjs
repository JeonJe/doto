import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
function harness(response){const calls=[];const context=vm.createContext({now:()=>Date.now(),AbortSignal,fetch:async url=>{calls.push(url);return response;}});vm.runInContext(source.slice(source.indexOf('function notesSource('),source.indexOf('async function releaseInfo(')),context);return{calls,run:watch=>context.releaseNotesFor(watch)};}
const codex={source:'npm',target:'@openai/codex',version:'0.157.0',update:{version:'0.157.1'}};
test('Codex 표시 버전의 정확한 태그만 조회하고 동일 결과를 캐시한다',async()=>{
 const h=harness({ok:true,json:async()=>({tag_name:'rust-v0.157.1',body:'## Fixed\n- Fixed rendering.'})});
 const result=await h.run(codex);assert.equal(result.status,'available');assert.match(result.body,/Fixed rendering/);assert.equal(result.url,'https://github.com/openai/codex/releases/tag/rust-v0.157.1');await h.run(codex);assert.equal(h.calls.length,1);assert.match(h.calls[0],/tags\/rust-v0.157.1$/);
});
test('공식 요약이 없으면 원문을 지어내지 않고 동일 저장소 비교 링크만 제공한다',async()=>{
 const h=harness({ok:true,json:async()=>({tag_name:'rust-v0.157.1',body:'Release highlights could not be determined\nhttps://evil.example/compare/a...b\nFull Changelog: https://github.com/openai/codex/compare/rust-v0.157.0...rust-v0.157.1'})});
 const result=await h.run(codex);assert.equal(result.status,'no-summary');assert.equal(result.compareUrl,'https://github.com/openai/codex/compare/rust-v0.157.0...rust-v0.157.1');
});
test('다른 태그, API 실패, 미지원 패키지를 릴리스 노트로 오인하지 않는다',async()=>{
 assert.equal((await harness({ok:true,json:async()=>({tag_name:'rust-v9.0.0',body:'Wrong version'})}).run(codex)).status,'unavailable');
 assert.equal((await harness({ok:false,status:403}).run(codex)).status,'unavailable');
 const h=harness({ok:true});assert.equal((await h.run({source:'npm',target:'unknown',version:'1.0.0'})).status,'unsupported');assert.equal(h.calls.length,0);
});
