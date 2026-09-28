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
 const env={LASTFM_API_KEY:'never-log-this',LASTFM_PUBLIC_APPROVED:'true',DISCOVERY_FETCH:async(url,options)=>{
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
 assert.equal(discoveryEnabled({LASTFM_API_KEY:'key'}),false);
});
test('Wrong recording identity and HTTP no-store never enter a verified pool',async()=>{
 const f=fixture();const orig=f.env.DISCOVERY_FETCH;
 f.env.DISCOVERY_FETCH=async(u,o)=>u.includes('/recording/')?Response.json({title:'Different version','artist-credit':[{name:'Other Singer'}],relations:[{type:'performance',work:{id:work}}]}):orig(u,o);
 assert.equal((await discoverSongs(f.state,f.env,f.options)).length,0);
 const g=fixture();g.env.DISCOVERY_FETCH=async()=>Response.json({similartracks:{track:[]}},{headers:{'cache-control':'no-store'}});
 await discoverSongs(g.state,g.env,g.options);assert.deepEqual(g.state.songDiscovery.queries,{});
});
