import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker,{aiReplyText,aiFailureDiagnostic,budgetedCatalogFetch} from '../backend/worker.mjs';
import {songKey} from '../ai-core.mjs';
import {tasteAnchors,matchesArtist,credits,parseRelevantPicks} from '../backend/relevance.mjs';
import starter from '../backend/starter.mjs';
function selection(input){
 const p=JSON.parse(input.messages[1].content),counts=new Map();
 return {picks:p.candidates.flatMap(t=>{
  const count=counts.get(t.artist)||0;counts.set(t.artist,count+1);
  return count<2?[{id:t.id,score:85,reason:'A likely match for the gentle melodic phrasing of the reference song.'}]:[];
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
 const response=await s.call('/refresh',{});assert.equal(response.status,422);assert.match((await response.json()).error,/Found 0 of 12/);assert.equal(s.calls().aiCalls,0);s.sqlite.close();
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
  const p=JSON.parse(input.messages[1].content);assert(p.candidates.some(t=>t.reference.title.startsWith('Anchor Song')));
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
 assert.match(out[0].reason,/Real Reference/);assert.match(out[0].reason,/liked song/);assert.match(out[0].reason,/metadata-based estimate/);
 for(const change of [{id:99},{score:40}])assert.throws(()=>parseRelevantPicks(JSON.stringify({picks:[{...good,...change}]}),candidates,anchors));
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

test('A one-song first pass is expanded without duplicates or relaxing relevance',async()=>{
 const s=setup();let calls=0;
 s.env.AI.run=async(model,input)=>{
  calls++;const full=selection(input);
  if(calls===1)return {response:{picks:full.picks.slice(0,1)}};
  assert.match(input.messages.at(-1).content,/additional supported selections/);
  return {response:full};
 };
 const response=await s.call('/refresh',{});assert.equal(response.status,200);
 const batch=(await response.json()).batch;assert.equal(batch.items.length,12);assert.equal(calls,2);
 assert.equal(new Set(batch.items.map(songKey)).size,12);
 assert.deepEqual(batch.selectionStats.attempts.map(t=>t.accepted),[1,11]);s.sqlite.close();
});
test('An incomplete expansion preserves the previous complete batch',async()=>{
 const s=setup();await s.call('/refresh',{});const before=(await s.state()).batch;s.cooldown();let calls=0;
 s.env.AI.run=async(model,input)=>{if(++calls>1)throw Error('Provider unavailable');return {response:{picks:selection(input).picks.slice(0,1)}};};
 const response=await s.call('/refresh',{});assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.generationStatus,'pending');assert.equal(result.pendingSongCount,1);
 assert.deepEqual((await s.state()).batch,before);assert.equal((await s.state()).refreshing,false);s.sqlite.close();
});
test('Expansion cannot exceed per-artist cap or admit low-confidence selections',()=>{
 const anchors=[{id:1,artist:'Anchor Artist',title:'Anchor',source:'playlist song'}];
 const candidates=Array.from({length:4},(_,i)=>({artist:'Anchor Artist',title:'Song '+i,anchorIds:[1]}));
 const pick=id=>({id,anchorId:1,score:85,reason:'Likely similar gentle melody and relaxed acoustic phrasing.'});
 const first=parseRelevantPicks(JSON.stringify({picks:[pick(1)]}),candidates,anchors);
 const combined=parseRelevantPicks(JSON.stringify({picks:[pick(1),pick(2),pick(3),{...pick(4),score:50}]}),candidates,anchors,first);
 assert.equal(combined.length,2);assert.deepEqual(combined.map(t=>t.title),['Song 0','Song 1']);
});

test('Rejection counts distinguish wrong references, low scores, fields, and limits',()=>{
 const anchors=[{id:1,artist:'Reference',title:'Song',source:'playlist song'},{id:2,artist:'Other',title:'Other',source:'playlist song'}];
 const candidates=[{artist:'Performer',title:'A',anchorIds:[1]},{artist:'Performer',title:'B',anchorIds:[1]},{artist:'Performer',title:'C',anchorIds:[1]},{artist:'Performer',title:'No Reference',anchorIds:[99]}];
 const p={id:1,anchorId:1,score:80,reason:'Likely similar melodic phrasing and acoustic arrangement.'};
 const stats={};
 const result=parseRelevantPicks(JSON.stringify({picks:[null,{...p,id:99},{...p,id:4},{...p,score:120},{...p,score:50},p,p,{...p,id:2},{...p,id:3}]}),candidates,anchors,[],stats);
 assert.equal(result.length,2);assert.equal(stats.returned,9);assert.equal(stats.accepted,2);
 assert(Object.values(stats.rejected).every(n=>n===1));
 const malformed={};assert.throws(()=>parseRelevantPicks('not json',candidates,anchors,[],malformed));assert.equal(malformed.formatError,'invalid_json');
 const wrongShape={};assert.throws(()=>parseRelevantPicks('{"ids":[1]}',candidates,anchors,[],wrongShape));assert.equal(wrongShape.formatError,'missing_picks_array');
});

test('Each candidate embeds its own reference; AI does not join two ID lists',async()=>{
 const s=setup();
 s.env.AI.run=async(model,input)=>{
  const payload=JSON.parse(input.messages[1].content);
  assert.equal(payload.anchors,undefined);
  const uniqueReferences=new Set();
  for(const candidate of payload.candidates){
   assert.equal(candidate.anchorIds,undefined);assert(candidate.reference.title.startsWith('Anchor Song'));
   assert.equal(candidate.reference.artist,candidate.artist);uniqueReferences.add(candidate.reference.title);
  }
  assert(uniqueReferences.size>=6);
  return {response:selection(input)};
 };
 const response=await s.call('/refresh',{});assert.equal(response.status,200);
 const batch=(await response.json()).batch;assert.equal(batch.items.length,12);
 assert.equal(batch.selectionStats.attempts[0].rejected.invalidReference,0);
 for(const song of batch.items){const index=song.artist.replace('Fixture Artist ','');assert(song.reason.includes('Anchor Song '+index));}
 s.sqlite.close();
});
test('Assigned reference is authoritative; extra model fields cannot alter displayed descriptions',()=>{
 const anchors=[{id:5,artist:'First',title:'First reference',source:'playlist song'},{id:9,artist:'Second',title:'Second reference',source:'liked song'}];
 const candidates=[{artist:'Second',title:'Candidate',anchorIds:[9,5]}];
 const pick={id:1,score:90,reason:'Likely similar upbeat percussion and layered melodic phrasing.'};
 const result=parseRelevantPicks(JSON.stringify({picks:[pick]}),candidates,anchors);
 assert.match(result[0].reason,/Second reference/);assert(!result[0].reason.includes('First reference'));
 const extra=parseRelevantPicks(JSON.stringify({picks:[{...pick,anchorId:5,reason:'Invented claim about the wrong reference'}]}),candidates,anchors);
 assert.match(extra[0].reason,/Second reference/);assert(!extra[0].reason.includes('Invented claim'));assert(!extra[0].reason.includes('First reference'));
 assert.throws(()=>parseRelevantPicks(JSON.stringify({picks:[pick]}),[{...candidates[0],anchorIds:[99]}],anchors));
});

test('Repeated extraneous model anchor IDs no longer collapse a valid batch to one song',async()=>{
 const s=setup();
 s.env.AI.run=async(model,input)=>({response:{picks:selection(input).picks.map(p=>({...p,anchorId:1,reason:'Unsupported claim that must not be displayed'}))}});
 const response=await s.call('/refresh',{});assert.equal(response.status,200);
 const batch=(await response.json()).batch;assert.equal(batch.items.length,12);assert.equal(batch.selectionStats.build,'resumable-12-1');
 for(const t of batch.items){
  assert(t.reason.includes('Anchor Song '+t.artist.replace('Fixture Artist ','')));
  assert(!t.reason.includes('Unsupported claim'));
 }
 s.sqlite.close();
});

test('Six initial picks trigger a fresh pool with different sources and reach twelve',async()=>{
 const s=setup(),firstPoolKeys=new Set();let calls=0;
 s.env.AI.run=async(model,input)=>{
  calls++;const candidates=JSON.parse(input.messages[1].content).candidates;
  if(calls===1){candidates.forEach(t=>firstPoolKeys.add(t.artist+'|'+t.title));return {response:{picks:selection(input).picks.slice(0,6)}};}
  if(calls===2)return {response:{picks:[]}};
  assert(candidates.every(t=>!firstPoolKeys.has(t.artist+'|'+t.title)));
  return {response:selection(input)};
 };
 const response=await s.call('/refresh',{});assert.equal(response.status,200);
 const batch=(await response.json()).batch;assert.equal(batch.items.length,12);
 assert.equal(batch.selectionStats.pools.length,2);
 assert.deepEqual(batch.selectionStats.pools.map(p=>p.accepted),[6,6]);
 assert.equal(new Set(batch.items.map(songKey)).size,12);
 const counts={};for(const t of batch.items)counts[t.artist]=(counts[t.artist]||0)+1;
 assert(Object.values(counts).every(n=>n<=2));assert(batch.selectionStats.catalogRequests<=30);
 s.sqlite.close();
});
test('Exhausted provider requests stop within the shared budget and never invoke AI',async()=>{
 const s=setup();let requests=0;
 s.env.CATALOG_FETCH=async input=>{
  requests++;const u=new URL(input);
  if(u.hostname==='itunes.apple.com')return new Response('',{status:503});
  if(u.pathname==='/search/artist')return Response.json({data:[{name:u.searchParams.get('q'),id:1}]});
  return Response.json({data:[]});
 };
 const response=await s.call('/refresh',{});assert.equal(response.status,422);
 const error=await response.json();assert(requests<=30);assert.equal(error.selectionStats.catalogRequests,requests);
 assert(error.selectionStats.pools.length<=3);assert.equal(s.calls().aiCalls,0);assert.equal((await s.state()).batch,null);s.sqlite.close();
});

test('Catalog redirects use supported manual mode and each hop counts toward budget',async()=>{
 const stats={catalogRequests:0},seen=[];
 const request=budgetedCatalogFetch(async(url,options)=>{
  assert.equal(options.redirect,'manual');seen.push(url);
  if(seen.length===1)return new Response(null,{status:302,headers:{location:'/redirected-search'}});
  return Response.json({results:[]});
 },stats,Date.now()+10000);
 assert.equal((await request('https://itunes.apple.com/search')).status,200);
 assert.deepEqual(seen,['https://itunes.apple.com/search','https://itunes.apple.com/redirected-search']);assert.equal(stats.catalogRequests,2);
});
test('Redirect loops, foreign hosts and exhausted budgets stop without extra requests',async()=>{
 for(const location of ['https://unexpected.example/search','https://itunes.apple.com/loop']) {
  const stats={catalogRequests:0};
  const request=budgetedCatalogFetch(async()=>new Response(null,{status:301,headers:{location}}),stats,Date.now()+10000);
  await assert.rejects(request('https://itunes.apple.com/search'));
  assert(stats.catalogRequests<=3);
 }
 const stats={catalogRequests:29};let calls=0;
 const request=budgetedCatalogFetch(async()=>{calls++;return new Response(null,{status:302,headers:{location:'/again'}});},stats,Date.now()+10000);
 await assert.rejects(request('https://itunes.apple.com/search'),/budget/);
 assert.equal(calls,1);assert.equal(stats.catalogRequests,30);
});
test('A redirecting live-provider-shaped fixture generates twelve and provider errors remain visible',async()=>{
 const s=setup(),original=s.env.CATALOG_FETCH;
 s.env.CATALOG_FETCH=async(input,options)=>{
  assert.equal(options.redirect,'manual');const url=new URL(input);
  if(!url.searchParams.has('redirected')){url.searchParams.set('redirected','1');return new Response(null,{status:302,headers:{location:url.toString()}});}
  return original(input,options);
 };
 assert.equal((await s.call('/refresh',{})).status,200);assert.equal((await s.state()).batch.items.length,12);
 s.cooldown();s.env.CATALOG_FETCH=async()=>new Response('',{status:503});
 const result=await (await s.call('/refresh',{})).json();assert.match(result.error,/Catalog requests failed/);
 assert(result.selectionStats.pools.some(p=>p.detail.includes('HTTP 503')));s.sqlite.close();
});

test('Eight approved songs survive refresh and are completed with four new songs',async()=>{
 const s=setup();let calls=0;
 s.env.AI.run=async(model,input)=>({response:{picks:++calls===1?selection(input).picks.slice(0,8):[]}});
 const first=await s.call('/refresh',{});assert.equal(first.status,200);
 const partial=await first.json();assert.equal(partial.generationStatus,'pending');assert.equal(partial.pendingSongCount,8);assert.equal(partial.batch,null);
 const stored=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);
 const firstKeys=new Set(stored.pending.items.map(songKey));assert.equal(firstKeys.size,8);
 assert.equal(Object.keys(stored.shown).length,0);
 assert(!JSON.stringify(partial).includes(stored.pending.items[0].title));
 s.cooldown();s.env.AI.run=async(model,input)=>({response:selection(input)});
 const second=await s.call('/refresh',{});assert.equal(second.status,200);
 const complete=await second.json();assert.equal(complete.generationStatus,'saved');assert.equal(complete.batch.items.length,12);
 assert.equal(complete.batch.selectionStats.resumedCount,8);assert.equal(complete.pendingSongCount,0);
 assert.equal(complete.batch.items.filter(t=>firstKeys.has(songKey(t))).length,8);assert.equal(new Set(complete.batch.items.map(songKey)).size,12);
 s.sqlite.close();
});
test('Changing song feedback invalidates the pending taste draft',async()=>{
 const s=setup();let calls=0;s.env.AI.run=async(model,input)=>({response:{picks:++calls===1?selection(input).picks.slice(0,8):[]}});
 await s.call('/refresh',{});assert.equal((await s.state()).pendingSongCount,8);
 await s.call('/feedback',{...fixture,rating:'skip'});assert.equal((await s.state()).pendingSongCount,0);
 assert.equal(JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data).pending,null);s.sqlite.close();
});
