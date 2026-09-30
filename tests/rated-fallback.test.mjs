import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fillWithRatedSongs,verifiedSongLanguages} from '../backend/rated-fallback.mjs';
import {songKey} from '../ai-core.mjs';
const song=i=>({artist:'Singer '+i,title:'Song '+i,score:90});
const rating=(i,value='replay',labels=['Telugu'])=>({...song(i),value,verifiedLanguages:labels});
const state=ratings=>({songRatings:Object.fromEntries(ratings.map(t=>[songKey(t),t])),shown:{}});
test('Nine fresh picks retain their slots; liked/known songs fill only the last three',()=>{
 const fresh=Array.from({length:9},(_,i)=>song(i)),s=state([rating(10),rating(11,'known'),rating(12),rating(13,'skip')]),stats={};
 const out=fillWithRatedSongs(fresh,s,'Telugu',stats);
 assert.equal(out.length,12);assert.deepEqual(out.slice(0,9),fresh);assert(out.slice(9).every(t=>['replay','known'].includes(t.reusedRating)));
 assert.equal(stats.ratedFallback.added,3);assert(!out.some(t=>t.title==='Song 13'));assert.match(out[9].reason,/Returning favorite/);
});
test('Full fresh batch never uses rated fallback; recent liked songs are allowed only in fallback',()=>{
 const s=state([rating(30)]),fresh=Array.from({length:12},(_,i)=>song(i));s.shown[songKey(song(30))]=Date.now();
 assert.equal(fillWithRatedSongs(fresh,s,'Telugu').length,12);assert(!fillWithRatedSongs(fresh,s,'Telugu').some(t=>t.reusedRating));
 assert.equal(fillWithRatedSongs([],s,'Telugu')[0].title,'Song 30');
});
test('Language restrictions hold for every language; unknown or AI-estimated labels cannot fill a filtered batch',()=>{
 for(const language of ['Telugu','Hindi','English','Tamil','Kannada','Malayalam','Punjabi','Bengali']){
  const s=state([rating(1,'replay',[language]),rating(2,'known',[]),rating(3,'replay',[language==='Telugu'?'Hindi':'Telugu'])]);
  s.songRatings[songKey(song(2))].language=language;
  const out=fillWithRatedSongs([],s,language);assert.deepEqual(out.map(t=>t.title),['Song 1']);
  assert.equal(fillWithRatedSongs([],s,'Mixed').length,3);
 }
});
test('Disliked aliases, repeated tracks, and artist concentration stay blocked',()=>{
 const id='11111111-1111-4111-8111-111111111111',a={...rating(1),recordingId:id},b={...rating(2,'skip'),recordingId:id};
 const s=state([a,b,rating(3),{...rating(4),artist:'Singer 3'},{...rating(5),artist:'Singer 3'}]);
 const out=fillWithRatedSongs([song(3)],s,'Telugu');assert.equal(out.length,2);assert(!out.some(t=>t.recordingId===id));assert.equal(new Set(out.map(songKey)).size,out.length);
});
test('Language can come from a verified prior batch or cache, never a country or guessed batch language',()=>{
 const t=song(1),s=state([rating(1,'replay',[])]);
 s.batch={items:[{...t,language:'Hindi',languageBasis:'AI estimate',country:'IN'}]};assert.deepEqual(verifiedSongLanguages(t,s),[]);
 s.batch.items[0].languageBasis='MusicBrainz work lyrics language';assert.deepEqual(verifiedSongLanguages(t,s),['Hindi']);
 s.songDiscovery={languages:{[songKey(t)]:{labels:['Telugu'],until:Date.now()+50000}}};assert.deepEqual(verifiedSongLanguages(t,s),['Telugu']);
});
