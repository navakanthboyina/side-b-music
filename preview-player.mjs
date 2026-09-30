// One persistent player. Audio streams from the provider only after a user click.
export function installPreviewPlayer(doc,win,lookup,onActivity=()=>{}){
 const panel=doc.createElement('aside');panel.className='preview-player';panel.hidden=true;panel.setAttribute('aria-label','Song preview');
 panel.innerHTML='<div class="player-vinyl" aria-hidden="true"><span>MG</span></div><div class="player-info"><strong class="player-title"></strong><span class="player-artist"></span><p class="player-status" role="status"></p><span class="player-attribution"></span><a class="player-source" target="_blank" rel="noopener noreferrer" hidden></a><a class="player-fallback" hidden target="_blank" rel="noopener noreferrer">Find on YouTube ↗</a></div><audio controls preload="none" aria-label="30-second song preview"></audio><button class="player-close" aria-label="Close preview">×</button>';
 doc.body.append(panel);
 const audio=panel.querySelector('audio'),status=panel.querySelector('.player-status'),source=panel.querySelector('.player-source'),attribution=panel.querySelector('.player-attribution'),fallback=panel.querySelector('.player-fallback');
 let ticket=0,provider='Deezer',currentSong=null,started=false,completed=false;
 const activity=event=>{if(currentSong)Promise.resolve(onActivity({...currentSong,event,eventId:win.crypto.randomUUID()})).catch(()=>{});};
 const spinning=on=>panel.classList.toggle('is-playing',on);
 const stop=()=>{if(started&&!completed&&audio.currentTime<10)activity('skip');currentSong=null;started=false;completed=false;audio.pause();audio.removeAttribute('src');audio.load();spinning(false);};
 audio.addEventListener('playing',()=>{if(!started){started=true;activity('play');}spinning(true);status.textContent='Playing · '+provider+' preview';});
 audio.addEventListener('pause',()=>{spinning(false);if(audio.getAttribute('src'))status.textContent='Paused · '+provider+' preview';});
 audio.addEventListener('waiting',()=>{spinning(false);status.textContent='Buffering preview…';});
 audio.addEventListener('ended',()=>{spinning(false);status.textContent='Preview finished. Open the song link for more.';});
 const playbackFailed=error=>{
  spinning(false);
  const code=audio.error?.code;
  const detail=({1:'playback interrupted',2:'audio network request failed',3:'audio decoding failed',4:'audio format or URL unavailable'})[code]||
   (error?.name==='NotSupportedError'?'audio format or URL unavailable':'audio playback failed');
  status.textContent='Preview URL found, but '+detail+'. '+(win.navigator.onLine===false?'Your browser reports no internet connection. ':'')+'Retry the preview or open the provider link.';
 };
 audio.addEventListener('error',()=>{if(audio.getAttribute('src'))playbackFailed(audio.error);});
 audio.addEventListener('timeupdate',()=>{if(started&&!completed&&audio.currentTime>=15){completed=true;activity('complete');}if(audio.currentTime>=30){audio.pause();status.textContent='Preview finished. Open the song link for more.';}});
 panel.querySelector('.player-close').addEventListener('click',()=>{ticket++;stop();panel.hidden=true;doc.body.classList.remove('has-preview');});
 doc.addEventListener('click',async e=>{
  const button=e.target.closest('[data-preview]');if(!button)return;
  const mine=++ticket;stop();panel.hidden=false;doc.body.classList.add('has-preview');fallback.hidden=true;source.hidden=true;source.removeAttribute('href');source.textContent='';attribution.textContent='';
  const song={artist:button.dataset.artist,title:button.dataset.title};currentSong=song;
  fallback.href='https://www.youtube.com/results?search_query='+encodeURIComponent(song.artist+' '+song.title+' official');
  panel.querySelector('.player-title').textContent=song.title;panel.querySelector('.player-artist').textContent=song.artist;status.textContent='Finding a preview · Deezer first, then Apple…';
  try{
   const {preview,diagnostics,artwork}=await lookup(button.dataset.provider?{provider:button.dataset.provider,id:Number(button.dataset.id)}:song);if(mine!==ticket)return;
   if(artwork){try{const a=new URL(artwork);if(a.protocol==='https:'&&!a.username&&!a.password&&!a.port&&(/^(?:[a-z0-9-]+\.)+mzstatic\.com$/.test(a.hostname)||['cdn-images.dzcdn.net','coverartarchive.org'].includes(a.hostname))){const art=button.closest('.music-card')?.querySelector('.track-art');if(art){let img=art.querySelector('img');if(!img){img=doc.createElement('img');img.className='catalog-art';img.alt='';img.style.cssText='width:100%;height:100%;object-fit:cover';art.prepend(img);}img.src=a.href;img.addEventListener('error',()=>img.remove(),{once:true});}}}catch{}}
   const attempts=diagnostics?.attempts||[];const appleAttempt=attempts.find(a=>a.provider==='iTunes'&&a.outcome!=='found');
   if(!preview){fallback.hidden=false;status.textContent=attempts.some(a=>['http_error','timeout','request_failed','invalid_response','lookup_budget'].includes(a.outcome))?'Preview lookup is temporarily unavailable from one or more providers. Try later or find the song on YouTube.':'No matching preview available. Find the song on YouTube.';attribution.textContent=attempts.map(a=>(a.provider==='iTunes'?'Apple':a.provider)+': '+(a.limitSource==='room_budget'?'shared lookup limit reached':a.limitSource==='provider_cooldown'?'temporarily paused after provider error':a.outcome.replaceAll('_',' ')+(a.status&&a.status!==200?' (HTTP '+a.status+')':''))).join(' · ');return;}
   const u=new URL(preview.url),link=new URL(preview.link);
   const clean=x=>x.protocol==='https:'&&!x.username&&!x.password&&!x.port;
   const apple=/^(?:[a-z0-9-]+\.)*(?:itunes\.apple\.com|mzstatic\.com)$/.test(u.hostname)&&['music.apple.com','itunes.apple.com'].includes(link.hostname);
   const deezer=/^(?:[a-z0-9-]+\.)*(?:dzcdn\.net|deezer\.com)$/.test(u.hostname)&&link.origin==='https://www.deezer.com'&&/^\/track\/\d+$/.test(link.pathname);
   if(!clean(u)||!clean(link)||(!apple&&!deezer))throw Error('Invalid preview');
   provider=apple?'iTunes':'Deezer';source.href=link.href;source.hidden=false;
   if(apple){
    attribution.textContent='Preview provided courtesy of iTunes';
    const badge=doc.createElement('img');badge.src='https://tools.applemediaservices.com/api/badges/download-on-itunes/badge/en-us?size=250x83';badge.alt='Download on iTunes';badge.width=120;badge.height=40;source.append(badge);
   }else {source.textContent='Listen on Deezer ↗';if(appleAttempt)attribution.textContent='Apple: '+(appleAttempt.limitSource==='room_budget'?'shared lookup limit reached':appleAttempt.limitSource==='provider_cooldown'?'temporarily paused after provider error':appleAttempt.outcome.replaceAll('_',' ')+(appleAttempt.status?' (HTTP '+appleAttempt.status+')':''))+' · using Deezer';}
   audio.src=u.href;status.textContent='Ready · press play for a 30-second preview';
   try{await audio.play();}catch(error){if(mine===ticket){if(error?.name==='NotAllowedError')status.textContent='Ready · press play to start the preview';else if(error?.name!=='AbortError')playbackFailed(error);}}
  }catch{if(mine===ticket){fallback.hidden=false;status.textContent='Preview unavailable. Please try again or find the song on YouTube.';}}
 });
 win.addEventListener('pagehide',()=>{ticket++;stop();});
 return {audio,panel};
}
