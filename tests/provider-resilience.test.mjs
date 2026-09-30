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
 for(let i=0;i<10;i++)await get('https://itunes.apple.com/search');
 const r=await get('https://itunes.apple.com/search');assert.equal(r.headers.get('x-munna-limit-source'),'room_budget');assert.equal(calls,10);DB.sqlite.close();
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
test('CPU diagnostic never confuses cpuTime plus preview limitSource with a CPU failure',async()=>{
 const {cpuLimitExceeded}=await import('../backend/tail-parser.mjs');
 assert.equal(cpuLimitExceeded({outcome:'ok',cpuTime:219,exceptions:[],logs:[{level:'warn',message:'{"event":"munna-preview","limitSource":"provider_cooldown"}'}]}),false);
 assert.equal(cpuLimitExceeded({outcome:'exceededCpu',cpuTime:10}),true);
 assert.equal(cpuLimitExceeded({outcome:'exception',exceptions:[{message:'Worker exceeded CPU time limit.'}]}),true);
});

test('Apple budget cannot double-burst over a clock minute boundary',async()=>{
 const DB=db();let now=59000,calls=0;const get=catalogFetcher({DB,CATALOG_FETCH:async()=>{calls++;return Response.json({results:[]});}},()=>now);
 for(let i=0;i<10;i++)await get('https://itunes.apple.com/search');
 now=61000;assert.equal((await get('https://itunes.apple.com/search')).headers.get('x-munna-limit-source'),'room_budget');assert.equal(calls,10);
 now=119001;assert.equal((await get('https://itunes.apple.com/search')).status,200);assert.equal(calls,11);DB.sqlite.close();
});
test('Repeated Apple failures back off longer; a successful probe resets the delay',async()=>{
 const DB=db();let now=100000,status=429,calls=0;const get=catalogFetcher({DB,CATALOG_FETCH:async()=>{calls++;return new Response('',{status});}},()=>now);
 await get('https://itunes.apple.com/search');now+=300001;await get('https://itunes.apple.com/search');
 assert.equal((await get('https://itunes.apple.com/search')).headers.get('retry-after'),'600');assert.equal(calls,2);
 now+=600001;status=200;await get('https://itunes.apple.com/search');assert.equal(DB.sqlite.prepare("SELECT count FROM limits WHERE key='provider-cooldown:itunes.apple.com'").get(),undefined);DB.sqlite.close();
});
test('Internal enrichment budget failures never poison the on-demand preview cache',async()=>{
 const DB=db(),song={artist:'Singer',title:'Track'},stats={};
 await resolveResource(DB,song,async()=>{throw Error('catalog_budget');},stats);
 assert.equal(stats.noStore,true);assert(stats.attempts.every(a=>a.outcome==='lookup_budget'));
 assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM song_resources').get().n,0);
 const resource=await resolveResource(DB,song,async u=>u.includes('apple')?Response.json({results:[]}):Response.json({data:[{id:1,title:'Track',artist:{name:'Singer'},album:{cover_big:'https://cdn-images.dzcdn.net/images/cover/test/500x500.jpg'},preview:'https://cdn-preview-a.dzcdn.net/test.mp3'}]}));
 assert.equal(resource.preview.source,'Deezer');assert.equal(resource.artworkSource,'Deezer');assert.match(resource.artwork,/cdn-images/);DB.sqlite.close();
});
test('Catalog cooldown records the originating HTTP status and time across requests',async()=>{
 const DB=db(),now=100000;const get=catalogFetcher({DB,CATALOG_FETCH:async()=>new Response('',{status:503})},()=>now);
 await get('https://itunes.apple.com/search');const r=await get('https://itunes.apple.com/search');
 assert.equal(r.headers.get('x-munna-original-status'),'503');assert.equal(r.headers.get('x-munna-failure-at'),String(now));assert.equal(r.headers.get('retry-after'),'300');DB.sqlite.close();
});
test('Cached preview logs separate historical failures from current provider calls',async()=>{
 const DB=db(),song={artist:'Singer',title:'Track'},saved={artist:'Singer',title:'Track',preview:{source:'Deezer',url:'https://cdn-preview-a.dzcdn.net/test.mp3',link:'https://www.deezer.com/track/1'},diagnostics:{attempts:[{provider:'iTunes',status:429,outcome:'http_error'}]}};
 const {songKey}=await import('../ai-core.mjs');DB.sqlite.prepare('INSERT INTO song_resources VALUES(?,?,?)').run(songKey(song),JSON.stringify(saved),Date.now()+60000);
 const stats={};await resolveResource(DB,song,async()=>{throw Error('must not fetch');},stats);
 assert.deepEqual(stats.attempts,[]);assert.equal(stats.historicalAttempts[0].status,429);assert.equal(stats.cachedAt,null);DB.sqlite.close();
});
