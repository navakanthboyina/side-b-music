import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker, {aiFailureDiagnostic} from '../backend/worker.mjs';
import starter from '../backend/starter.mjs';

// Execute real SQLite SQL through the subset of the D1 binding used by the Worker.
function setup(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../backend/migrations/0001_community.sql',import.meta.url),'utf8'));
 const DB={prepare(sql){return {bind(...args){return {
  async first(){return sqlite.prepare(sql).get(...args)||null;},
  async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}
 };}};}};
 let aiCalls=0, catalogCalls=0;
 const env={DB,ALLOWED_ORIGIN:'https://music.example',ADMIN_TOKEN:'test-owner-secret',AI:{async run(){aiCalls++;return {response:JSON.stringify({ids:Array.from({length:12},(_,i)=>i+1)})};}},async CATALOG_FETCH(url){catalogCalls++;const artist=new URL(url).searchParams.get('term');return Response.json({results:Array.from({length:8},(_,i)=>({artistName:artist,trackName:'Fixture Song '+i,primaryGenreName:'Pop'}))});}};
 const call=(path,body,extra={})=>worker.fetch(new Request('https://backend.example'+path,{method:body===undefined?'GET':'POST',headers:{origin:env.ALLOWED_ORIGIN,'content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)}),env);
 const state=()=>call('/state').then(r=>r.json());
 const cooldown=()=>sqlite.exec('UPDATE community SET next_refresh=0');
 return {sqlite,env,call,state,cooldown,calls:()=>({aiCalls,catalogCalls})};
}
const fixture={artist:starter[0].name,title:starter[0].track};
test('Two visitors share song feedback, 12-song batches and no-repeat history',async()=>{
 const s=setup();const initial=await s.state();assert.equal(initial.batch,null);
 assert.equal((await s.call('/feedback',{...fixture,rating:'replay'})).status,200);
 const browserB=await s.state();assert.equal(Object.values(browserB.songRatings)[0].value,'replay');
 assert.equal((await s.call('/feedback',{...fixture,rating:'skip'})).status,200);
 assert.equal(Object.values((await s.state()).songRatings)[0].value,'skip');
 const first=await s.call('/refresh',{});assert.equal(first.status,200);const a=await first.json();assert.equal(a.batch.items.length,12);
 assert.deepEqual((await s.state()).batch,a.batch);
 assert.equal((await s.call('/refresh',{})).status,409);assert.equal(s.calls().aiCalls,1);
 s.cooldown();const second=await s.call('/refresh',{});assert.equal(second.status,200);const b=await second.json();
 const old=new Set(a.batch.items.map(t=>t.artist+'|'+t.title));assert(b.batch.items.every(t=>!old.has(t.artist+'|'+t.title)));
 s.sqlite.close();
});
test('Concurrent refresh is locked and concurrent feedback is not overwritten',async()=>{
 const s=setup();let finish,started;const ready=new Promise(r=>started=r);
 s.env.AI.run=()=>new Promise(r=>{finish=r;started();});
 const generation=s.call('/refresh',{});await ready;
 assert.equal((await s.call('/refresh',{})).status,409);
 assert.equal((await s.call('/feedback',{...fixture,rating:'known'})).status,200);
 finish({response:'{"ids":[1,2,3]}'});
 assert.equal((await generation).status,409);
 const state=await s.state();assert.equal(state.batch,null);assert.equal(Object.values(state.songRatings)[0].value,'known');assert.equal(state.refreshing,false);
 s.sqlite.close();
});
test('AI failure preserves batch and later refresh recovers',async()=>{
 const s=setup();await s.call('/refresh',{});const before=(await s.state()).batch;s.cooldown();
 s.env.AI.run=async()=>({response:'{"ids":[999]}'});
 assert.equal((await s.call('/refresh',{})).status,422);assert.deepEqual((await s.state()).batch,before);assert.equal((await s.state()).refreshing,false);
 s.cooldown();s.env.AI.run=async()=>({response:'{"ids":[1,2]}'});
 assert.equal((await s.call('/refresh',{})).status,200);s.sqlite.close();
});
test('Owner-only seed import, JSON/origin checks, unknown songs and public response privacy',async()=>{
 const s=setup();const songs=[{artist:'Private Fixture Artist',title:'Private Fixture Title'}];
 assert.equal((await s.call('/admin/seed',{songs})).status,401);
 assert.equal((await s.call('/admin/seed',{songs},{authorization:'Bearer test-owner-secret'})).status,200);
 const publicData=JSON.stringify(await s.state());assert(!publicData.includes('Private Fixture'));assert(!publicData.includes('seedArtists'));assert(!publicData.includes('test-owner-secret'));
 assert.equal((await s.call('/feedback',{...songs[0],rating:'replay'})).status,400);
 assert.equal((await s.call('/feedback',{...fixture,rating:'bad'})).status,400);
 assert.equal((await s.call('/refresh',{}, {origin:'https://evil.example'})).status,403);
 assert.equal((await s.call('/feedback',{...fixture,rating:'replay',extra:'x'.repeat(5000)})).status,413);
 assert.equal((await s.call('/refresh',{}, {'content-type':'text/plain'})).status,415);
 assert.equal((await s.call('/state',undefined,{origin:'https://evil.example'})).status,403);
 s.sqlite.close();
});
test('Feedback limits, daily generation cap and expired lease recovery',async()=>{
 const s=setup();for(let i=0;i<30;i++)assert.equal((await s.call('/feedback',{...fixture,rating:i%2?'skip':'replay'})).status,200);
 assert.equal((await s.call('/feedback',{...fixture,rating:'replay'})).status,429);
 s.sqlite.exec("UPDATE community SET lease='expired',lease_until=1");
 assert.equal((await s.call('/refresh',{})).status,200);
 const day=new Date().toISOString().slice(0,10);s.sqlite.prepare('UPDATE limits SET count=30 WHERE key=?').run('generation:'+day);s.cooldown();
 assert.equal((await s.call('/refresh',{})).status,429);assert.equal((await s.state()).refreshing,false);assert.equal(s.calls().aiCalls,1);
 s.sqlite.close();
});

test('Catalog search widens past exhausted artists',async()=>{
 const s=setup();let calls=0;
 s.env.CATALOG_FETCH=async url=>{
  calls++;assert.equal(new URL(url).searchParams.get('limit'),'100');
  const artist=new URL(url).searchParams.get('term');
  return Response.json({results:calls<=6?[]:Array.from({length:4},(_,i)=>({artistName:artist,trackName:'Fresh Fixture '+i}))});
 };
 const response=await s.call('/refresh',{});
 assert.equal(response.status,200);assert(calls>6);assert.equal(s.calls().aiCalls,1);
 s.sqlite.close();
});
test('Catalog outage is not reported as exhausted songs and never calls AI',async()=>{
 const s=setup();s.env.CATALOG_FETCH=async()=>new Response('Unavailable',{status:503});
 const response=await s.call('/refresh',{});
 assert.equal(response.status,503);assert.match((await response.json()).error,/catalog could not be reached/);
 assert.equal(s.calls().aiCalls,0);assert.equal((await s.state()).refreshing,false);
 s.sqlite.close();
});
test('Successful empty catalog remains distinct from an outage',async()=>{
 const s=setup();s.env.CATALOG_FETCH=async()=>Response.json({results:[]});
 assert.equal((await s.call('/refresh',{})).status,422);
 assert.equal(s.calls().aiCalls,0);s.sqlite.close();
});

test('Apple outage falls back to Deezer metadata and completes AI selection',async()=>{
 const s=setup();let fallbackCalls=0;
 s.env.CATALOG_FETCH=async url=>{
  url=new URL(url);
  if(url.hostname==='itunes.apple.com')return new Response('Unavailable',{status:403});
  assert.equal(url.hostname,'api.deezer.com');fallbackCalls++;
  const artist=url.searchParams.get('q').slice(8,-1);
  return Response.json({data:Array.from({length:4},(_,i)=>({artist:{name:artist},title:'Fallback Fixture '+i}))});
 };
 const response=await s.call('/refresh',{});
 assert.equal(response.status,200);assert(fallbackCalls>0);
 assert.equal((await response.json()).batch.items.length,12);assert.equal(s.calls().aiCalls,1);
 s.sqlite.close();
});
test('Both catalog failures expose safe provider status and preserve the batch',async()=>{
 const s=setup();await s.call('/refresh',{});const before=(await s.state()).batch;s.cooldown();
 s.env.CATALOG_FETCH=async url=>new Response('Private response body',{status:new URL(url).hostname==='itunes.apple.com'?403:429});
 const response=await s.call('/refresh',{});assert.equal(response.status,503);
 const message=(await response.json()).error;
 assert.match(message,/Apple HTTP 403/);assert.match(message,/Deezer HTTP 429/);assert(!message.includes('Private'));
 assert.deepEqual((await s.state()).batch,before);s.sqlite.close();
});

test('Successful empty Apple response still tries Deezer',async()=>{
 const s=setup();let fallback=0;
 s.env.CATALOG_FETCH=async input=>{
  const url=new URL(input);
  if(url.hostname==='itunes.apple.com')return Response.json({results:[]});
  fallback++;const artist=url.searchParams.get('q').slice(8,-1);
  return Response.json({data:Array.from({length:4},(_,i)=>({artist:{name:artist},title:'New Empty Fallback '+i}))});
 };
 const response=await s.call('/refresh',{});
 assert.equal(response.status,200);assert(fallback>0);assert.equal(s.calls().aiCalls,1);s.sqlite.close();
});
test('Fully excluded Apple results still try Deezer, keeping familiar songs excluded',async()=>{
 const s=setup();
 const seeds=starter.map(a=>({artist:a.name,title:'Familiar Fixture'}));
 await s.call('/admin/seed',{songs:seeds},{authorization:'Bearer test-owner-secret'});
 s.env.CATALOG_FETCH=async input=>{
  const url=new URL(input);
  if(url.hostname==='itunes.apple.com')return Response.json({results:[{artistName:url.searchParams.get('term'),trackName:'Familiar Fixture'}]});
  const artist=url.searchParams.get('q').slice(8,-1);
  return Response.json({data:[{artist:{name:artist},title:'Familiar Fixture'},...Array.from({length:4},(_,i)=>({artist:{name:artist},title:'Fresh Exclusion Fallback '+i}))]});
 };
 const response=await s.call('/refresh',{});assert.equal(response.status,200);
 assert((await response.json()).batch.items.every(t=>t.title!=='Familiar Fixture'));s.sqlite.close();
});
test('Empty results include aggregate counts without playlist content',async()=>{
 const s=setup();s.env.CATALOG_FETCH=async input=>Response.json(new URL(input).hostname==='itunes.apple.com'?{results:[]}:{data:[]});
 const response=await s.call('/refresh',{});assert.equal(response.status,422);
 const error=(await response.json()).error;assert.match(error,/"rows":0/);assert.match(error,/"differentArtistCredits":0/);
 assert(!error.includes(starter[0].name));s.sqlite.close();
});

test('Different catalog artist credits reach AI instead of all being rejected',async()=>{
 const s=setup();let search=0;
 s.env.CATALOG_FETCH=async()=>{
  search++;
  return Response.json({results:Array.from({length:4},(_,i)=>({artistName:'Guest Fixture '+search+' Featuring Ensemble',trackName:'Discovery '+i}))});
 };
 const response=await s.call('/refresh',{});assert.equal(response.status,200);
 const state=await response.json();assert.equal(state.batch.items.length,12);
 assert(state.batch.items.every(t=>t.artist.startsWith('Guest Fixture')));
 assert.equal(s.calls().aiCalls,1);s.sqlite.close();
});
test('Accepting different artist credits does not bypass familiar or rated exclusions',async()=>{
 const s=setup();
 const known={artist:'Different Catalog Credit',title:'Familiar Fixture'};
 await s.call('/admin/seed',{songs:[known]},{authorization:'Bearer test-owner-secret'});
 await s.call('/feedback',{...fixture,rating:'skip'});
 s.env.CATALOG_FETCH=async()=>Response.json({results:[
  {artistName:known.artist,trackName:known.title},
  {artistName:fixture.artist,trackName:fixture.title}
 ]});
 const response=await s.call('/refresh',{});assert.equal(response.status,422);
 assert.equal(s.calls().aiCalls,0);assert.equal((await s.state()).batch,null);s.sqlite.close();
});

test('AI diagnostics identify response shape and rejections without including the input profile',()=>{
 const diagnostic=aiFailureDiagnostic({response:'{"ids":[999]}',usage:{total_tokens:10},privateInput:'not for logging'},
   {diagnostics:{rejected:{invalidSelection:1},profile:'not for logging'}},20,1);
 assert.equal(diagnostic.model,'@cf/meta/llama-3.2-3b-instruct');
 assert.equal(diagnostic.attempt,2);assert.equal(diagnostic.candidateCount,20);
 assert.equal(diagnostic.reply,'{"ids":[999]}');assert.equal(diagnostic.rejected.invalidSelection,1);
 assert(!JSON.stringify(diagnostic).includes('not for logging'));
 assert.equal(aiFailureDiagnostic({response:'x'.repeat(5000)},{},1,0).reply.length,4000);
 assert.equal(aiFailureDiagnostic({result:{}},{},1,0).responseType,'undefined');
});
