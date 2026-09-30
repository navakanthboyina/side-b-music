// One persistent player. Audio streams from the provider only after a user click.
export function installPreviewPlayer(doc,win,lookup){
 const panel=doc.createElement('aside');panel.className='preview-player';panel.hidden=true;panel.setAttribute('aria-label','Song preview');
 panel.innerHTML='<div class="player-vinyl" aria-hidden="true"><span>MG</span></div><div class="player-info"><strong class="player-title"></strong><span class="player-artist"></span><p class="player-status" role="status"></p><span class="player-attribution"></span><a class="player-source" target="_blank" rel="noopener noreferrer" hidden></a><a class="player-fallback" target="_blank" rel="noopener noreferrer">Find on YouTube ↗</a></div><audio controls preload="none" aria-label="30-second song preview"></audio><button class="player-close" aria-label="Close preview">×</button>';
 doc.body.append(panel);
 const audio=panel.querySelector('audio'),status=panel.querySelector('.player-status'),source=panel.querySelector('.player-source'),attribution=panel.querySelector('.player-attribution'),fallback=panel.querySelector('.player-fallback');
 let ticket=0,provider='Deezer';
 const spinning=on=>panel.classList.toggle('is-playing',on);
 const stop=()=>{audio.pause();audio.removeAttribute('src');audio.load();spinning(false);};
 audio.addEventListener('playing',()=>{spinning(true);status.textContent='Playing · '+provider+' preview';});
 audio.addEventListener('pause',()=>{spinning(false);if(audio.getAttribute('src'))status.textContent='Paused · '+provider+' preview';});
 audio.addEventListener('waiting',()=>{spinning(false);status.textContent='Buffering preview…';});
 audio.addEventListener('ended',()=>{spinning(false);status.textContent='Preview finished. Open the song link for more.';});
 audio.addEventListener('error',()=>{spinning(false);status.textContent='Preview could not play. Try the YouTube search link.';});
 audio.addEventListener('timeupdate',()=>{if(audio.currentTime>=30){audio.pause();status.textContent='Preview finished. Open the song link for more.';}});
 panel.querySelector('.player-close').addEventListener('click',()=>{ticket++;stop();panel.hidden=true;doc.body.classList.remove('has-preview');});
 doc.addEventListener('click',async e=>{
  const button=e.target.closest('[data-preview]');if(!button)return;
  const mine=++ticket;stop();panel.hidden=false;doc.body.classList.add('has-preview');source.hidden=true;source.removeAttribute('href');source.textContent='';attribution.textContent='';
  const song={artist:button.dataset.artist,title:button.dataset.title};
  fallback.href='https://www.youtube.com/results?search_query='+encodeURIComponent(song.artist+' '+song.title+' official');
  panel.querySelector('.player-title').textContent=song.title;panel.querySelector('.player-artist').textContent=song.artist;status.textContent='Finding a preview · iTunes India / US, then Deezer…';
  try{
   const {preview}=await lookup(button.dataset.provider?{provider:button.dataset.provider,id:Number(button.dataset.id)}:song);if(mine!==ticket)return;
   if(!preview){status.textContent='No matching preview available. Find the song on YouTube.';return;}
   const u=new URL(preview.url),link=new URL(preview.link);
   const clean=x=>x.protocol==='https:'&&!x.username&&!x.password&&!x.port;
   const apple=/^(?:[a-z0-9-]+\.)*(?:itunes\.apple\.com|mzstatic\.com)$/.test(u.hostname)&&['music.apple.com','itunes.apple.com'].includes(link.hostname);
   const deezer=/^(?:[a-z0-9-]+\.)*(?:dzcdn\.net|deezer\.com)$/.test(u.hostname)&&link.origin==='https://www.deezer.com'&&/^\/track\/\d+$/.test(link.pathname);
   if(!clean(u)||!clean(link)||(!apple&&!deezer))throw Error('Invalid preview');
   provider=apple?'iTunes':'Deezer';source.href=link.href;source.hidden=false;
   if(apple){
    attribution.textContent='Preview provided courtesy of iTunes';
    const badge=doc.createElement('img');badge.src='https://tools.applemediaservices.com/api/badges/download-on-itunes/badge/en-us?size=250x83';badge.alt='Download on iTunes';badge.width=120;badge.height=40;source.append(badge);
   }else source.textContent='Listen on Deezer ↗';
   audio.src=u.href;status.textContent='Ready · press play for a 30-second preview';
   try{await audio.play();}catch{if(mine===ticket)status.textContent='Ready · press play to start the preview';}
  }catch{if(mine===ticket)status.textContent='Preview unavailable. Try the YouTube search link.';}
 });
 win.addEventListener('pagehide',()=>{ticket++;stop();});
 return {audio,panel};
}
