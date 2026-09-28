// One persistent player per browser. Catalog previews load only after a click.
export function installPreviewPlayer(doc,win,lookup){
 const panel=doc.createElement('aside');panel.className='preview-player';panel.hidden=true;panel.setAttribute('aria-label','Deezer song preview');
 panel.innerHTML='<div class="player-vinyl" aria-hidden="true"><span>MG</span></div><div class="player-info"><strong class="player-title"></strong><span class="player-artist"></span><p class="player-status" role="status"></p><a class="player-source" target="_blank" rel="noopener noreferrer" hidden>Listen on Deezer ↗</a></div><audio controls preload="none" aria-label="30-second song preview"></audio><button class="player-close" aria-label="Close preview">×</button>';
 doc.body.append(panel);const audio=panel.querySelector('audio'),status=panel.querySelector('.player-status'),source=panel.querySelector('.player-source');let ticket=0;
 const spinning=on=>panel.classList.toggle('is-playing',on);
 const stop=()=>{audio.pause();audio.removeAttribute('src');audio.load();spinning(false);};
 audio.addEventListener('playing',()=>{spinning(true);status.textContent='Playing · Deezer preview';});
 audio.addEventListener('pause',()=>{spinning(false);if(audio.getAttribute('src'))status.textContent='Paused · Deezer preview';});
 audio.addEventListener('waiting',()=>{spinning(false);status.textContent='Buffering preview…';});
 audio.addEventListener('ended',()=>{spinning(false);status.textContent='Preview finished. Listen in full on Deezer.';});
 audio.addEventListener('error',()=>{spinning(false);status.textContent='Preview could not play. Use the listening links instead.';});
 // Keep the experience a short preview even if the provider changes clip duration.
 audio.addEventListener('timeupdate',()=>{if(audio.currentTime>=30){audio.pause();status.textContent='Preview finished. Listen in full on Deezer.';}});
 panel.querySelector('.player-close').addEventListener('click',()=>{ticket++;stop();panel.hidden=true;doc.body.classList.remove('has-preview');});
 doc.addEventListener('click',async e=>{
  const button=e.target.closest('[data-preview]');if(!button)return;
  const mine=++ticket;stop();panel.hidden=false;doc.body.classList.add('has-preview');source.hidden=true;source.removeAttribute('href');
  const song={artist:button.dataset.artist,title:button.dataset.title};panel.querySelector('.player-title').textContent=song.title;panel.querySelector('.player-artist').textContent=song.artist;status.textContent='Finding a Deezer preview…';
  try{
   const {preview}=await lookup(song);if(mine!==ticket)return;
   if(!preview){status.textContent='No matching Deezer preview available. Try the listening links.';return;}
   const u=new URL(preview.url),link=new URL(preview.link);
   if(u.protocol!=='https:'||u.username||u.password||u.port||!/^(?:[a-z0-9-]+\.)*(?:dzcdn\.net|deezer\.com)$/.test(u.hostname)||link.origin!=='https://www.deezer.com'||!/^\/track\/\d+$/.test(link.pathname))throw Error('Invalid preview');
   source.href=link.href;source.hidden=false;audio.src=u.href;status.textContent='Ready · press play for a 30-second preview';
   try{await audio.play();}catch{if(mine===ticket)status.textContent='Ready · press play to start the preview';}
  }catch(error){if(mine===ticket)status.textContent='Preview unavailable. Try the listening links instead.';}
 });
 win.addEventListener('pagehide',()=>{ticket++;stop();});
 return {audio,panel};
}
