import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findPreview,applePreview} from '../backend/preview.mjs';
const song={artist:'Test Singer',title:'Test Song'};
const apple={trackId:42,artistName:song.artist,trackName:song.title,previewUrl:'https://audio-ssl.itunes.apple.com/clip.m4a',trackViewUrl:'https://music.apple.com/in/album/example/12?i=42'};
test('India preview wins; US is tried when India has no exact match',async()=>{
 for(const winning of ['IN','US']){
  const calls=[];
  const preview=await findPreview(song,async input=>{const u=new URL(input);calls.push(u.searchParams.get('country'));return Response.json({results:u.searchParams.get('country')===winning?[apple]:[]});});
  assert.equal(preview.source,'iTunes');assert.equal(preview.country,winning);
  assert.deepEqual(calls,winning==='IN'?['IN']:['IN','US']);assert.match(preview.attribution,/courtesy of iTunes/);
 }
});
test('Apple 429 falls back directly to Deezer without another country request',async()=>{
 const calls=[];const p=await findPreview(song,async input=>{const u=new URL(input);calls.push(u.hostname);return u.hostname==='itunes.apple.com'?new Response('',{status:429}):Response.json({data:[{id:23,artist:{name:song.artist},title:song.title,preview:'https://cdn-preview-a.dzcdn.net/clip.mp3'}]});});
 assert.equal(p.source,'Deezer');assert.deepEqual(calls,['itunes.apple.com','api.deezer.com']);
});
test('Wrong versions, wrong artists and unsafe media/store URLs are rejected',async()=>{
 for(const track of [{...apple,trackName:'Test Song (Remix)'},{...apple,artistName:'Other Singer'},{...apple,previewUrl:'https://evil.example/clip.mp3'},{...apple,trackViewUrl:'https://music.apple.com.evil.example/song'}]){
  assert.equal(await findPreview(song,async u=>Response.json(new URL(u).hostname==='itunes.apple.com'?{results:[track]}:{data:[]})),null);
 }
 assert.equal(applePreview({...apple,trackViewUrl:'javascript:alert(1)'}),null);
});
test('Both provider failures return no preview without inventing a playable track',async()=>{
 assert.equal(await findPreview(song,async()=>{throw Error('Offline');}),null);
});
test('Apple multiple credits match a credited singer and record a safe diagnostic',async()=>{
 const diagnostics={};const p=await findPreview(song,async()=>Response.json({results:[{...apple,artistName:'Composer & Test Singer'}]}),diagnostics);
 assert.equal(p.source,'iTunes');assert.equal(diagnostics.attempts[0].outcome,'found');assert.equal(diagnostics.attempts[0].identityMatches,1);
 assert(!JSON.stringify(diagnostics).includes(song.title));
});
test('Preview diagnostics distinguish Apple 429 from absent Deezer identity',async()=>{
 const d={};assert.equal(await findPreview(song,async u=>new URL(u).hostname==='itunes.apple.com'?new Response('',{status:429}):Response.json({data:[]}),d),null);
 assert.deepEqual(d.attempts.map(a=>a.outcome),['http_error','no_matching_song']);assert.equal(d.attempts[0].status,429);
});
