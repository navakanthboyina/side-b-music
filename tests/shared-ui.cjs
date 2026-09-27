const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
(async()=>{
 const {startShared}=await import('../shared-app.mjs');
 let room={revision:0,recommenderVersion:2,batch:{relevanceVersion:2,at:Date.now(),items:[{artist:'Fixture Artist',title:'First',reason:'Test',aiSong:true},{artist:'Fixture Artist',title:'Second',reason:'Test',aiSong:true}]},songRatings:{},seedSongCount:0},fail=false;
 const clients=[];
 async function boot(){const dom=new JSDOM(fs.readFileSync(new URL('../index.html','file://'+__filename),'utf8'),{url:'https://music.example',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  w.eval(fs.readFileSync(new URL('../data.js','file://'+__filename),'utf8'));w.setInterval=()=>0;
  w.localStorage.setItem('side-b-v1',JSON.stringify({songRatings:{private:'must not publish'}}));
  w.fetch=async(url,opt)=>{
   assert(!String(opt.body).includes('private'));
   if(fail)return {ok:false,json:async()=>({error:'Service unavailable'})};
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
 for(const dom of clients)dom.window.close();
 console.log('PASS: two independent browser sessions show shared picks and feedback; same-artist songs remain independent; failed feedback never appears saved; private local data is not published.');
})().catch(error=>{console.error(error);process.exitCode=1;});
