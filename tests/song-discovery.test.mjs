import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoverSongs,discoveryEnabled,workLanguages,sourceLink} from '../backend/song-discovery.mjs';
import {parseRelevantPicks} from '../backend/relevance.mjs';
import {songKey} from '../ai-core.mjs';
const recording='11111111-1111-4111-8111-111111111111',work='22222222-2222-4222-8222-222222222222';
const anchor={id:1,artist:'Starting Singer',title:'Starting Song',source:'liked song'};
function fixture(){
 let clock=100000,calls=[];
 const state={seedSongs:[anchor],songRatings:{},familiar:{}};
 const env={LISTENBRAINZ_ENABLED:'false',LASTFM_API_KEY:'never-log-this',LASTFM_PUBLIC_APPROVED:'true',DISCOVERY_FETCH:async(url,options)=>{
  calls.push({url,options,at:clock});const u=new URL(url);
  if(u.hostname==='ws.audioscrobbler.com')return Response.json({similartracks:{track:[{name:'Discovery',artist:{name:'Other Singer'},mbid:recording,match:'0.9',url:'https://www.last.fm/music/Other+Singer/_/Discovery'}]}});
  if(u.pathname.includes('/recording/'))return Response.json({id:recording,title:'Discovery','artist-credit':[{name:'Other Singer'}],relations:[{type:'performance',work:{id:work}}]});
  return Response.json({id:work,languages:['tel','hin']});
 }};
 return {state,env,calls,options:{anchors:[{...anchor}],language:'Telugu',now:()=>clock,sleep:async ms=>{clock+=ms;},deadline:200000}};
}
test('Last.fm matches + work lyrics language, independently of AI guesses; cache is private and reusable',async()=>{
 const f=fixture(),songs=await discoverSongs(f.state,f.env,f.options);assert.equal(songs.length,1);
 assert.deepEqual(songs[0].evidence.languages,['Telugu','Hindi']);assert.equal(f.calls.length,3);
 assert(f.calls[2].at-f.calls[1].at>=1100);assert(f.calls[1].options.headers['User-Agent'].includes('MunnasGrooves'));
 assert(!JSON.stringify(f.state).includes(f.env.LASTFM_API_KEY));
 const stats={};const picks=parseRelevantPicks(JSON.stringify({picks:[{id:1,score:90,language:'English'}]}),songs,[anchor],[],stats,12,'Hindi');
 assert.equal(picks[0].language,'Hindi');assert.match(picks[0].reason,/Last.fm/);assert(!picks[0].reason.includes('album'));
 await discoverSongs(f.state,f.env,f.options);assert.equal(f.calls.length,3);
 f.state.songRatings[songKey(songs[0])]={...songs[0],value:'skip'};
 assert.equal((await discoverSongs(f.state,f.env,f.options)).length,0);
});
test('429 backoff survives a second refresh without exposing key or provider body',async()=>{
 const f=fixture();f.env.DISCOVERY_FETCH=async()=>{f.calls.push(1);return Response.json({error:29,message:'secret provider text'},{status:429,headers:{'retry-after':'600'}});};
 const stats={};assert.equal((await discoverSongs(f.state,f.env,{...f.options,stats})).length,0);
 await discoverSongs(f.state,f.env,{...f.options,stats:{}});assert.equal(f.calls.length,1);
 assert.equal(f.state.songDiscovery.backoff['Last.fm'],700000);assert(!JSON.stringify(stats).includes('secret'));
});
test('Release language, artist nationality, and model language cannot turn unknown into Telugu',async()=>{
 const f=fixture();const original=f.env.DISCOVERY_FETCH;
 f.env.DISCOVERY_FETCH=async(u,o)=>u.includes('/work/')?Response.json({language:null,languages:[],releases:[{'text-representation':{language:'tel'}}]}):original(u,o);
 assert.equal((await discoverSongs(f.state,f.env,f.options)).length,0);
 const songs=await discoverSongs(f.state,f.env,{...f.options,language:'Mixed'});assert.equal(songs.length,1);
 assert.throws(()=>parseRelevantPicks('{"picks":[{"id":1,"score":90,"language":"Telugu"}]}',songs,[anchor],[],{},12,'Telugu'),/no sufficiently/);
});
test('Every supported language uses lyrics codes; no free-text or release shortcut',()=>{
 assert.deepEqual(workLanguages({languages:['tel','hin','eng','tam','kan','mal','pan','ben','zxx']}),['Telugu','Hindi','English','Tamil','Kannada','Malayalam','Punjabi','Bengali']);
 assert.equal(sourceLink('https://www.last.fm.evil.test/music/a'),null);assert.equal(sourceLink('javascript:alert(1)'),null);
 assert.equal(discoveryEnabled({LASTFM_API_KEY:'key',LISTENBRAINZ_ENABLED:'false'}),false);
});
test('Wrong recording identity and HTTP no-store never enter a verified pool',async()=>{
 const f=fixture();const orig=f.env.DISCOVERY_FETCH;
 f.env.DISCOVERY_FETCH=async(u,o)=>u.includes('/recording/')?Response.json({title:'Different version','artist-credit':[{name:'Other Singer'}],relations:[{type:'performance',work:{id:work}}]}):orig(u,o);
 assert.equal((await discoverSongs(f.state,f.env,f.options)).length,0);
 const g=fixture();g.env.DISCOVERY_FETCH=async()=>Response.json({similartracks:{track:[]}},{headers:{'cache-control':'no-store'}});
 await discoverSongs(g.state,g.env,g.options);assert.deepEqual(g.state.songDiscovery.queries,{});
});

test('Last.fm redirects never forward the key and non-JSON HTTP failures retain status',async()=>{
 for(const status of [302,429]){
  const f=fixture(),stats={};let count=0;
  f.env.DISCOVERY_FETCH=async(url,options)=>{count++;assert.equal(options.redirect,'manual');return new Response('not json',{status,headers:{location:'https://untrusted.example/'}});};
  await discoverSongs(f.state,f.env,{...f.options,stats});
  assert.equal(count,1);assert.equal(stats.discovery.errors[0].status,status);
  assert.equal(stats.discovery.errors[0].category,status===302?'redirect_blocked':'http_error');
  assert(!JSON.stringify(stats).includes('never-log-this'));
 }
});
test('Missing Last.fm reference does not pause discovery for other songs; positive match scores need not be <= 1',async()=>{
 const f=fixture(),original=f.env.DISCOVERY_FETCH;
 const second={...anchor,id:2,title:'Another Reference'};f.state.seedSongs.push(second);f.options.anchors.push(second);
 f.env.DISCOVERY_FETCH=async(u,o)=>{
  const url=new URL(u);
  if(url.hostname==='ws.audioscrobbler.com'){
   if(url.searchParams.get('track')===anchor.title)return Response.json({error:6,message:'Track not found'},{status:400});
   return Response.json({similartracks:{track:[{name:'Discovery',artist:{name:'Other Singer'},mbid:recording,match:'10.95'}]}});
  }
  return original(u,o);
 };
 const songs=await discoverSongs(f.state,f.env,f.options);assert.equal(songs.length,1);assert.equal(songs[0].match,10.95);
 assert.equal(f.state.songDiscovery.backoff['Last.fm'],undefined);
 const picks=parseRelevantPicks('{"picks":[{"id":1,"score":85}]}',songs,f.options.anchors,[],{},12,'Telugu');assert.equal(picks.length,1);
});

test('One HTTPS MusicBrainz API redirect is followed with request budget and spacing intact',async()=>{
 const f=fixture(),orig=f.env.DISCOVERY_FETCH,stats={};let redirected=false;
 f.env.DISCOVERY_FETCH=async(u,o)=>{
  if(u.includes('/recording/')&&!redirected){redirected=true;return new Response(null,{status:301,headers:{location:u+'&canonical=1'}});}
  return orig(u,o);
 };
 const songs=await discoverSongs(f.state,f.env,{...f.options,stats});assert.equal(songs.length,1);
 assert.equal(stats.discovery.redirectsFollowed,1);assert.equal(stats.discovery.requests,4);assert.deepEqual(stats.discovery.errors,[]);
});
test('MusicBrainz external redirects and repeated redirects are blocked',async()=>{
 for(const destination of ['https://external.example/ws/2/work/x','http://musicbrainz.org/ws/2/work/x','https://musicbrainz.org/login','https://musicbrainz.org/ws/2/again']){
  const f=fixture(),orig=f.env.DISCOVERY_FETCH,stats={};let requests=0;
  f.env.DISCOVERY_FETCH=async(u,o)=>{
   if(new URL(u).hostname==='musicbrainz.org'){requests++;return new Response(null,{status:301,headers:{location:destination}});}
   return orig(u,o);
  };
  assert.equal((await discoverSongs(f.state,f.env,{...f.options,stats})).length,0);
  assert(requests<=2);assert.equal(stats.discovery.errors[0].category,'redirect_blocked');
 }
});

test('Missing recording falls back to exact search without pausing MusicBrainz',async()=>{
 const f=fixture(),orig=f.env.DISCOVERY_FETCH,stats={};
 const replacement='33333333-3333-4333-8333-333333333333';
 f.env.DISCOVERY_FETCH=async(u,o)=>{
  const url=new URL(u);
  if(url.pathname==='/ws/2/recording/'+recording)return new Response('Not found',{status:404});
  if(url.pathname==='/ws/2/recording')return Response.json({recordings:[{id:replacement,title:'Discovery','artist-credit':[{name:'Other Singer'}]}]});
  if(url.pathname==='/ws/2/recording/'+replacement)return Response.json({id:replacement,title:'Discovery','artist-credit':[{name:'Other Singer'}],relations:[{type:'performance',work:{id:work}}]});
  return orig(u,o);
 };
 const songs=await discoverSongs(f.state,f.env,{...f.options,stats});
 assert.equal(songs.length,1);assert.equal(songs[0].evidence.recordingId,replacement);
 assert.equal(stats.discovery.notFound.recording,1);assert.equal(stats.discovery.recordingSearchFallbacks,1);
 assert.equal(f.state.songDiscovery.backoff.MusicBrainz,undefined);assert.deepEqual(stats.discovery.errors,[]);
});
test('Missing work is cached as unknown rather than pausing other checks',async()=>{
 const f=fixture(),orig=f.env.DISCOVERY_FETCH,stats={};let missingCalls=0;
 f.env.DISCOVERY_FETCH=async(u,o)=>{if(u.includes('/work/')){missingCalls++;return Response.json({error:'Not Found'},{status:404});}return orig(u,o);};
 assert.equal((await discoverSongs(f.state,f.env,{...f.options,stats})).length,0);
 await discoverSongs(f.state,f.env,{...f.options,stats});assert.equal(missingCalls,1);
 assert.equal(stats.discovery.notFound.work,1);assert.equal(f.state.songDiscovery.backoff.MusicBrainz,undefined);
});
test('Merged recording IDs retain exact song identity validation',async()=>{
 const f=fixture(),orig=f.env.DISCOVERY_FETCH;
 f.env.DISCOVERY_FETCH=async(u,o)=>{
  const r=await orig(u,o);if(!u.includes('/recording/'))return r;
  const body=await r.json();body.id='33333333-3333-4333-8333-333333333333';return Response.json(body);
 };
 assert.equal((await discoverSongs(f.state,f.env,f.options)).length,1);
});

test('Cached pools cap reference concentration and skip references already filling two slots',async()=>{
 const f=fixture(),key=songKey(anchor);
 const tracks=Array.from({length:30},(_,i)=>{const t={artist:'Discovery Singer '+i,title:'New Song '+i};return {...t,id:songKey(t),match:.9};});
 f.state.songDiscovery={queries:{[key]:{until:200000,tracks}},languages:{},backoff:{}};
 f.env.DISCOVERY_FETCH=async()=>{throw Error('Mixed cached discovery should not need language lookup');};
 const songs=await discoverSongs(f.state,f.env,{...f.options,language:'Mixed'});assert.equal(songs.length,4);
 const existing=tracks.slice(0,2).map(t=>({...t,evidence:{reference:anchor}}));
 const after=await discoverSongs(f.state,f.env,{...f.options,language:'Mixed',existing});assert.equal(after.length,0);
});
test('Mixed discovery rotates queried anchors and does not spend its budget on language lookup',async()=>{
 const f=fixture(),usedSources=new Set(),stats={};
 const songs=await discoverSongs(f.state,f.env,{...f.options,language:'Mixed',usedSources,stats});
 assert.equal(songs.length,1);assert.equal(stats.discovery.requests,2);assert(usedSources.has(songKey(anchor)));
 assert(!f.calls.some(c=>new URL(c.url).pathname.includes('/work/')));
});
test('Language enrichment skips capped references before spending metadata requests',async()=>{
 const f=fixture(),capped={artist:'Capped Singer',title:'Capped Reference'};
 f.state.seedSongs.push(capped);
 f.state.songDiscovery={queries:{[songKey(capped)]:{until:200000,tracks:Array.from({length:30},(_,i)=>({artist:'Waste',title:'Unused '+i,match:1,mbid:recording}))}},languages:{},backoff:{}};
 const existing=[{evidence:{reference:capped}},{evidence:{reference:capped}}],stats={};
 const rows=await discoverSongs(f.state,f.env,{...f.options,existing,stats});
 assert.equal(rows.length,1);assert.equal(rows[0].title,'Discovery');assert.equal(f.calls.length,3);
 assert.equal(stats.discovery.eligibility.cappedReference,30);assert.equal(stats.discovery.enrichmentQueued,1);
 assert.deepEqual(stats.discovery.requestsByProvider,{'Last.fm':1,MusicBrainz:2});
});
test('Verified language outside the requested mix is diagnosed, not silently approved',async()=>{
 const f=fixture(),fetcher=f.env.DISCOVERY_FETCH;f.env.DISCOVERY_FETCH=async(u,o)=>u.includes('/work/')?Response.json({id:work,languages:['pan']}):fetcher(u,o);
 const stats={};const rows=await discoverSongs(f.state,f.env,{...f.options,language:'Telugu + Hindi + English',stats});
 assert.equal(rows.length,0);assert.equal(stats.discovery.verifiedLanguage,1);
 assert.equal(stats.discovery.eligibility.otherLanguage,1);assert.equal(stats.discovery.eligibility.languages.Punjabi,1);
});
test('ListenBrainz adds real secondary matches when Last.fm is unavailable, using exact MB seed identity',async()=>{
 const f=fixture(),seedId='33333333-3333-4333-8333-333333333333',original=f.env.DISCOVERY_FETCH;
 delete f.env.LASTFM_API_KEY;f.env.LISTENBRAINZ_ENABLED='true';
 f.env.DISCOVERY_FETCH=async(u,o)=>{
  const url=new URL(u);f.calls.push({url:u,options:o});
  if(url.hostname==='labs.api.listenbrainz.org'){
   assert.equal(url.searchParams.get('recording_mbids'),seedId);
   return Response.json([{recording_mbid:recording,reference_mbid:seedId,recording_name:'Discovery',artist_credit_name:'Other Singer',score:120},{recording_mbid:work,reference_mbid:recording,recording_name:'Wrong reference',artist_credit_name:'Other',score:150}]);
  }
  if(url.pathname==='/ws/2/recording')return Response.json({recordings:[{id:seedId,title:anchor.title,'artist-credit':[{name:anchor.artist}]}]});
  return original(u,o);
 };
 const stats={},rows=await discoverSongs(f.state,f.env,{...f.options,stats});
 assert.equal(rows.length,1);assert.equal(rows[0].evidence.provider,'ListenBrainz');assert.deepEqual(rows[0].evidence.languages,['Telugu','Hindi']);assert.equal(stats.discovery.listenBrainzResults,1);
 assert(!f.calls.some(c=>c.url.includes('audioscrobbler')));
});
test('Large unknown-language backlog gets metadata budget before fetching more Last.fm or seed lookups',async()=>{
 const f=fixture(),stats={};
 f.state.songDiscovery={queries:{[songKey(anchor)]:{until:999999,tracks:Array.from({length:16},(_,i)=>({artist:'Other Singer',title:'Discovery '+i,id:'t'+i,match:.9,mbid:null}))}},languages:{},backoff:{}};
 f.env.LISTENBRAINZ_ENABLED='true';
 f.env.DISCOVERY_FETCH=async url=>{f.calls.push(url);assert.equal(new URL(url).hostname,'musicbrainz.org');return Response.json({recordings:[]});};
 await discoverSongs(f.state,f.env,{...f.options,stats});
 assert.equal(stats.discovery.scheduling.mode,'enrich_saved_candidates');assert.equal(stats.discovery.requestsByProvider['Last.fm'],undefined);assert.equal(stats.discovery.requestsByProvider.MusicBrainz,16);
 assert.equal(stats.discovery.unknownLanguage,16);
});
test('Last.fm cap applies to entire multi-pool refresh, preserving enrichment capacity',async()=>{
 const f=fixture(),stats={};f.options.language='Mixed';f.env.DISCOVERY_FETCH=async()=>Response.json({similartracks:{track:[]}});
 for(let round=0;round<3;round++){
  const anchors=Array.from({length:6},(_,i)=>({...anchor,id:i+1,title:'Seed '+round+' '+i}));f.state.seedSongs.push(...anchors);
  await discoverSongs(f.state,f.env,{...f.options,anchors,stats});
 }
 assert.equal(stats.discovery.requestsByProvider['Last.fm'],6);assert.equal(stats.discovery.requests,6);
});
