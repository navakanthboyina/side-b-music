import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker,{aiReplyText,aiFailureDiagnostic} from '../backend/worker.mjs';
import {songKey} from '../ai-core.mjs';
import {tasteAnchors,matchesArtist,credits,parseRelevantPicks} from '../backend/relevance.mjs';
import starter from '../backend/starter.mjs';
function selection(input){
 const p=JSON.parse(input.messages[1].content),counts=new Map();
 return {picks:p.candidates.flatMap(t=>{
  const count=counts.get(t.artist)||0;counts.set(t.artist,count+1);
  return count<2?[{id:t.id,anchorId:t.anchorIds[0],score:85,reason:'A likely match for the gentle melodic phrasing of the reference song.'}]:[];
 }).slice(0,12)};
}
function setup(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../backend/migrations/0001_community.sql',import.meta.url),'utf8'));
 const DB={prepare(sql){return {bind(...args){return {
  async first(){return sqlite.prepare(sql).get(...args)||null;},
  async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}
 };}};}};
 const seedSongs=Array.from({length:16},(_,i)=>({artist:'Fixture Artist '+i,title:'Anchor Song '+i}));
 const row=sqlite.prepare('SELECT data FROM community WHERE id=1').get();const data=JSON.parse(row.data);data.seedSongs=seedSongs;data.familiar=Object.fromEntries(seedSongs.map(t=>[songKey(t),true]));sqlite.prepare('UPDATE community SET data=? WHERE id=1').run(JSON.stringify(data));
 let aiCalls=0, catalogCalls=0;
 const env={DB,ALLOWED_ORIGIN:'https://music.example',ADMIN_TOKEN:'test-owner-secret',AI:{async run(model,input){aiCalls++;return {response:selection(input)};}},async CATALOG_FETCH(url){catalogCalls++;const artist=new URL(url).searchParams.get('term');return Response.json({results:Array.from({length:8},(_,i)=>({artistName:artist,trackName:'Fixture Song '+i,primaryGenreName:'Pop'}))});}};
 const call=(path,body,extra={})=>worker.fetch(new Request('https://backend.example'+path,{method:body===undefined?'GET':'POST',headers:{origin:env.ALLOWED_ORIGIN,'content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)}),env);
 const state=()=>call('/state').then(r=>r.json());
 const cooldown=()=>sqlite.exec('UPDATE community SET next_refresh=0');
 return {sqlite,env,call,state,cooldown,calls:()=>({aiCalls,catalogCalls})};
}

const fixture={artist:starter[0].name,title:starter[0].track};
test('Shared batch, individual ratings, refresh cooldown and no repeats',async()=>{
 const s=setup();assert.equal((await s.call('/refresh',{})).status,200);const a=(await s.state()).batch;
 assert.equal(a.items.length,12);assert.equal(a.relevanceVersion,2);
 const song=a.items[0];await s.call('/feedback',{...song,rating:'replay'});
 assert.equal(Object.values((await s.state()).songRatings)[0].value,'replay');
 await s.call('/feedback',{...song,rating:'skip'});
 assert.equal(Object.values((await s.state()).songRatings)[0].value,'skip');
 assert.equal((await s.call('/refresh',{})).status,409);s.cooldown();
 assert.equal((await s.call('/refresh',{})).status,200);const b=(await s.state()).batch;
 const keys=new Set(a.items.map(songKey));assert(b.items.every(t=>!keys.has(songKey(t))));s.sqlite.close();
});
test('Catalog results unrelated to requested artist never reach AI',async()=>{
 const s=setup();s.env.CATALOG_FETCH=async url=>Response.json(new URL(url).hostname==='itunes.apple.com'?{results:[{artistName:'Unrelated Generic Artists',trackName:'Random Search Hit'}]}:{data:[]});
 const response=await s.call('/refresh',{});assert.equal(response.status,422);assert.match((await response.json()).error,/artistMismatch/);assert.equal(s.calls().aiCalls,0);s.sqlite.close();
});
test('Deezer fallback resolves exact artist ID before requesting tracks',async()=>{
 const s=setup();const names=new Map();let topCalls=0;
 s.env.CATALOG_FETCH=async input=>{
  assert.equal(typeof input,'string');const url=new URL(input);
  if(url.hostname==='itunes.apple.com')return new Response('',{status:403});
  if(url.pathname==='/search/artist'){
   const name=url.searchParams.get('q'),id=names.size+1;names.set(id,name);
   return Response.json({data:[{id:99999,name:'Unrelated Artist'},{id,name}]});
  }
  const id=Number(url.pathname.split('/')[2]);assert(names.has(id));topCalls++;
  return Response.json({data:Array.from({length:4},(_,i)=>({artist:{name:names.get(id)},title:'Fallback Song '+i}))});
 };
 assert.equal((await s.call('/refresh',{})).status,200);assert(topCalls>0);s.sqlite.close();
});
test('Only explicit credit matches allowed; punctuation variants work; generic credits ignored',()=>{
 assert(matchesArtist('A. B. Singer & Guest','A B Singer'));
 assert(matchesArtist('Main Singer feat. Guest Singer','Guest Singer'));
 assert(!matchesArtist('Not The Singer','Singer'));
 assert.deepEqual(credits('Various Artists'),[]);
});
test('Liked songs lead taste; skipped and known songs do not become positive anchors',()=>{
 const liked={artist:'Loved Artist',title:'Liked Song',value:'replay',at:3};
 const skipped={artist:'Same Artist',title:'Skipped Song',value:'skip',at:2};
 const other={artist:'Same Artist',title:'Other Song'};
 const anchors=tasteAnchors({rotation:0,seedSongs:[skipped,other],songRatings:{[songKey(liked)]:liked,[songKey(skipped)]:skipped}});
 assert.equal(anchors[0].title,'Liked Song');assert.equal(anchors[0].source,'liked song');
 assert(!anchors.some(t=>t.title==='Skipped Song'));assert(anchors.some(t=>t.title==='Other Song'));
});
test('Prompt carries representative song taste and individual negative feedback',async()=>{
 const s=setup();await s.call('/feedback',{...fixture,rating:'skip'});
 s.env.AI.run=async(model,input)=>{
  const p=JSON.parse(input.messages[1].content);assert(p.anchors.some(t=>t.title.startsWith('Anchor Song')));
  assert(p.feedback.some(t=>t.title===fixture.title&&t.rating==='skip'));
  return {response:selection(input)};
 };
 assert.equal((await s.call('/refresh',{})).status,200);s.sqlite.close();
});
test('Descriptions cite validated source and mark similarity as estimate; weak or invented references rejected',()=>{
 const anchors=[{id:1,artist:'Anchor Artist',title:'Real Reference',source:'liked song'}];
 const candidates=[{artist:'Anchor Artist',title:'New Track',anchorIds:[1]}];
 const good={id:1,anchorId:1,score:80,reason:'Likely similar gentle phrasing and acoustic arrangements.'};
 const out=parseRelevantPicks(JSON.stringify({picks:[good]}),candidates,anchors);
 assert.match(out[0].reason,/Real Reference/);assert.match(out[0].reason,/liked song/);assert.match(out[0].reason,/AI-estimated fit/);
 for(const change of [{anchorId:99},{id:99},{score:40},{reason:''}])assert.throws(()=>parseRelevantPicks(JSON.stringify({picks:[{...good,...change}]}),candidates,anchors));
 assert.throws(()=>parseRelevantPicks('{"ids":[1]}',candidates,anchors));
});
test('Low-confidence model response preserves current batch and releases lease',async()=>{
 const s=setup();await s.call('/refresh',{});const before=(await s.state()).batch;s.cooldown();
 s.env.AI.run=async()=>({response:{picks:[]}});assert.equal((await s.call('/refresh',{})).status,422);
 assert.deepEqual((await s.state()).batch,before);assert.equal((await s.state()).refreshing,false);s.sqlite.close();
});
test('Concurrent feedback prevents stale AI overwrite',async()=>{
 const s=setup();let finish,start;const ready=new Promise(r=>start=r);
 s.env.AI.run=async(model,input)=>new Promise(r=>{finish=()=>r({response:selection(input)});start();});
 const pending=s.call('/refresh',{});await ready;assert.equal((await s.call('/refresh',{})).status,409);
 await s.call('/feedback',{...fixture,rating:'known'});finish();assert.equal((await pending).status,409);
 assert.equal((await s.state()).batch,null);s.sqlite.close();
});
test('Owner import retains song-level taste privately; old batch hidden; migration needs re-import',async()=>{
 const s=setup();const row=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);delete row.seedSongs;row.batch={items:[{artist:'Legacy',title:'Unrelated'}]};
 s.sqlite.prepare('UPDATE community SET data=?').run(JSON.stringify(row));
 assert.equal((await s.state()).needsTasteImport,true);assert.equal((await s.state()).batch,null);
 assert.equal((await s.call('/refresh',{})).status,409);
 const songs=[{artist:'Private Example',title:'Private Title'}];assert.equal((await s.call('/admin/seed',{songs})).status,401);
 assert.equal((await s.call('/admin/seed',{songs},{authorization:'Bearer test-owner-secret'})).status,200);
 const state=await s.state();assert.equal(state.needsTasteImport,false);assert(!JSON.stringify(state).includes('Private Title'));
 const data=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);assert.deepEqual(data.seedSongs,songs);s.sqlite.close();
});
test('Origin, unknown song and daily cap gates remain enforced',async()=>{
 const s=setup();assert.equal((await s.call('/refresh',{}, {origin:'https://evil.example'})).status,403);
 assert.equal((await s.call('/feedback',{artist:'Unknown',title:'Unknown',rating:'replay'})).status,400);
 await s.call('/refresh',{});s.cooldown();const day=new Date().toISOString().slice(0,10);
 s.sqlite.prepare('UPDATE limits SET count=30 WHERE key=?').run('generation:'+day);
 assert.equal((await s.call('/refresh',{})).status,429);s.sqlite.close();
});
test('Cloudflare object/text envelopes normalize; diagnostics do not log generated taste references',()=>{
 assert.equal(aiReplyText({response:{picks:[]}}),'{"picks":[]}');
 assert.equal(aiReplyText({choices:[{message:{content:'{"picks":[]}'}}]}),'{"picks":[]}');
 const d=aiFailureDiagnostic({response:'private generated reference'},{},12,0);
 assert(!JSON.stringify(d).includes('private generated reference'));assert(d.replyLength>0);
});
