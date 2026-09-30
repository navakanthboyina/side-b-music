import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker,{aiReplyText,aiFailureDiagnostic,budgetedCatalogFetch,inferenceFailure} from '../backend/worker.mjs';
import {songKey} from '../ai-core.mjs';
import {tasteAnchors,matchesArtist,credits,parseRelevantPicks,selectionFormat} from '../backend/relevance.mjs';
import starter from '../backend/starter.mjs';
function selection(input){
 const p=JSON.parse(input.messages[1].content),counts=new Map();
 return {picks:p.candidates.flatMap(t=>{
  const count=counts.get(t.artist)||0;counts.set(t.artist,count+1);
  return count<2?[{id:t.id,score:85,reason:'A likely match for the gentle melodic phrasing of the reference song.'}]:[];
 }).slice(0,12)};
}
function fixtureCatalog(input){
 const u=new URL(input);
 if(u.hostname==='itunes.apple.com')return Response.json({results:[]});
 if(u.pathname==='/search'){
  const q=u.searchParams.get('q'),n=Number(q.match(/Fixture Artist (\d+)/)?.[1]);
  if(!q.includes('Fixture Artist'))return Response.json({data:[]});
  const title=q.slice(('Fixture Artist '+n+' ').length),songIndex=title.match(/Fixture Song (\d+)/)?.[1];
  return Response.json({data:[{id:n*100+1+(songIndex===undefined?0:Number(songIndex)+1),artist:{name:'Fixture Artist '+n},title,album:{id:n+1}}]});
 }
 if(u.pathname.startsWith('/album/')){
  const n=Number(u.pathname.split('/')[2])-1,artist={name:'Fixture Artist '+n};
  return Response.json({id:n+1,title:'Fixture Release '+n,record_type:'album',release_date:'2020-01-01',genres:{data:[{name:'Pop'}]},tracks:{data:[{id:n*100+1,artist,title:'Anchor Song '+n},...Array.from({length:8},(_,i)=>({id:n*100+i+2,artist,title:'Fixture Song '+i}))]}});
 }
 throw Error('Unexpected fixture URL');
}
function setup(){
 const sqlite=new DatabaseSync(':memory:');for(const name of fs.readdirSync(new URL('../backend/migrations/',import.meta.url)).sort())sqlite.exec(fs.readFileSync(new URL('../backend/migrations/'+name,import.meta.url),'utf8'));
 const DB={prepare(sql){return {bind(...args){return {
  async first(){return sqlite.prepare(sql).get(...args)||null;},
  async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}
 };}};}};
 const seedSongs=Array.from({length:16},(_,i)=>({artist:'Fixture Artist '+i,title:'Anchor Song '+i}));
 const row=sqlite.prepare('SELECT data FROM community WHERE id=1').get();const data=JSON.parse(row.data);data.seedSongs=seedSongs;data.familiar=Object.fromEntries(seedSongs.map(t=>[songKey(t),true]));sqlite.prepare('UPDATE community SET data=? WHERE id=1').run(JSON.stringify(data));
 let aiCalls=0, catalogCalls=0;
 const env={DB,LISTENBRAINZ_ENABLED:'false',ALLOWED_ORIGIN:'https://music.example',ADMIN_TOKEN:'test-owner-secret',AI:{async run(model,input){aiCalls++;return {response:selection(input)};}},async CATALOG_FETCH(input){catalogCalls++;return fixtureCatalog(input);}};
 let ranker=env.AI.run;
 const wrap=fn=>async(model,input)=>{const p=JSON.parse(input.messages[1]?.content||'{}');if(p.task==='language_references')return {response:{picks:p.candidates.map(t=>({id:t.id,language:p.preference.split(' + ')[0]}))}};return fn(model,input);};
 ranker=wrap(ranker);Object.defineProperty(env.AI,'run',{get:()=>ranker,set:fn=>{ranker=wrap(fn);}});
 const call=(path,body,extra={})=>worker.fetch(new Request('https://backend.example'+path,{method:body===undefined?'GET':'POST',headers:{origin:env.ALLOWED_ORIGIN,'content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)}),env);
 const state=()=>call('/state').then(r=>r.json());
 const cooldown=()=>sqlite.exec('UPDATE community SET next_refresh=0');
 return {sqlite,env,call,state,cooldown,calls:()=>({aiCalls,catalogCalls})};
}

const fixture={artist:starter[0].name,title:starter[0].track};
test('Shared batch, individual ratings, refresh cooldown and rated exclusions',async()=>{
 const s=setup();assert.equal((await s.call('/refresh',{})).status,200);const a=(await s.state()).batch;
 assert.equal(a.items.length,12);assert.equal(a.relevanceVersion,2);
 const song=a.items[0];await s.call('/feedback',{...song,rating:'replay'});
 assert.equal(Object.values((await s.state()).songRatings)[0].value,'replay');
 await s.call('/feedback',{...song,rating:'skip'});
 assert.equal(Object.values((await s.state()).songRatings)[0].value,'skip');
 assert.equal((await s.call('/refresh',{})).status,409);s.cooldown();
 assert.equal((await s.call('/refresh',{})).status,200);const b=(await s.state()).batch;
 assert(b.items.every(t=>songKey(t)!==songKey(song)));s.sqlite.close();
});
test('Catalog results unrelated to requested artist never reach AI',async()=>{
 const s=setup();s.env.CATALOG_FETCH=async url=>Response.json(new URL(url).hostname==='itunes.apple.com'?{results:[{artistName:'Unrelated Generic Artists',trackName:'Random Search Hit'}]}:{data:[]});
 const response=await s.call('/refresh',{});assert.equal(response.status,422);assert.match((await response.json()).error,/Found 0 of 12/);assert.equal(s.calls().aiCalls,0);s.sqlite.close();
});
test('Deezer resolves exact reference track then verifies album membership',async()=>{
 const s=setup();let albumCalls=0;const original=s.env.CATALOG_FETCH;
 s.env.CATALOG_FETCH=async input=>{if(new URL(input).pathname.startsWith('/album/'))albumCalls++;return original(input);};
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.items.length,12);assert(albumCalls>0);assert(r.batch.items.every(t=>t.reason.includes('Fixture Release')));s.sqlite.close();
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
 await s.call('/feedback',{...fixture,rating:'known'});s.env.AI.run=async(model,input)=>({response:selection(input)});finish();assert.equal((await pending).status,409);
 assert.equal((await s.state()).batch,null);s.sqlite.close();
});
test('Owner import keeps full seed list private while exposing selected comfort songs',async()=>{
 const s=setup();const row=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);delete row.seedSongs;row.batch={items:[{artist:'Legacy',title:'Unrelated'}]};
 s.sqlite.prepare('UPDATE community SET data=?').run(JSON.stringify(row));
 assert.equal((await s.state()).needsTasteImport,true);assert.equal((await s.state()).batch,null);
 assert.equal((await s.call('/refresh',{})).status,409);
 const songs=[{artist:'Private Example',title:'Private Title'}];assert.equal((await s.call('/admin/seed',{songs})).status,401);
 assert.equal((await s.call('/admin/seed',{songs},{authorization:'Bearer test-owner-secret'})).status,200);
 const state=await s.state();assert.equal(state.needsTasteImport,false);assert.equal(state.seedSongs,undefined);assert.deepEqual(state.comfortSongs,songs);
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
  if(calls===2)assert.match(input.messages.at(-1).content,/additional supported selections/);
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
 assert(Object.entries(stats.rejected).filter(([key])=>!['releaseLimit','referenceLimit','languageFilter','missingLanguage'].includes(key)).every(([,n])=>n===1));
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
 const batch=(await response.json()).batch;assert.equal(batch.items.length,12);assert.equal(batch.selectionStats.build,'provider-resilience-1');
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
 s.cooldown();s.sqlite.exec("UPDATE community SET data=json_remove(data,'$.catalogCache')");s.env.CATALOG_FETCH=async()=>new Response('',{status:503});
 const result=await (await s.call('/refresh',{})).json();assert.match(result.error,/Catalog requests failed/);
 assert(result.selectionStats.pools.some(p=>p.detail.includes('HTTP 503')));s.sqlite.close();
});

test('Eight approved songs survive refresh and are completed with four new songs',async()=>{
 const s=setup();let calls=0;
 s.env.AI.run=async(model,input)=>({response:{picks:++calls===1?selection(input).picks.slice(0,8):[]}});
 const first=await s.call('/refresh',{});assert.equal(first.status,200);
 const partial=await first.json();assert.equal(partial.generationStatus,'pending');assert.equal(partial.pendingSongCount,8);assert.equal(partial.batch,null);
 const stored=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);
 stored.pending.selectionStats.build='language-discovery-1';s.sqlite.prepare('UPDATE community SET data=? WHERE id=1').run(JSON.stringify(stored));
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

test('Search verifies catalog IDs; adding shares an individual like and invalidates draft',async()=>{
 const s=setup(),song={kind:'song',trackId:42,artistName:'Search Fixture',trackName:'Search Song'};
 s.env.CATALOG_FETCH=async()=>Response.json({results:[song]});
 const search=await s.call('/search',{query:'Search Song'});assert.equal(search.status,200);
 const found=(await search.json()).songs[0];assert.deepEqual(found,{provider:'apple',id:42,artist:'Search Fixture',title:'Search Song'});
 const row=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);row.pending={at:Date.now(),items:[{artist:'Draft',title:'Old'}]};s.sqlite.prepare('UPDATE community SET data=?').run(JSON.stringify(row));
 assert.equal((await s.call('/taste/add',{provider:'apple',id:42,artist:'Forged Artist',title:'Forged Title'})).status,200);
 const shared=await s.state();assert.equal(shared.pendingSongCount,0);
 assert.equal(shared.songRatings[songKey(found)].value,'replay');assert.equal(shared.songRatings[songKey(found)].artist,'Search Fixture');
 const state=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);assert.equal(tasteAnchors(state)[0].title,'Search Song');
 assert.equal((await s.call('/taste/add',{provider:'apple',id:99})).status,503);
 assert.equal((await s.call('/taste/add',{provider:'arbitrary',id:42})).status,400);
 assert.equal((await s.call('/search',{query:'x'})).status,400);
 assert.equal((await s.call('/search',{query:'Song'},{origin:'https://wrong.example'})).status,403);
 await s.call('/feedback',{...found,rating:'clear'});assert.equal((await s.state()).songRatings[songKey(found)],undefined);
 s.sqlite.close();
});
test('Search falls back to Deezer, omits malformed tracks, and distinguishes outages from no matches',async()=>{
 const s=setup();s.env.CATALOG_FETCH=async url=>new URL(url).hostname==='itunes.apple.com'?new Response('',{status:503}):Response.json({data:[{id:5,artist:{name:'Fallback Artist'},title:'Fallback Song'},{id:6,title:'Invalid'}]});
 const result=await (await s.call('/search',{query:'Fallback'})).json();assert.equal(result.songs.length,1);assert.equal(result.songs[0].provider,'deezer');
 s.env.CATALOG_FETCH=async()=>new Response('',{status:503});assert.equal((await s.call('/search',{query:'Song'})).status,503);
 s.env.CATALOG_FETCH=async()=>Response.json({results:[],data:[]});assert.equal((await s.call('/search',{query:'Still paused'})).status,503);s.sqlite.exec("UPDATE limits SET expires=0 WHERE key LIKE 'provider-cooldown:%'");assert.deepEqual((await (await s.call('/search',{query:'Nothing'})).json()).songs,[]);s.sqlite.close();
});

test('Four-candidate schema cannot request fabricated IDs or 24 picks',()=>{
 const f=selectionFormat(4);assert.equal(f.type,'json_schema');
 assert.deepEqual(f.json_schema.properties.picks.items.properties.id.enum,[1,2,3,4]);
 assert.equal(f.json_schema.properties.picks.maxItems,4);
 assert.deepEqual(f.json_schema.required,['picks']);assert.throws(()=>selectionFormat(0));
});
test('Malformed first plain reply retries and completes twelve',async()=>{
 const s=setup();let calls=0;
 s.env.AI.run=async(model,input)=>{
  assert.equal(model,'@cf/google/gemma-4-26b-a4b-it');
  const candidates=JSON.parse(input.messages[1].content).candidates;
  assert.equal(input.response_format,undefined);
  if(++calls===1)return {response:'{"picks":['};
  return {response:selection(input)};
 };
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.items.length,12);
 assert.equal(r.batch.selectionStats.attempts[0].formatError,'invalid_json');
 assert.equal(r.batch.selectionStats.attempts[1].accepted,12);s.sqlite.close();
});
test('Structured inference failure retries before abandoning eligible pool',async()=>{
 const s=setup();let calls=0;s.env.AI.run=async(model,input)=>{if(++calls===1)throw Error("JSON Mode couldn't be met");return {response:selection(input)};};
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.items.length,12);assert.equal(calls,2);s.sqlite.close();
});
test('Prose-wrapped complete JSON can be read, truncated JSON and invented IDs cannot be accepted',()=>{
 const a=[{id:1,artist:'Fixture',title:'Reference',source:'liked song'}],c=[{artist:'Fixture',title:'Candidate',anchorIds:[1]}];
 assert.equal(parseRelevantPicks('Here is the result:\n{"picks":[{"id":1,"score":85}]}\nDone.',c,a).length,1);
 assert.throws(()=>parseRelevantPicks('{"picks":[{"id":1,"score":85}',c,a));
 const stats={};assert.throws(()=>parseRelevantPicks(JSON.stringify({picks:Array.from({length:20},(_,i)=>({id:i+5,score:99}))}),c,a,[],stats));assert.equal(stats.rejected.invalidId,20);
});
test('An older draft above the reduced target commits only twelve and performs no new AI calls',async()=>{
 const s=setup(),row=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);
 row.pending={selectionStats:{build:'comfort-replay-1'},at:Date.now(),items:Array.from({length:16},(_,i)=>({artist:'Artist '+i,title:'Approved '+i,reason:'Previously approved',aiSong:true}))};
 s.sqlite.prepare('UPDATE community SET data=?').run(JSON.stringify(row));
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.items.length,12);assert.equal(r.pendingSongCount,0);assert.equal(s.calls().aiCalls,0);s.sqlite.close();
});

test('Provider failures expose safe categories, never raw prompts or secrets',()=>{
 assert.equal(inferenceFailure(Error('Quota exceeded secret song title')).category,'quota');
 assert.equal(inferenceFailure(Error('Failed to initialize grammar matcher')).category,'response_format');
 assert(!JSON.stringify(inferenceFailure(Error('secret song title'))).includes('secret'));
 assert.equal(inferenceFailure(Error('AI timed out')).category,'timeout');
});
test('Provider format exception retries without schema while retaining validation',async()=>{
 const s=setup();let calls=0;
 s.env.AI.run=async(model,input)=>{if(++calls===1){assert.equal(input.response_format,undefined);throw Error('Failed to initialize grammar matcher');}assert.equal(input.response_format,undefined);return {response:selection(input)};};
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.items.length,12);assert.equal(calls,2);assert.equal(r.batch.selectionStats.attempts[0].inference.category,'response_format');s.sqlite.close();
});
test('Quota stops further AI/catalog work and reports quota instead of no matches',async()=>{
 const s=setup();let calls=0;s.env.AI.run=async()=>{calls++;throw Error('Daily neurons quota exceeded');};
 const response=await s.call('/refresh',{});assert.equal(response.status,503);const r=await response.json();assert.match(r.error,/allowance/);assert.equal(calls,1);assert.equal(r.selectionStats.pools.length,1);assert.equal((await s.state()).refreshing,false);s.sqlite.close();
});
test('All inference failures report service failure, not no matching taste',async()=>{
 const s=setup();s.env.AI.run=async()=>{throw Error('unclassified provider failure');};
 const response=await s.call('/refresh',{});assert.equal(response.status,503);const r=await response.json();assert.match(r.error,/No AI selections were returned/);assert.equal(r.selectionStats.attempts[0].inference.category,'provider_error');s.sqlite.close();
});

test('Leading Cloudflare codes and string errors are classified',()=>{
 assert.equal(inferenceFailure(Error('5035: model requires Workers Paid plan')).category,'access');
 assert.equal(inferenceFailure('3036: allocation exhausted').category,'quota');
 assert.equal(inferenceFailure(Error('5007: No such model')).code,5007);
});
test('Unknown failure gets one plain retry with song validation',async()=>{
 const s=setup();let calls=0;s.env.AI.run=async(model,input)=>{if(++calls===1)throw Error('unclassified provider error');assert.equal(input.response_format,undefined);return {response:selection(input)};};
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.items.length,12);assert.equal(calls,2);s.sqlite.close();
});
test('Owner probe needs authentication, uses no taste data, reports original synthetic errors',async()=>{
 const s=setup();assert.equal((await s.call('/admin/ai-check',{})).status,401);
 let calls=0;s.env.AI.run=async(model,input)=>{calls++;assert(!JSON.stringify(input).includes('Anchor Song'));if(input.response_format)throw Error('fixture upstream failure');return {response:{picks:[{id:1,score:80}]}};};
 const r=await (await s.call('/admin/ai-check',{}, {authorization:'Bearer test-owner-secret'})).json();assert.equal(calls,2);assert.equal(r.checks[0].ok,true);assert.equal(r.checks[1].message,'fixture upstream failure');assert.equal((await s.state()).batch,null);
 assert.equal((await s.call('/admin/ai-check',{}, {authorization:'Bearer test-owner-secret'})).status,429);s.sqlite.close();
});

test('Reported 5028 deprecation stops immediately with an actionable message',async()=>{
 const s=setup();let calls=0;
 s.env.AI.run=async()=>{calls++;throw Error('5028: @cf/meta/infire-llama-3.1-8b-instruct was deprecated on 2026-05-30.');};
 const response=await s.call('/refresh',{});assert.equal(response.status,503);const r=await response.json();assert.equal(r.selectionStats.attempts[0].inference.code,5028);assert.match(r.error,/retired/);assert.equal(calls,1);s.sqlite.close();
});

test('Generation starts in the live-working plain mode and asks for all pool scores',async()=>{
 const s=setup();let calls=0;s.env.AI.run=async(model,input)=>{
  calls++;assert.equal(input.response_format,undefined);
  assert.match(input.messages[0].content,/Score EVERY candidate/);
  assert.match(input.messages[2].content,/Score all 24 candidates/);
  const p=selection(input);if(calls===1)return {response:{picks:p.picks.slice(0,1)}};
  assert.match(input.messages.at(-1).content,/every remaining ID/);return {response:p};
 };
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.items.length,12);assert.equal(calls,2);assert.equal(r.batch.selectionStats.attempts[0].structured,false);s.sqlite.close();
});
test('Failing catalog host is paused without blocking the other catalog or spending requests',async()=>{
 let calls=0;const stats={catalogRequests:0};const get=budgetedCatalogFetch(async url=>{calls++;return new URL(url).hostname==='itunes.apple.com'?new Response('',{status:503}):Response.json({data:[]});},stats,Date.now()+60000);
 for(let i=0;i<3;i++)await get('https://itunes.apple.com/search?term=fixture');
 await assert.rejects(get('https://itunes.apple.com/search?term=another'),/provider paused/);assert.equal(calls,3);
 assert.equal((await get('https://api.deezer.com/search/artist?q=fixture')).status,200);assert.equal(stats.catalogRequests,4);
});

test('Catalog evidence remains eligible when AI priority scores are low',async()=>{
 const s=setup();let calls=0;s.env.AI.run=async(model,input)=>{calls++;const p=JSON.parse(input.messages[1].content);return {response:{picks:p.candidates.map(t=>({id:t.id,score:40}))}};};
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.items.length,12);assert.equal(calls,1);assert(r.batch.items.every(t=>t.reason.includes('AI-ranked from catalog evidence')));s.sqlite.close();
});
test('Diagnostics expose actual numeric scores without changing their scale or accepting weak songs',()=>{
 const anchors=[{id:1,artist:'Fixture',title:'Reference',source:'liked song'}],candidates=[{artist:'Fixture',title:'Candidate',anchorIds:[1]}],stats={};
 assert.throws(()=>parseRelevantPicks('{"picks":[{"id":1,"score":0.8}]}',candidates,anchors,[],stats));
 assert.deepEqual(stats.scoreDistribution,{'0.8':1});assert.equal(stats.rejected.lowScore,1);assert.deepEqual(stats.scoredIds,[1]);
});

test('Catalog-owned same-release connection admits other performers, excludes rated songs and describes evidence honestly',async()=>{
 const s=setup(),original=s.env.CATALOG_FETCH;
 s.env.CATALOG_FETCH=async input=>{
  const response=await original(input),data=await response.json();
  if(new URL(input).pathname.startsWith('/album/'))data.tracks.data.slice(1).forEach((t,i)=>{t.artist.name='Guest Performer '+i;t.title+=' Release '+data.id;});
  return Response.json(data);
 };
 s.env.AI.run=async(model,input)=>({response:{picks:JSON.parse(input.messages[1].content).candidates.map(t=>({id:t.id,score:0}))}});
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.items.length,12);assert(r.batch.items.every(t=>t.artist.startsWith('Guest Performer')));
 assert(r.batch.items.every(t=>t.reason.includes('appear on')&&t.reason.includes('not a guarantee')));
 assert(r.batch.items.every(t=>!t.reason.includes('share an artist credit')&&!t.reason.includes('energetic')));s.sqlite.close();
});
test('Same artist alone or wrong reference album membership cannot become evidence',async()=>{
 for(const mode of ['wrong-title','missing-reference','compilation']){
  const s=setup(),original=s.env.CATALOG_FETCH;
  s.env.CATALOG_FETCH=async input=>{const data=await (await original(input)).json();const path=new URL(input).pathname;
   if(path==='/search'&&mode==='wrong-title')data.data.forEach(t=>t.title='Unrelated Title');
   if(path.startsWith('/album/')){if(mode==='missing-reference')data.tracks.data.shift();if(mode==='compilation')data.record_type='compile';}
   return Response.json(data);
  };
  await s.call('/refresh',{});assert.equal(s.calls().aiCalls,0);assert.equal((await s.state()).batch,null);s.sqlite.close();
 }
});
test('Previous scoring draft is not mixed into a new evidence-based batch',async()=>{
 const s=setup(),data=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);
 data.pending={at:Date.now(),selectionStats:{build:'score-coverage-12-1'},items:[{artist:'Legacy',title:'Unsupported draft'}]};s.sqlite.prepare('UPDATE community SET data=?').run(JSON.stringify(data));
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.selectionStats.resumedCount,0);assert(!JSON.stringify(r.batch).includes('Unsupported draft'));s.sqlite.close();
});

test('Apple fallback verifies both tracks against a specific collection ID',async()=>{
 const s=setup();s.env.CATALOG_FETCH=async input=>{
  const u=new URL(input);if(u.hostname==='api.deezer.com')return new Response('',{status:503});
  if(u.pathname==='/search'){
   const q=u.searchParams.get('term'),n=Number(q.match(/Fixture Artist (\d+)/)?.[1]);
   return Response.json({results:[{artistName:'Fixture Artist '+n,trackName:'Anchor Song '+n,trackId:n*100+1,collectionId:n+1}]});
  }
  const n=Number(u.searchParams.get('id'))-1;
  return Response.json({results:[{artistName:'Fixture Artist '+n,trackName:'Anchor Song '+n,trackId:n*100+1,collectionId:n+1,collectionName:'Verified Release '+n,primaryGenreName:'Soundtrack'},...Array.from({length:4},(_,i)=>({artistName:'Fixture Artist '+n,trackName:'New Apple Song '+i,trackId:n*100+i+2,collectionId:n+1}))]});
 };
 const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.items.length,12);assert(r.batch.items.every(t=>t.reason.includes('in Apple')&&t.reason.includes('Verified Release')));s.sqlite.close();
});
test('Repeated album requests share catalog response safely',async()=>{
 const {memoizedCatalogFetch}=await import('../backend/evidence.mjs');let calls=0;
 const get=memoizedCatalogFetch(async()=>{calls++;return Response.json({tracks:[1,2]});});
 const responses=await Promise.all([get('https://api.deezer.com/album/1'),get('https://api.deezer.com/album/1')]);
 assert.deepEqual(await responses[0].json(),{tracks:[1,2]});assert.deepEqual(await responses[1].json(),{tracks:[1,2]});assert.equal(calls,1);
});

test('Release cap holds across artists, reference songs, providers and separate AI passes',()=>{
 const refs=Array.from({length:4},(_,i)=>({id:i+1,artist:'Reference Artist '+i,title:'Reference '+i,source:'liked song'}));
 const candidates=refs.map((a,i)=>({id:100+i,artist:'Different Artist '+i,title:'Song '+i,anchorIds:[a.id],evidence:{type:'same_release',provider:i<2?'Deezer':'Apple',candidateId:100+i,album:{id:i<2?1:99,title:'One Collection'},reference:{id:i+1,artist:a.artist,title:a.title}}}));
 const first=parseRelevantPicks('{"picks":[{"id":1,"score":90},{"id":2,"score":80}]}',candidates,refs);
 const stats={};const second=parseRelevantPicks('{"picks":[{"id":3,"score":99},{"id":4,"score":99}]}',candidates,refs,first,stats);
 assert.equal(second.length,2);assert.equal(stats.rejected.releaseLimit,2);
});
test('Reference-song cap holds across different releases and artist credits',()=>{
 const a={id:1,artist:'Reference Artist',title:'Reference Song',source:'liked song'};
 const candidates=Array.from({length:4},(_,i)=>({id:100+i,artist:'Artist '+i,title:'Song '+i,anchorIds:[1],evidence:{type:'same_release',provider:'Deezer',candidateId:100+i,album:{id:i+1,title:'Release '+i},reference:{id:1,artist:a.artist,title:a.title}}}));
 const stats={};const out=parseRelevantPicks(JSON.stringify({picks:candidates.map((t,i)=>({id:i+1,score:80}))}),candidates,[a],[],stats);
 assert.equal(out.length,2);assert.equal(stats.rejected.referenceLimit,2);
});


test('Language preference filters unknown and other languages, and saves a matching shared batch',async()=>{
 const s=setup();assert.equal((await s.call('/refresh',{language:'Klingon'})).status,400);assert.equal(s.calls().aiCalls,0);
 s.env.AI.run=async(model,input)=>({response:{picks:selection(input).picks.map(p=>({...p,language:'Telugu'}))}});
 const r=await (await s.call('/refresh',{language:'Telugu'})).json();assert.equal(r.batch.language,'Telugu');assert.equal(r.batch.items.length,12);assert(r.batch.items.every(t=>t.language==='Telugu'));assert((await s.state()).languages.includes('Telugu'));s.sqlite.close();
 const b=setup();b.env.AI.run=async(model,input)=>({response:{picks:selection(input).picks.map((p,i)=>({...p,language:i%2?'Hindi':'Unknown'}))}});
 const rejected=await (await b.call('/refresh',{language:'Telugu'})).json();assert.equal((await b.state()).batch,null);assert(rejected.selectionStats.attempts.some(a=>a.rejected?.languageFilter>0));b.sqlite.close();
});
test('Changing language does not resume a draft for another language',async()=>{
 const s=setup();let calls=0;s.env.AI.run=async(model,input)=>({response:{picks:++calls===1?selection(input).picks.slice(0,1).map(p=>({...p,language:'Telugu'})):[]}});
 await s.call('/refresh',{language:'Telugu'});assert.equal((await s.state()).pendingLanguage,'Telugu');assert.equal((await s.state()).pendingSongCount,1);
 s.cooldown();s.env.AI.run=async(model,input)=>({response:{picks:selection(input).picks.map(p=>({...p,language:'Hindi'}))}});
 const r=await (await s.call('/refresh',{language:'Hindi'})).json();assert.equal(r.batch.language,'Hindi');assert.equal(r.batch.selectionStats.resumedCount,0);assert(r.batch.items.every(t=>t.language==='Hindi'));s.sqlite.close();
});


test('Multiple languages accept either selected language and canonicalize draft identity',async()=>{
 const s=setup();s.env.AI.run=async(model,input)=>({response:{picks:selection(input).picks.map((p,i)=>({...p,language:i%2?'Telugu':'Hindi'}))}});
 const r=await (await s.call('/refresh',{languages:['Hindi','Telugu','Hindi']})).json();assert.equal(r.batch.language,'Telugu + Hindi');assert.equal(r.batch.items.length,12);assert(r.batch.items.some(t=>t.language==='Hindi'));assert(r.batch.items.some(t=>t.language==='Telugu'));s.sqlite.close();
 const b=setup();for(const languages of [[],['Mixed','Telugu'],['Spanish']])assert.equal((await b.call('/refresh',{languages})).status,400);assert.equal(b.calls().aiCalls,0);b.sqlite.close();
});
test('Preview endpoint returns only a matching song preview and does not mutate taste',async()=>{
 const s=setup(),before=await s.state();s.env.CATALOG_FETCH=async()=>Response.json({data:[{id:42,artist:{name:fixture.artist},title:fixture.title,preview:'https://cdn-preview-a.dzcdn.net/stream/test.mp3'}]});
 const response=await s.call('/preview',fixture);assert.equal(response.status,200);const r=await response.json();assert.equal(r.preview.link,'https://www.deezer.com/track/42');assert.equal((await s.state()).revision,before.revision);
 assert.equal((await s.call('/preview',{artist:'Unknown',title:'Not in the room'})).status,400);
 s.sqlite.exec('DELETE FROM song_resources');s.env.CATALOG_FETCH=async()=>Response.json({data:[{id:42,artist:{name:'Unrelated Artist'},title:fixture.title,preview:'https://cdn-preview-a.dzcdn.net/stream/test.mp3'}]});assert.equal((await (await s.call('/preview',fixture)).json()).preview,null);
 s.sqlite.exec('DELETE FROM song_resources');s.env.CATALOG_FETCH=async()=>Response.json({data:[{id:42,artist:{name:fixture.artist},title:fixture.title,preview:'https://evil.example/test.mp3'}]});assert.equal((await (await s.call('/preview',fixture)).json()).preview,null);s.sqlite.close();
});


test('Single-language refresh retries missing language labels instead of marking them fully scored',async()=>{
 const s=setup();let calls=0;
 s.env.AI.run=async(model,input)=>{calls++;const picks=selection(input).picks;if(calls===1)return {response:{picks}};assert.match(input.messages.at(-1).content,/EVERY entry must include id, score and language/);return {response:{picks:picks.map(p=>({...p,language:'Telugu'}))}};};
 const r=await (await s.call('/refresh',{languages:['Telugu']})).json();assert.equal(r.batch.items.length,12);assert.equal(calls,2);assert(r.batch.selectionStats.attempts[0].rejected.missingLanguage>0);assert.equal(r.batch.selectionStats.attempts[0].scoredIds.length,0);s.sqlite.close();
});
test('Complete bare arrays are accepted, unknown language remains excluded, diagnostics explain failure',()=>{
 const anchors=[{id:1,artist:'Artist',title:'Reference',source:'playlist song'}],candidates=[{artist:'Artist',title:'New song',anchorIds:[1]}];
 const stats={};const songs=parseRelevantPicks(JSON.stringify([{id:1,score:80,language:'Telugu'}]),candidates,anchors,[],stats,12,'Telugu');assert.equal(songs.length,1);
 const unknown={};assert.throws(()=>parseRelevantPicks(JSON.stringify({picks:[{id:1,score:80,language:'Unknown'}]}),candidates,anchors,[],unknown,12,'Telugu'));assert.equal(unknown.rejected.languageFilter,1);assert.deepEqual(unknown.scoredIds,[1]);
 const diagnostic=aiFailureDiagnostic({response:'private'},{message:'failed',diagnostics:unknown},1,0);assert.equal(diagnostic.languageDistribution.Unknown,1);assert.equal(diagnostic.rejected.languageFilter,1);assert(!JSON.stringify(diagnostic).includes('private'));
});

test('Explicit Telugu catalog tags can qualify tracks when the ranker returns Unknown',async()=>{
 const s=setup();s.env.CATALOG_FETCH=async input=>{const r=await fixtureCatalog(input),data=await r.json();if(data.genres)data.genres={data:[{name:'Telugu'}]};return Response.json(data);};
 s.env.AI.run=async(model,input)=>({response:{picks:selection(input).picks.map(p=>({...p,language:'Unknown'}))}});
 const r=await (await s.call('/refresh',{languages:['Telugu']})).json();assert.equal(r.batch.items.length,12);assert(r.batch.items.every(t=>t.language==='Telugu'&&t.languageBasis==='catalog tag'));assert.equal(r.batch.selectionStats.referenceLanguages.matching,16);s.sqlite.close();
});
test('Reference classifier prioritizes matching songs without copying estimates onto candidates',async()=>{
 const {prioritizeLanguageReferences}=await import('../backend/language-discovery.mjs');const anchors=Array.from({length:20},(_,i)=>({id:i+1,artist:'Artist '+i,title:'Song '+i})),stats={};
 const out=await prioritizeLanguageReferences(anchors,'Telugu',async input=>({response:{picks:JSON.parse(input.messages[1].content).candidates.map(t=>({id:t.id,language:t.title==='Song 13'?'Telugu':'Unknown'}))}}),stats);
 assert.equal(out[0].id,14);assert.equal(out.length,20);assert.equal(stats.referenceLanguages.matching,1);assert.equal(out[0].language,undefined);
 const bad={};assert.deepEqual(await prioritizeLanguageReferences(anchors,'Telugu',async()=>({response:'broken'}),bad),anchors);assert(bad.referenceLanguages.error);
});
test('Broad genres, ambiguous tags and instrumental titles cannot supply a Telugu label',async()=>{
 const {catalogLanguage}=await import('../backend/languages.mjs');
 for(const genre of ['Bollywood','Indian','Soundtrack','Tamil, Telugu','Asian Music'])assert.equal(catalogLanguage({title:'Song',evidence:{album:{genre}}}),undefined);
 assert.equal(catalogLanguage({title:'Song (Instrumental)',evidence:{album:{genre:'Telugu'}}}),undefined);
 assert.equal(catalogLanguage({title:'Song',evidence:{album:{genre:'Telugu'}}}),'Telugu');
});


test('AI prompt exposes only local candidate IDs, never provider or reference IDs',async()=>{
 const {relevanceMessages}=await import('../backend/relevance.mjs');
 const a={id:7,artist:'Artist',title:'Reference',source:'liked song'},t={id:998877,artist:'Artist',title:'New',anchorIds:[7],genre:'Telugu',evidence:{type:'same_release',provider:'Deezer',candidateId:998877,album:{id:887766,title:'Release',genre:'Telugu'},reference:{id:776655,artist:'Artist',title:'Reference'}}};
 const messages=relevanceMessages([t],[a],[],'Telugu'),payload=JSON.parse(messages[1].content);
 assert.equal(payload.candidates[0].id,1);assert.equal(payload.candidates[0].catalogLanguage,'Telugu');assert.equal(payload.candidates[0].release,'Release');assert.equal(payload.candidates[0].reference.title,'Reference');
 for(const id of ['998877','887766','776655'])assert(!JSON.stringify(messages).includes(id));
 assert(!JSON.stringify(payload).includes('candidateId'));assert.match(messages[0].content,/No prose/);
});


test('Previously shown unrated catalog songs remain eligible, rated songs stay excluded',async()=>{
 const {collectEvidenceCandidates}=await import('../backend/evidence.mjs');const seed={artist:'Fixture Artist 0',title:'Anchor Song 0'};
 const state={seedSongs:[seed],songRatings:{},familiar:{[songKey(seed)]:true},shown:{},rotation:0};
 const first=await collectEvidenceCandidates(state,fixtureCatalog);first.forEach(t=>state.shown[songKey(t)]=Date.now());
 const again=await collectEvidenceCandidates(state,fixtureCatalog);assert.equal(again.length,first.length);
 state.songRatings[songKey(first[0])]={...first[0],value:'replay'};const rated=await collectEvidenceCandidates(state,fixtureCatalog);assert(!rated.some(t=>songKey(t)===songKey(first[0])));
});
test('Comfort shuffle is shared, uses playlist songs and preserves draft and ratings',async()=>{
 const s=setup(),before=await s.state();assert.equal(before.comfortSongs.length,12);
 const row=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);row.pending={at:Date.now(),items:[],language:'Telugu',selectionStats:{build:'compact-selection-1'}};s.sqlite.prepare('UPDATE community SET data=?').run(JSON.stringify(row));
 const after=await (await s.call('/comfort/shuffle',{})).json();assert.notDeepEqual(after.comfortSongs,before.comfortSongs);assert.deepEqual(after.songRatings,before.songRatings);assert.equal(after.pendingLanguage,'Telugu');assert.deepEqual((await s.state()).comfortSongs,after.comfortSongs);s.sqlite.close();
});
test('Search preview uses server-verified catalog ID without adding feedback',async()=>{
 const s=setup(),before=await s.state();s.env.CATALOG_FETCH=async url=>{const u=new URL(url),track={id:42,artist:{name:'Found Artist'},title:'Found Song',preview:'https://cdn-preview-a.dzcdn.net/clip.mp3'};return Response.json(u.hostname==='itunes.apple.com'?{results:[]}:u.pathname==='/track/42'?track:{data:[track]});};
 const r=await (await s.call('/preview',{provider:'deezer',id:42,artist:'Forged',title:'Ignored'})).json();assert.equal(r.preview.link,'https://www.deezer.com/track/42');assert.deepEqual((await s.state()).songRatings,before.songRatings);assert.equal((await s.state()).revision,before.revision);s.sqlite.close();
});


test('Small reference batches retain successful labels when another batch fails, and reuse cache',async()=>{
 const {prioritizeLanguageReferences}=await import('../backend/language-discovery.mjs');const anchors=Array.from({length:16},(_,i)=>({artist:'Artist '+i,title:'Song '+i})),cache={},stats={};let calls=0;
 const run=async input=>{calls++;const c=JSON.parse(input.messages[1].content).candidates;assert(c.length<=8);if(c[0].title==='Song 8')return {response:'broken json'};return {response:{picks:c.map(t=>({id:t.id,language:'Telugu'}))}};};
 await prioritizeLanguageReferences(anchors,'Telugu',run,stats,100,cache);assert.equal(calls,2);assert.equal(Object.keys(cache).length,8);assert.equal(stats.referenceLanguages.batches[1].error,'invalid_json');
 const next={};await prioritizeLanguageReferences(anchors,'Telugu',run,next,100,cache);assert.equal(calls,3);assert.equal(next.referenceLanguages.cached,8);
 const failed={};await prioritizeLanguageReferences(anchors.slice(8),'Telugu',()=>new Promise(()=>{}),failed,1,{});assert.equal(failed.referenceLanguages.batches[0].error,'timeout');
});
test('Language cache survives a refresh with no approved candidates',async()=>{
 const s=setup();s.env.AI.run=async()=>({response:{picks:[]}});await s.call('/refresh',{language:'Telugu'});
 const state=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);assert.equal(Object.keys(state.referenceLanguageCache).length,16);assert.equal((await s.state()).refreshing,false);assert.equal((await s.state()).referenceLanguageCache,undefined);s.sqlite.close();
});
test('Seven-song comfort-replay draft resumes without dropping approved songs',async()=>{
 const s=setup();let calls=0;s.env.AI.run=async(model,input)=>({response:{picks:++calls===1?selection(input).picks.slice(0,7):[]}});
 await s.call('/refresh',{});const stored=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);assert.equal(stored.pending.items.length,7);const keys=new Set(stored.pending.items.map(songKey));stored.pending.selectionStats.build='comfort-replay-1';s.sqlite.prepare('UPDATE community SET data=?').run(JSON.stringify(stored));
 s.cooldown();s.env.AI.run=async(model,input)=>({response:selection(input)});const r=await (await s.call('/refresh',{})).json();assert.equal(r.batch.selectionStats.resumedCount,7);assert.equal(r.batch.items.filter(t=>keys.has(songKey(t))).length,7);s.sqlite.close();
});


test('Language-first refresh searches Telugu before ranking and can complete without AI language guesses',async()=>{
 const s=setup(),queries=[];s.env.CATALOG_FETCH=async url=>{
  const u=new URL(url),term=u.searchParams.get('term');assert.equal(u.hostname,'itunes.apple.com');assert(term.startsWith('Telugu '));queries.push(term);const n=Number(term.match(/Fixture Artist (\d+)/)[1]);
  return Response.json({results:Array.from({length:4},(_,i)=>({trackId:n*100+i+1000,artistName:'Fixture Artist '+n,trackName:'Language Pick '+i,collectionId:n+100,collectionName:'New Release '+n,primaryGenreName:'Telugu',kind:'song'}))});
 };
 s.env.AI.run=async(model,input)=>({response:{picks:selection(input).picks.map(p=>({...p,language:'Unknown'}))}});
 const r=await (await s.call('/refresh',{languages:['Telugu']})).json();assert.equal(r.batch.items.length,12);assert.equal(queries.length,6);assert.equal(r.batch.selectionStats.pools[0].discoveryMode,'language search');assert(r.batch.items.every(t=>t.language==='Telugu'&&t.reason.includes('shares an artist credit')&&!t.reason.includes('appear on')));s.sqlite.close();
});
test('Language search alternates preferences and rejects untagged, unrelated and rated tracks',async()=>{
 const {searchLanguageCandidates}=await import('../backend/language-search.mjs');const anchors=[{id:1,artist:'Artist A',title:'Anchor A'},{id:2,artist:'Artist B',title:'Anchor B'}],queries=[];
 const state={rotation:0,familiar:{},songRatings:{[songKey({artist:'Artist A',title:'Rated'})]:{value:'replay'}}};
 const get=async url=>{const term=new URL(url).searchParams.get('term');queries.push(term);const l=term.startsWith('Telugu')?'Telugu':'Hindi',artist=term.slice(l.length+1);return Response.json({results:[['Good',artist,l],['Untagged',artist,'Pop'],['Unrelated','Random artist',l],['Rated',artist,l]].map(([title,a,g],i)=>({trackId:i+1,artistName:a,trackName:title,collectionId:5,collectionName:'Release',primaryGenreName:g}))});};
 const stats={};const songs=await searchLanguageCandidates(state,get,{anchors,language:'Telugu + Hindi',stats});assert.deepEqual(queries,['Telugu Artist A','Hindi Artist B']);assert(!songs.some(t=>t.title==='Untagged'||t.title==='Unrelated'||(t.title==='Rated'&&t.artist==='Artist A')));assert.equal(stats.languageSearch.wrongArtist,2);assert.equal(stats.languageSearch.unverifiedLanguage,2);
});


test('Catalog cache serves fresh and stale successes but never caches errors',async()=>{
 const {cachedCatalogFetch}=await import('../backend/catalog-cache.mjs');let now=1000,calls=0,fail=false;const cache={},stats={};
 const get=cachedCatalogFetch(async()=>{calls++;return fail?new Response('',{status:429}):Response.json({data:[{id:1}]});},cache,stats,()=>now);
 await get('https://api.deezer.com/search?q=test');fail=true;await get('https://api.deezer.com/search?q=test');assert.equal(calls,1);assert.equal(stats.catalogCacheHits,1);
 now+=2*86400000;const fallback=await get('https://api.deezer.com/search?q=test');assert.equal(fallback.status,200);assert.equal(stats.catalogStaleHits,1);
 const bad=await get('https://api.deezer.com/search?q=other');assert.equal(bad.status,429);assert.equal(Object.keys(cache).length,1);
 now+=8*86400000;assert.equal((await get('https://api.deezer.com/search?q=test')).status,429);
});
test('Catalog outage stops after one pool and reports sanitized HTTP status without losing draft',async()=>{
 const s=setup();let calls=0;s.env.AI.run=async(model,input)=>({response:{picks:++calls===1?selection(input).picks.slice(0,7):[]}});await s.call('/refresh',{});
 const saved=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);assert.equal(saved.pending.items.length,7);saved.pending.selectionStats.build='language-search-1';delete saved.catalogCache;s.sqlite.prepare('UPDATE community SET data=?').run(JSON.stringify(saved));s.cooldown();
 s.env.CATALOG_FETCH=async()=>new Response('private provider body',{status:429});const r=await (await s.call('/refresh',{})).json();assert.equal(r.pendingSongCount,7);assert.equal(r.pendingSelectionStats.pools.length,1);assert.equal(r.pendingSelectionStats.stopReason,'both_catalogs_paused');assert(r.pendingSelectionStats.catalogErrors.every(e=>e.status===429));assert(!JSON.stringify(r).includes('private provider body'));assert.match(r.message,/Both music catalogs failed/);s.sqlite.close();
});
test('Network exceptions count toward provider circuit and expose safe category',async()=>{
 const stats={catalogRequests:0};const get=budgetedCatalogFetch(async()=>{throw Object.assign(Error('private query'),{name:'TimeoutError'});},stats,Date.now()+10000);
 for(let i=0;i<4;i++)await assert.rejects(get('https://api.deezer.com/search?q=private'));
 assert.equal(stats.catalogRequests,3);assert.equal(stats.providerFailures['api.deezer.com'],3);assert.equal(stats.catalogErrors[0].category,'timeout');assert(!JSON.stringify(stats).includes('private'));
});

function savedDiscoveryFixture(s){
 s.env.LASTFM_API_KEY='test-only';s.env.LASTFM_PUBLIC_APPROVED='true';
 s.env.DISCOVERY_FETCH=async()=>{throw Error('No provider should be needed for a ready cache');};
 const state=JSON.parse(s.sqlite.prepare('SELECT data FROM community WHERE id=1').get().data);
 state.songDiscovery={queries:{},languages:{},backoff:{}};
 for(const a of state.seedSongs.slice(0,8)){
  const tracks=Array.from({length:3},(_,i)=>{const t={artist:'New '+a.artist,title:'Related '+a.title+' '+i};return {...t,id:songKey(t),match:.9,url:'https://www.last.fm/music/Test/_/Track'};});
  state.songDiscovery.queries[songKey(a)]={until:Date.now()+86400000,tracks};
  for(const t of tracks)state.songDiscovery.languages[songKey(t)]={labels:['Telugu'],until:Date.now()+86400000};
 }
 return state;
}
test('Saved discovery publishes 12 picks, bounded catalog enrichment and valid descriptions',async()=>{
 const s=setup(),state=savedDiscoveryFixture(s);
 s.sqlite.prepare('UPDATE community SET data=? WHERE id=1').run(JSON.stringify(state));
 const result=await s.call('/refresh',{language:'Telugu'});assert.equal(result.status,200);const r=await result.json();
 assert.equal(r.batch.items.length,12);assert.equal(r.batch.selectionStats.engine,'Last.fm + ListenBrainz + MusicBrainz');
 assert.equal(r.batch.selectionStats.discovery.requests,0);assert(s.calls().catalogCalls<=12);
 assert(r.batch.items.every(t=>t.language==='Telugu'&&t.reason.includes('Last.fm')&&t.sourceUrl.startsWith('https://www.last.fm/')));
 assert(!JSON.stringify(r).includes('test-only'));assert(!JSON.stringify(r).includes('songDiscovery'));s.sqlite.close();
});
test('New discovery preserves seven compatible draft songs and adds five',async()=>{
 const s=setup(),state=savedDiscoveryFixture(s);
 state.pending={language:'Telugu',at:Date.now(),selectionStats:{build:'candidate-ranking-1'},items:Array.from({length:7},(_,i)=>({artist:'Approved Singer '+i,title:'Approved Song '+i,language:'Telugu',reason:'Previously approved',aiSong:true}))};
 s.sqlite.prepare('UPDATE community SET data=? WHERE id=1').run(JSON.stringify(state));
 const r=await (await s.call('/refresh',{language:'Telugu'})).json();
 assert.equal(r.batch?.items.length,12);assert.equal(r.batch.selectionStats.resumedCount,7);assert.equal(r.batch.items.filter(t=>t.title.startsWith('Approved')).length,7);s.sqlite.close();
});

test('Daily discovery warm preserves batch and draft and respects the shared generation lease',async()=>{
 const s=setup(),state=savedDiscoveryFixture(s);state.pending={items:[{artist:'Saved',title:'Draft'}],at:Date.now()};
 s.sqlite.prepare('UPDATE community SET data=? WHERE id=1').run(JSON.stringify(state));
 await worker.scheduled({},s.env);
 let stored=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);
 assert.deepEqual(stored.pending,state.pending);assert.equal(stored.discoveryRotation,1);
 s.sqlite.prepare('UPDATE community SET lease=?,lease_until=?').run('other-refresh',Date.now()+60000);
 await worker.scheduled({},s.env);stored=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);assert.equal(stored.discoveryRotation,1);s.sqlite.close();
});

test('Failed refresh persists its own diagnostics instead of exposing an expired draft',async()=>{
 const s=setup();const data=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);
 data.pending={at:Date.now()-2*86400000,items:[{artist:'Old',title:'Old draft'}],selectionStats:{build:'old-build',candidateCount:30}};
 s.sqlite.prepare('UPDATE community SET data=?').run(JSON.stringify(data));
 s.env.CATALOG_FETCH=async u=>Response.json(new URL(u).hostname==='itunes.apple.com'?{results:[]}:{data:[]});
 const response=await s.call('/refresh',{});assert.equal(response.status,422);
 const failure=await response.json(),state=await s.state();
 assert.equal(state.pendingSongCount,0);assert.equal(state.lastSelectionStats.build,'provider-resilience-1');
 assert.equal(state.pendingSelectionStats.build,'provider-resilience-1');
 assert.equal(state.lastSelectionStats.candidateCount,failure.selectionStats.candidateCount);
 s.sqlite.close();
});

test('Public state reads omit private discovery caches before JSON reaches Worker JavaScript',async()=>{
 const s=setup(),row=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);
 row.catalogCache={large:'x'.repeat(200000)};row.songDiscovery={large:'y'.repeat(200000)};row.referenceLanguageCache={large:'z'.repeat(200000)};
 s.sqlite.prepare('UPDATE community SET data=?').run(JSON.stringify(row));
 const original=s.env.DB;let readBytes=0;
 s.env.DB={prepare(sql){const p=original.prepare(sql);return {bind(...args){const bound=p.bind(...args);return {...bound,async first(){const r=await bound.first();if(r?.data)readBytes=r.data.length;return r;}};}};}};
 const result=await s.state();assert.equal(result.seedSongCount,16);assert(readBytes<20000);assert(!JSON.stringify(result).includes('yyyyyy'));
 assert(JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data).songDiscovery.large.length===200000);s.sqlite.close();
});
test('Deezer search result without audio falls through to a matched Apple preview',async()=>{
 const s=setup();s.env.CATALOG_FETCH=async input=>{
  const u=new URL(input);
  if(u.hostname==='api.deezer.com')return Response.json({id:42,artist:{name:'Found Artist'},title:'Found Song',preview:''});
  return Response.json({results:[{trackId:99,artistName:'Found Artist',trackName:'Found Song',previewUrl:'https://audio-ssl.itunes.apple.com/clip.m4a',trackViewUrl:'https://music.apple.com/in/album/song/1?i=99'}]});
 };
 const result=await (await s.call('/preview',{provider:'deezer',id:42})).json();
 assert.equal(result.preview.source,'iTunes');assert.equal(result.diagnostics.attempts.length,1);s.sqlite.close();
});
test('AI quota failure publishes a full deterministic modern batch and preserves taste',async()=>{
 const s=setup(),state=savedDiscoveryFixture(s),originalSeeds=state.seedSongs;
 s.sqlite.prepare('UPDATE community SET data=? WHERE id=1').run(JSON.stringify(state));
 let calls=0;s.env.AI.run=async()=>{calls++;throw Error('3036: quota exhausted');};
 const r=await (await s.call('/refresh',{language:'Telugu'})).json();
 assert.equal(r.batch.items.length,12);assert.equal(calls,1);assert.equal(r.batch.selectionStats.ai.fallbackReason,'quota');assert(r.batch.items.every(t=>t.rankingMode==='deterministic'&&!t.aiSong));
 const stored=JSON.parse(s.sqlite.prepare('SELECT data FROM community').get().data);assert.deepEqual(stored.seedSongs,originalSeeds);assert.equal(stored.history.length,12);
 await s.call('/state');await s.call('/feedback',{...r.batch.items[0],rating:'replay'});assert.equal(calls,1);s.sqlite.close();
});
test('Actual playback activity is idempotent, separate from ratings, and never calls AI',async()=>{
 const s=setup();const body={...fixture,event:'play',eventId:'11111111-1111-4111-8111-111111111111'};
 const before=await s.state();assert.equal((await s.call('/activity',body)).status,200);await s.call('/activity',body);
 const row=s.sqlite.prepare('SELECT plays,completions,skips FROM song_activity').get();assert.equal(row.plays,1);assert.equal(row.completions,0);assert.equal(s.calls().aiCalls,0);
 assert.deepEqual((await s.state()).songRatings,before.songRatings);
 assert.equal((await s.call('/activity',{...body,title:'Fake',eventId:'22222222-2222-4222-8222-222222222222'})).status,400);s.sqlite.close();
});
test('Preview mappings cache without changing ratings, no-store is respected, and Apple precedes Deezer',async()=>{
 const s=setup();let calls=0;s.env.CATALOG_FETCH=async url=>{calls++;assert.equal(new URL(url).hostname,'itunes.apple.com');return Response.json({results:[{trackId:42,artistName:fixture.artist,trackName:fixture.title,previewUrl:'https://audio-ssl.itunes.apple.com/clip.m4a',trackViewUrl:'https://music.apple.com/in/album/song/1?i=42'}]});};
 assert.equal((await (await s.call('/preview',fixture)).json()).preview.source,'iTunes');
 assert.equal((await (await s.call('/preview',fixture)).json()).diagnostics.cacheHit,true);assert.equal(calls,1);assert.equal(s.calls().aiCalls,0);
 s.sqlite.exec('DELETE FROM song_resources');s.env.CATALOG_FETCH=async()=>Response.json({results:[]},{headers:{'cache-control':'no-store'}});
 await s.call('/preview',fixture);assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM song_resources').get().n,0);s.sqlite.close();
});
test('Cover Art Archive is optional, uses a verified release identity, and caches metadata only',async()=>{
 const {resolveResource}=await import('../backend/resources.mjs');const s=setup(),releaseId='11111111-1111-4111-8111-111111111111';let heads=0;
 const r=await resolveResource(s.env.DB,{...fixture,releaseId},async u=>Response.json(new URL(u).hostname==='itunes.apple.com'?{results:[]}:{data:[]}),{},async(u,o)=>{heads++;assert.equal(o.method,'HEAD');assert.equal(u,'https://coverartarchive.org/release/'+releaseId+'/front-250');return new Response(null,{status:307});});
 assert.equal(r.artworkSource,'Cover Art Archive');assert.equal(r.preview,null);assert(r.youtube.includes('youtube.com/results'));assert.equal(heads,1);s.sqlite.close();
});
