const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
(async()=>{
 const {startShared}=await import('../shared-app.mjs');
 let room={revision:0,recommenderVersion:2,batch:{relevanceVersion:2,at:Date.now(),items:[{artist:'Fixture Artist',title:'First',reason:'Test',aiSong:true},{artist:'Fixture Artist',title:'Second',reason:'Test',aiSong:true}]},songRatings:{},seedSongCount:0},fail=false,lastRefresh=null;
 const clients=[];
 async function boot(){const dom=new JSDOM(fs.readFileSync(new URL('../index.html','file://'+__filename),'utf8'),{url:'https://music.example',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  w.eval(fs.readFileSync(new URL('../data.js','file://'+__filename),'utf8'));w.setInterval=()=>0;
  w.localStorage.setItem('side-b-v1',JSON.stringify({songRatings:{private:'must not publish'}}));
  w.fetch=async(url,opt)=>{
   assert(!String(opt.body).includes('private'));
   if(fail)return {ok:false,json:async()=>({error:'Service unavailable'})};
   if(url.endsWith('/refresh')){lastRefresh=JSON.parse(opt.body);room.batch.language=lastRefresh.language;room.revision++;}
   if(url.endsWith('/search'))return {ok:true,json:async()=>({songs:[{provider:'apple',id:42,artist:'Search Fixture',title:'Search Song'}]})};
   if(url.endsWith('/taste/add')){const t=JSON.parse(opt.body);assert.deepEqual(t,{provider:'apple',id:42});room.revision++;room.songRatings['track:searchfixture:searchsong']={artist:'Search Fixture',title:'Search Song',value:'replay',at:Date.now()};room.pendingSongCount=0;}
   if(url.endsWith('/feedback')){const t=JSON.parse(opt.body);room.revision++;room.songRatings['track:fixtureartist:'+t.title.toLowerCase()]={artist:t.artist,title:t.title,value:t.rating,at:Date.now()};}
   return {ok:true,json:async()=>structuredClone(room)};
  };
  const api=await startShared({apiBase:'https://backend.example'},w.SIDE_B_DATA,w.document,w);clients.push(dom);return {w,d:w.document,api};
 }
 const a=await boot(),b=await boot();assert.equal(a.d.querySelector('#feed').textContent,b.d.querySelector('#feed').textContent);
 a.d.querySelector('#feed [data-title="First"][data-shared-rating="replay"]').click();await new Promise(r=>setImmediate(r));await b.api.sync();
 assert.equal(b.d.querySelector('#feed [data-title="First"]').getAttribute('aria-pressed'),'true');
 assert.equal(b.d.querySelector('#feed [data-title="Second"]').getAttribute('aria-pressed'),'false');
 assert.equal(b.d.querySelector('#csv-import'),null);assert(!b.d.querySelector('.ai-panel').textContent.includes('WebGPU'));
 fail=true;b.d.querySelector('#feed [data-title="Second"]').click();await new Promise(r=>setImmediate(r));
 assert.match(b.d.querySelector('#ai-status').textContent,/Feedback was not saved/);assert.equal(Object.keys(room.songRatings).length,1);
 assert.equal(b.d.querySelector('#feed [data-title="Second"]').getAttribute('aria-pressed'),'false');
 fail=false;room.revision++;room.needsTasteImport=true;room.batch.relevanceVersion=1;
 await b.api.sync();assert.equal(b.d.querySelector('#feed .music-card'),null);
 assert.equal(b.d.querySelector('#refresh').disabled,true);assert.match(b.d.querySelector('#ai-status').textContent,/re-import/);
 room.revision++;room.needsTasteImport=false;room.batch.relevanceVersion=2;room.batch.items[0].reason='AI-estimated fit: <script>bad()</script>';
 await b.api.sync();assert.equal(b.d.querySelector('#refresh').disabled,false);
 assert.equal(b.d.querySelector('#feed script'),null);assert.match(b.d.querySelector('#feed').textContent,/AI-estimated fit/);
 b.d.querySelector('[data-shared-week="2"]').click();
 assert.equal(b.d.querySelectorAll('#plan-cards .music-card').length,1);
 assert.match(b.d.querySelector('#plan-cards').textContent,/Second/);
 room.revision++;room.pendingSongCount=8;await b.api.sync();
 assert.match(b.d.querySelector('#ai-status').textContent,/8\/12 approved songs/);
 room.revision++;room.batch.items=Array.from({length:12},(_,i)=>({artist:'Artist '+i,title:'Song '+i,aiSong:true,reason:'Fixture'}));await b.api.sync();
 assert.equal(b.d.querySelectorAll('#plan-cards .music-card').length,6);
 b.d.querySelector('[data-shared-week="1"]').click();assert.equal(b.d.querySelectorAll('#plan-cards .music-card').length,6);
 b.d.querySelector('#song-query').value='Search Song';b.d.querySelector('#song-search').dispatchEvent(new b.w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setImmediate(r));
 assert.match(b.d.querySelector('#song-search-results').textContent,/Search Song/);
 b.d.querySelector('[data-add-taste]').click();await new Promise(r=>setImmediate(r));await a.api.sync();
 assert.match(b.d.querySelector('#song-search-status').textContent,/Added/);assert.equal(b.d.querySelector('[data-add-taste]').disabled,true);
 assert.match(a.d.querySelector('#shared-ratings').textContent,/Search Song/);
 assert.equal(b.d.querySelector('[data-language="Telugu"]').disabled,true);
 room.languages=['Mixed','Telugu','Hindi'];room.pendingSongCount=0;room.revision++;await b.api.sync();
 b.d.querySelector('[data-language="Telugu"]').click();assert.equal(lastRefresh,null);assert.equal(b.d.querySelector('[data-language="Telugu"]').getAttribute('aria-pressed'),'true');
 b.d.querySelector('#refresh').click();await new Promise(r=>setImmediate(r));assert.deepEqual(lastRefresh,{language:'Telugu'});await a.api.sync();assert.match(a.d.querySelector('#feed-status').textContent,/Telugu mix/);
 for(const dom of clients)dom.window.close();
 console.log('PASS: two independent browser sessions show shared picks and feedback; same-artist songs remain independent; failed feedback never appears saved; private local data is not published.');
})().catch(error=>{console.error(error);process.exitCode=1;});
