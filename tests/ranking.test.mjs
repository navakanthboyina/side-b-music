import {test} from 'node:test';
import assert from 'node:assert/strict';
import {songKey} from '../ai-core.mjs';
import {rankCandidates,selectDiverse,rerankBatch,variantKey,PRIMARY_MODEL} from '../backend/ranking.mjs';
const anchor={id:1,artist:'Seed Singer',title:'Seed Song',source:'liked song'};
const track=(n=1)=>{const t={artist:'Singer '+n,title:'Song '+n};return {...t,id:songKey(t),anchorIds:[1],evidence:{type:'similar_track',provider:'Last.fm',candidateId:songKey(t),reference:anchor,match:.8,languages:['Telugu'],url:'https://www.last.fm/music/Singer/_/Song'}};};
const state=()=>({seedSongs:[anchor],songRatings:{},shown:{}});
test('Ranks only supported candidates and respects language, ratings and recent history without AI',()=>{
 const s=state(),c=[track(1),track(2),track(3),track(4),track(5)];
 s.songRatings[songKey(c[0])]={...c[0],value:'skip'};s.shown[songKey(c[1])]=Date.now();c[2].evidence.languages=[];c[3].evidence.reference={artist:'Wrong',title:'Song'};
 const stats={},ranked=rankCandidates(c,[anchor],s,'Telugu',stats);
 assert.deepEqual(ranked.map(t=>t.title),['Song 5']);assert.deepEqual(stats.filtered,{invalidEvidence:1,blocked:1,recent:1,duplicate:0,language:1});
 assert.equal(ranked[0].aiSong,false);assert(!ranked[0].reason.includes('AI ranked'));
});
test('Canonical recording identity and mastering suffixes deduplicate; live versions are distinct',()=>{
 const a=track(),b={...track(2),evidence:{...track(2).evidence,recordingId:'11111111-1111-4111-8111-111111111111'}};a.evidence.recordingId=b.evidence.recordingId;
 assert.equal(rankCandidates([a,b],[anchor],state()).length,1);
 assert.equal(variantKey({artist:'Singer',title:'Song (2011 Remastered)'}),variantKey({artist:'Singer',title:'Song'}));
 assert.notEqual(variantKey({artist:'Singer',title:'Song (Live)'}),variantKey({artist:'Singer',title:'Song'}));
});
test('A recent alternate spelling with the same MBID cannot re-enter',()=>{
 const a=track();a.evidence.recordingId='11111111-1111-4111-8111-111111111111';const s=state();s.history=[{artist:'Alias',title:'Spelling',recordingId:a.evidence.recordingId,at:Date.now()}];
 assert.equal(rankCandidates([a],[anchor],s).length,0);
});
test('Gemma only reorders a complete permutation; hallucinated, partial, failed and quota replies retain taste ranking',async()=>{
 const picks=[track(1),track(2)];
 for(const raw of [{ids:[1,99]},{ids:[1]},{ids:[1,1]},'not json']){
  const stats={};const out=await rerankBatch(picks,{AI:{run:async()=>({response:typeof raw==='string'?raw:JSON.stringify(raw)})}},stats);
  assert.deepEqual(out.map(t=>t.title),picks.map(t=>t.title));assert.equal(stats.ai.mode,'deterministic');
 }
 for(const message of ['quota 3036','provider error']){
  const stats={};const out=await rerankBatch(picks,{AI:{run:async()=>{throw Error(message);}}},stats);
  assert.equal(out.length,2);assert(out.every(t=>!t.aiSong));assert(stats.ai.fallbackReason);
 }
 const stats={};const out=await rerankBatch(picks,{AI:{run:async(model,input)=>{assert.equal(model,PRIMARY_MODEL);assert(!input.messages[1].content.includes('api_key'));return {choices:[{message:{content:'{"ids":[2,1]}'}}]};}}},stats);
 assert.equal(out[0].title,'Song 2');assert(out[0].aiSong);assert.equal(stats.ai.mode,'ai-reranked');
});
test('AI timeout does not prevent a complete deterministic batch',async()=>{
 const picks=Array.from({length:12},(_,i)=>track(i));const stats={};const out=await rerankBatch(picks,{AI:{run:()=>new Promise(()=>{})}},stats,[],5);
 assert.equal(out.length,12);assert.equal(stats.ai.fallbackReason,'timeout');
});
test('Diversity caps reference and artist concentration',()=>{
 const rows=Array.from({length:12},(_,i)=>({...track(i),score:90,language:'Telugu'}));
 assert.equal(selectDiverse(rows).length,2);
});
test('Optional chain rejects invented Groq IDs, accepts Gemini IDs and keeps secrets out of diagnostics',async()=>{
 const picks=[track(1),track(2)],stats={},calls=[];
 const env={AI:{run:async()=>{throw Error('quota');}},EXTERNAL_AI_FREE_TIER_CONFIRMED:'true',GROQ_API_KEY:'groq-secret',GEMINI_API_KEY:'gemini-secret',RANKING_FETCH:async(url,options)=>{
  calls.push(url);const body=JSON.parse(options.body);assert.equal(options.redirect,'manual');assert(!options.body.includes('secret'));
  if(url.includes('groq.com')){assert.equal(options.headers.Authorization,'Bearer groq-secret');assert.equal(body.model,'openai/gpt-oss-120b');return Response.json({choices:[{message:{content:'{"ids":[1,99]}'}}]});}
  assert.equal(options.headers['x-goog-api-key'],'gemini-secret');return Response.json({candidates:[{content:{parts:[{text:'{"ids":[2,1]}'}]}}]});
 }};
 const out=await rerankBatch(picks,env,stats);assert.equal(out[0].title,'Song 2');assert.equal(stats.ai.provider,'Gemini');assert.match(out[0].reason,/Gemini/);
 assert.deepEqual(stats.ai.attempts.map(a=>a.outcome),['quota','invalid_response','selected']);assert.equal(calls.length,2);assert(!JSON.stringify(stats).includes('secret'));
});
test('Unconfirmed external accounts are never called; all configured failures still return deterministic songs',async()=>{
 const picks=[track(1),track(2)];let calls=0;
 const env={GROQ_API_KEY:'key',GEMINI_API_KEY:'key',AI:{run:async()=>{throw Error('quota');}},RANKING_FETCH:async()=>{calls++;return new Response('',{status:429});}};
 await rerankBatch(picks,env,{});assert.equal(calls,0);
 const stats={};const out=await rerankBatch(picks,{...env,EXTERNAL_AI_FREE_TIER_CONFIRMED:'true'},stats);
 assert.equal(calls,2);assert.deepEqual(out.map(t=>t.title),picks.map(t=>t.title));assert.equal(stats.ai.mode,'deterministic');assert.equal(stats.ai.attempts.length,3);
});
test('Groq success ends fallback immediately without calling Gemini',async()=>{
 const stats={},picks=[track(1),track(2)];let calls=0;
 const out=await rerankBatch(picks,{EXTERNAL_AI_FREE_TIER_CONFIRMED:'true',GROQ_API_KEY:'key',GEMINI_API_KEY:'key',RANKING_FETCH:async url=>{
  calls++;assert(url.includes('groq.com'));return Response.json({choices:[{message:{content:'{"ids":[2,1]}'}}]});
 }},stats);
 assert.equal(calls,1);assert.equal(out[0].title,'Song 2');assert.equal(stats.ai.provider,'Groq');
});
test('External redirects are rejected without forwarding provider credentials',async()=>{
 let calls=0;const stats={};
 const out=await rerankBatch([track(1),track(2)],{EXTERNAL_AI_FREE_TIER_CONFIRMED:'true',GROQ_API_KEY:'secret',RANKING_FETCH:async(url,options)=>{
  calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://wrong.example/'}});
 }},stats);
 assert.equal(calls,1);assert.equal(stats.ai.mode,'deterministic');assert.equal(out.length,2);
});
