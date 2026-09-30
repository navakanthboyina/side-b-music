const assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const {installPreviewPlayer}=await import('../preview-player.mjs');
 const dom=new JSDOM('<button data-preview data-title="First" data-artist="Artist">Play</button><button data-preview data-title="Second" data-artist="Artist">Play</button>'),w=dom.window,d=w.document;
 let plays=0,pauses=0;w.HTMLMediaElement.prototype.play=function(){plays++;this.dispatchEvent(new w.Event('playing'));return Promise.resolve();};w.HTMLMediaElement.prototype.pause=function(){pauses++;this.dispatchEvent(new w.Event('pause'));};w.HTMLMediaElement.prototype.load=function(){};
 let resolveFirst,lastLookup;const p=installPreviewPlayer(d,w,async song=>(lastLookup=song,song.title==='First'?new Promise(r=>resolveFirst=r):{preview:{url:'https://cdn-preview-a.dzcdn.net/second.mp3',link:'https://www.deezer.com/track/2'}}));
 const buttons=d.querySelectorAll('[data-preview]');buttons[0].click();buttons[1].click();await new Promise(r=>setImmediate(r));assert(p.panel.classList.contains('is-playing'));assert.equal(plays,1);assert(pauses>=2);assert(p.panel.querySelector('.player-fallback').hidden);
 resolveFirst({preview:{url:'https://cdn-preview-a.dzcdn.net/first.mp3',link:'https://www.deezer.com/track/1'}});await new Promise(r=>setImmediate(r));assert(p.audio.src.endsWith('second.mp3'));assert.equal(plays,1);
 p.audio.dispatchEvent(new w.Event('waiting'));assert(!p.panel.classList.contains('is-playing'));p.audio.dispatchEvent(new w.Event('playing'));assert(p.panel.classList.contains('is-playing'));p.audio.pause();assert(!p.panel.classList.contains('is-playing'));p.audio.dispatchEvent(new w.Event('ended'));assert.match(p.panel.textContent,/Preview finished/);
 p.panel.querySelector('.player-close').click();assert(p.panel.hidden);assert.equal(p.audio.getAttribute('src'),null);
 buttons[0].click();p.panel.querySelector('.player-close').click();resolveFirst({preview:{url:'https://cdn-preview-a.dzcdn.net/first.mp3',link:'https://www.deezer.com/track/1'}});await new Promise(r=>setImmediate(r));assert.equal(plays,1);assert(p.panel.hidden);
 buttons[0].click();resolveFirst({preview:null});await new Promise(r=>setImmediate(r));assert.match(p.panel.textContent,/No matching preview/);assert(!p.panel.querySelector('.player-fallback').hidden);assert.equal(plays,1);
 buttons[0].click();resolveFirst({preview:{url:'https://evil.example/music.mp3',link:'https://www.deezer.com/track/1'}});await new Promise(r=>setImmediate(r));assert.match(p.panel.textContent,/Preview unavailable/);assert.equal(plays,1);
 p.audio.play=()=>Promise.reject(Object.assign(Error('Gesture required'),{name:'NotAllowedError'}));buttons[1].click();await new Promise(r=>setImmediate(r));assert.match(p.panel.textContent,/press play to start/);assert(!p.panel.classList.contains('is-playing'));
 buttons[1].dataset.provider='deezer';buttons[1].dataset.id='42';buttons[1].click();await new Promise(r=>setImmediate(r));assert.deepEqual(lastLookup,{provider:'deezer',id:42});

 buttons[0].click();resolveFirst({preview:{source:'iTunes',url:'https://audio-ssl.itunes.apple.com/clip.m4a',link:'https://music.apple.com/in/album/example/123?i=456'}});
 await new Promise(r=>setImmediate(r));assert(p.audio.src.includes('itunes.apple.com'));assert(p.panel.querySelector('.player-fallback').hidden);assert.match(p.panel.textContent,/provided courtesy of iTunes/);
 assert.equal(p.panel.querySelector('.player-source img').alt,'Download on iTunes');assert(p.panel.querySelector('.player-fallback').href.startsWith('https://www.youtube.com/results?'));
 dom.window.close();console.log('PASS: preview events, one-player switching, stale lookups and closing while loading.');
})().catch(e=>{console.error(e);process.exitCode=1});

(async()=>{
 const {installPreviewPlayer}=await import('../preview-player.mjs');
 const dom=new JSDOM('<button data-preview data-title="Song" data-artist="Singer">Preview</button>'),w=dom.window,d=w.document,events=[];
 w.HTMLMediaElement.prototype.play=function(){this.dispatchEvent(new w.Event('playing'));return Promise.resolve();};w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};
 const p=installPreviewPlayer(d,w,async()=>({preview:{url:'https://audio-ssl.itunes.apple.com/clip.m4a',link:'https://music.apple.com/in/album/a/1?i=2'}}),e=>events.push(e));
 assert.equal(events.length,0);d.querySelector('button').click();await new Promise(r=>setImmediate(r));
 assert.equal(events.filter(e=>e.event==='play').length,1);p.audio.dispatchEvent(new w.Event('playing'));assert.equal(events.length,1);
 p.audio.currentTime=16;p.audio.dispatchEvent(new w.Event('timeupdate'));p.audio.dispatchEvent(new w.Event('timeupdate'));
 assert.equal(events.filter(e=>e.event==='complete').length,1);assert(events.every(e=>e.artist==='Singer'&&e.eventId));
 dom.window.close();console.log('PASS: actual playback events are emitted once; lookup alone is not a listen.');
})().catch(e=>{console.error(e);process.exitCode=1});

(async()=>{
 const {installPreviewPlayer}=await import('../preview-player.mjs');
 const dom=new JSDOM('<button data-preview data-title="Song" data-artist="Singer">Preview</button>'),w=dom.window,d=w.document;
 w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};
 const p=installPreviewPlayer(d,w,async()=>({preview:null,diagnostics:{attempts:[{provider:'iTunes',outcome:'http_error',status:429,limitSource:'provider_cooldown'},{provider:'Deezer',outcome:'no_matching_song',status:200}]}}));
 d.querySelector('button').click();await new Promise(r=>setImmediate(r));
 assert.match(p.panel.textContent,/temporarily unavailable/);assert.match(p.panel.textContent,/temporarily paused/);assert.match(p.panel.textContent,/Deezer: no matching song/);assert(!p.panel.querySelector('.player-fallback').hidden);
 dom.window.close();console.log('PASS: provider outages and absent Deezer matches are reported separately.');
})().catch(e=>{console.error(e);process.exitCode=1});
(async()=>{
 const {installPreviewPlayer}=await import('../preview-player.mjs');
 const dom=new JSDOM('<button data-preview data-title="Song" data-artist="Singer">Preview</button>'),w=dom.window,d=w.document;
 w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};
 w.HTMLMediaElement.prototype.play=function(){return Promise.reject(Object.assign(Error('Cannot play'),{name:'NotSupportedError'}));};
 const p=installPreviewPlayer(d,w,async()=>({preview:{url:'https://cdn-preview-a.dzcdn.net/clip.mp3',link:'https://www.deezer.com/track/1'}}));
 d.querySelector('button').click();await new Promise(r=>setImmediate(r));assert.match(p.panel.textContent,/Preview URL found, but audio format or URL unavailable/);assert(!p.panel.textContent.includes('press play to start'));
 Object.defineProperty(p.audio,'error',{value:{code:2}});p.audio.dispatchEvent(new w.Event('error'));assert.match(p.panel.textContent,/audio network request failed/);
 dom.window.close();console.log('PASS: autoplay permission and actual audio failures are distinguished.');
})().catch(e=>{console.error(e);process.exitCode=1});
(async()=>{
 const {installPreviewPlayer}=await import('../preview-player.mjs');
 const dom=new JSDOM('<article class="music-card"><div class="track-art"></div><button data-preview data-title="Song" data-artist="Singer">Preview</button></article>'),w=dom.window,d=w.document;
 w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};w.HTMLMediaElement.prototype.play=async function(){};
 installPreviewPlayer(d,w,async()=>({artwork:'https://cdn-images.dzcdn.net/images/cover/test/500.jpg',preview:{url:'https://cdn-preview-a.dzcdn.net/clip.mp3',link:'https://www.deezer.com/track/1'}}));
 d.querySelector('button').click();await new Promise(r=>setImmediate(r));assert.match(d.querySelector('.track-art img').src,/cdn-images.dzcdn.net/);
 dom.window.close();console.log('PASS: preview lookup restores matched Deezer artwork on the song card.');
})().catch(e=>{console.error(e);process.exitCode=1});
(async()=>{
 const {installPreviewPlayer}=await import('../preview-player.mjs');
 const dom=new JSDOM('<button data-preview data-title="Song" data-artist="Singer">Preview</button>'),w=dom.window,d=w.document;
 w.HTMLMediaElement.prototype.pause=function(){this.dispatchEvent(new w.Event('pause'));};w.HTMLMediaElement.prototype.load=function(){};w.HTMLMediaElement.prototype.play=async function(){this.dispatchEvent(new w.Event('playing'));};
 const p=installPreviewPlayer(d,w,async()=>({preview:{url:'https://cdn-preview-a.dzcdn.net/clip.mp3',link:'https://www.deezer.com/track/1'},diagnostics:{cacheHit:true,historicalAttempts:[{provider:'iTunes',outcome:'http_error',status:429,limitSource:'provider_cooldown'}]}}));
 d.querySelector('button').click();await new Promise(r=>setImmediate(r));assert(!p.panel.textContent.includes('Apple:'));assert.match(p.panel.textContent,/saved preview/);
 p.audio.pause();assert.match(p.panel.textContent,/Playback paused · press ▶ to resume/);
 Object.defineProperty(p.audio,'error',{value:{code:2}});p.audio.dispatchEvent(new w.Event('error'));p.audio.pause();assert.match(p.panel.textContent,/audio network request failed/);
 dom.window.close();console.log('PASS: cached Apple warnings do not obscure a working Deezer preview; playback failure survives pause events.');
})().catch(e=>{console.error(e);process.exitCode=1});
