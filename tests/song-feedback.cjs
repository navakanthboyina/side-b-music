const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const root=require('node:path').resolve(__dirname,'..')+'/';
(async()=>{
const core=await import(root+'ai-core.mjs');let scenario='success',lastProfile;
const base={version:1,engine:'ai',ratings:{sameartist:{name:'Same Artist',value:'skip'}},imports:[],seeds:[],explored:[],filters:{language:'All languages',mood:'Any mood'},cache:{at:Date.now(),filter:'All languages|Any mood',items:['One','Two','Three'].map(title=>({title,artist:'Same Artist',seed:'Same Artist',language:'English',mood:'Warm',reason:'Existing pick',ai:true}))}};
function boot(saved){const dom=new JSDOM(fs.readFileSync(root+'index.html','utf8'),{url:'https://example.test',runScripts:'outside-only'}),w=dom.window,d=w.document;w.localStorage.setItem('side-b-v1',saved);w.setTimeout=()=>0;w.__core=core;
w.__client={stop(){},async recommend(p){lastProfile=p;if(scenario==='failure'){const error=Error('AI unavailable');error.diagnostics={rejected:{invalidLabels:1},response:'<img src=x onerror=alert(1)>'};throw error;}return [{name:'Same Artist',artist:'Same Artist',title:'New Song',language:'English',mood:'Warm',reason:'Similar melody to One.'},{name:'Same Artist',artist:'Same Artist',title:'Nonexistent',language:'English',mood:'Warm',reason:'Should not match.'}];}};
d.head.append=el=>{const u=new URL(el.src);assert.equal(u.searchParams.get('attribute'),'songTerm');queueMicrotask(()=>w[u.searchParams.get('callback')]({results:[{artistName:'Same Artist',trackName:'New Song'},{artistName:'Same Artist',trackName:'Unrelated Track'},{artistName:'Wrong Artist',trackName:'Nonexistent'}]}));};
w.eval(fs.readFileSync(root+'data.js','utf8'));w.eval(fs.readFileSync(root+'app.js','utf8').replaceAll("import('./ai-client.mjs?v=labels-fix-1')","Promise.resolve(window.__client)").replaceAll("import('./ai-core.mjs?v=labels-fix-1')","Promise.resolve(window.__core)"));
return {dom,w,d};}
let {dom,w,d}=boot(JSON.stringify(base));
assert.equal(d.querySelectorAll('#feed .music-card').length,3); // Old artist skip is ignored.
const button=(title,rating)=>d.querySelector(`#feed [data-title="${title}"][data-rating="${rating}"]`);
button('One','replay').click();assert.equal(button('One','replay').getAttribute('aria-pressed'),'true');assert.equal(button('Two','replay').getAttribute('aria-pressed'),'false');assert.equal(button('Three','replay').getAttribute('aria-pressed'),'false');
button('Two','skip').click();assert.equal(button('One','replay').getAttribute('aria-pressed'),'true');assert.equal(button('Two','skip').getAttribute('aria-pressed'),'true');assert.equal(button('Three','skip').getAttribute('aria-pressed'),'false');
assert.equal(d.querySelector('#liked-count').textContent,'1');const saved=w.localStorage.getItem('side-b-v1');dom.window.close();({dom,w,d}=boot(saved));
assert.equal(button('One','replay').getAttribute('aria-pressed'),'true');assert.equal(button('Two','skip').getAttribute('aria-pressed'),'true');assert.equal(button('Three','replay').getAttribute('aria-pressed'),'false');
d.querySelector('#refresh').click();await new Promise(r=>setImmediate(r));
assert(lastProfile.feedback.some(t=>t.title==='One'&&t.rating==='replay'));assert(lastProfile.feedback.some(t=>t.title==='Two'&&t.rating==='skip'));
assert.equal(d.querySelectorAll('#feed .music-card').length,1);assert.match(d.querySelector('#feed').textContent,/New Song/);assert(!d.querySelector('#feed').textContent.includes('Unrelated Track'));assert.match(d.querySelector('#feed').textContent,/AI SONG PICK/);
assert.equal(JSON.parse(w.localStorage.getItem('side-b-v1')).cache.items[0].aiSong,true);
button('New Song','replay').click();button('New Song','replay').click();assert.equal(button('New Song','replay').getAttribute('aria-pressed'),'false');
scenario='failure';d.querySelector('#refresh').click();await new Promise(r=>setImmediate(r));assert.match(d.querySelector('#feed').textContent,/New Song/);assert(!d.querySelector('#refresh').disabled);assert(!d.querySelector('#ai-diagnostics').hidden);assert.match(d.querySelector('#ai-diagnostic-text').textContent,/invalidLabels/);assert.equal(d.querySelectorAll('#ai-diagnostic-text img').length,0);
dom.window.close();console.log('PASS: independent same-artist song ratings, persistence, undo, legacy artist ratings ignored, song feedback reaches AI, exact title/artist validation, no unrelated substitutions, error preserves results.');
})().catch(e=>{console.error(e);process.exitCode=1});
