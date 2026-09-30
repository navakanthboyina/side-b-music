import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {catalogFetcher} from '../backend/catalog-access.mjs';
import {resolveResource} from '../backend/resources.mjs';
import {tailParser} from '../backend/tail-parser.mjs';
function db(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE limits(key TEXT PRIMARY KEY,count INTEGER,expires INTEGER); CREATE TABLE song_resources(key TEXT PRIMARY KEY,data TEXT,expires INTEGER)');
 return {sqlite,prepare:sql=>({bind:(...args)=>({first:async()=>sqlite.prepare(sql).get(...args),run:async()=>({meta:{changes:sqlite.prepare(sql).run(...args).changes}})})})};
}
test('Upstream 429 pauses Apple across requests, honors Retry-After, and leaves Deezer available',async()=>{
 const DB=db();let now=100000,calls=[];
 const get=catalogFetcher({DB,CATALOG_FETCH:async u=>{calls.push(u);return new Response('',{status:u.includes('apple')?429:200,headers:{'retry-after':'600'}});}},()=>now);
 const first=await get('https://itunes.apple.com/search');assert.equal(first.headers.get('x-munna-limit-source'),null);
 const second=await get('https://itunes.apple.com/search?different');assert.equal(second.headers.get('x-munna-limit-source'),'provider_cooldown');assert.equal(second.headers.get('retry-after'),'600');
 assert.equal((await get('https://api.deezer.com/search')).status,200);assert.equal(calls.length,2);
 now+=600001;await get('https://itunes.apple.com/search');assert.equal(calls.length,3);DB.sqlite.close();
});
test('Room budget produces a distinct 429 without blaming the upstream provider',async()=>{
 const DB=db();let calls=0;const get=catalogFetcher({DB,CATALOG_FETCH:async()=>{calls++;return Response.json({results:[]});}},()=>100000);
 for(let i=0;i<18;i++)await get('https://itunes.apple.com/search');
 const r=await get('https://itunes.apple.com/search');assert.equal(r.headers.get('x-munna-limit-source'),'room_budget');assert.equal(calls,18);DB.sqlite.close();
});
test('Working Deezer fallback stays cached for six hours despite Apple throttling',async()=>{
 const DB=db(),song={artist:'Singer',title:'Track'};let calls=0;
 const get=async u=>{calls++;return u.includes('apple')?new Response('',{status:429}):Response.json({data:[{id:1,title:'Track',artist:{name:'Singer'},preview:'https://cdn-preview-a.dzcdn.net/test.mp3'}]});};
 const a=await resolveResource(DB,song,get),before=calls;assert.equal(a.preview.source,'Deezer');
 const row=DB.sqlite.prepare('SELECT expires FROM song_resources').get();assert(row.expires>Date.now()+5*3600000);
 const stats={};await resolveResource(DB,song,get,stats);assert.equal(calls,before);assert(stats.cacheHit);DB.sqlite.close();
});
test('Tail parser keeps stdout connection errors and split JSON events',()=>{
 const events=[],messages=[],consume=tailParser(e=>events.push(e),m=>messages.push(m));
 const event={outcome:'exceededCpu',event:{request:{url:'https://example.com/state'}},logs:[{level:'warn',message:['braces { inside a string }']}]};
 const output='Login required\n'+JSON.stringify(event,null,2)+'\n';
 for(let i=0;i<output.length;i+=7)consume(output.slice(i,i+7));
 assert.deepEqual(events,[event]);assert.deepEqual(messages,['Login required']);
});
