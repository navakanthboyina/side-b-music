const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const key=t=>'track:'+t.artist.split(/\s*(?:,|&|;)\s*/).map(norm).sort().join('|')+':'+norm(t.title);
const search=(artist,title)=>'https://www.youtube.com/results?search_query='+encodeURIComponent(artist+' '+title+' official');

export async function startShared({apiBase},data,doc=document,win=window) {
  const $=s=>doc.querySelector(s); let shared=null,busy=false,week=1,polling=false;
  const api=apiBase.replace(/\/$/,'');
  if(!/^https:\/\//.test(api))throw Error('The shared service needs an HTTPS URL.');
  const starter=data.artists.map(a=>({artist:a.name,title:a.track,reason:a.note}));
  const status=text=>{$('#ai-status').textContent=text;};
  async function request(path,body) {
    const response=await win.fetch(api+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(path==='/refresh'?150000:15000)});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||'Shared service unavailable.');return payload;
  }
  function accept(value) {
    if(!value||!Number.isInteger(value.revision)||!value.songRatings||!('batch' in value))throw Error('Invalid shared service response.');
    // A delayed GET must not overwrite the response to a newer feedback write.
    if(!shared||value.revision>=shared.revision)shared=value;
    render();
  }
  function controls(){doc.querySelectorAll('[data-shared-rating],#refresh').forEach(b=>b.disabled=busy||!shared);}
  function card(t,i){
    const rating=shared?.songRatings[key(t)]?.value;
    return `<article class="music-card"><div class="card-top"><span>${t.aiSong?'SHARED AI PICK':'SHARED STARTER'}</span><span>${String(i+1).padStart(2,'0')}</span></div><div class="card-body"><h3>${esc(t.title)}</h3><div class="track-title">${esc(t.artist)}</div><p>${esc(t.reason)}</p><div class="card-links"><a class="listen" href="${search(t.artist,t.title)}" target="_blank" rel="noopener noreferrer">YouTube ↗</a><a class="alt-link" href="https://soundcloud.com/search/sounds?q=${encodeURIComponent(t.artist+' '+t.title)}" target="_blank" rel="noopener noreferrer">SoundCloud</a><a class="alt-link" href="https://bandcamp.com/search?q=${encodeURIComponent(t.artist+' '+t.title)}" target="_blank" rel="noopener noreferrer">Bandcamp</a></div></div><div class="card-feedback">${[['replay','Like'],['skip','Not for us'],['known','Already know']].map(([value,label])=>`<button class="rate" data-shared-rating="${rating===value?'clear':value}" data-artist="${esc(t.artist)}" data-title="${esc(t.title)}" aria-pressed="${rating===value}" aria-label="${esc(label+' '+t.title+' for everyone')}">${label}</button>`).join('')}</div></article>`;
  }
  function render(){
    const songs=shared?.batch?.items||starter;
    $('#feed').innerHTML=songs.map(card).join('');
    $('#feed-badge').textContent=shared?.batch?'SHARED AI · 14-DAY NO REPEATS':'SHARED STARTERS';
    $('#feed-status').textContent=shared?.batch?`${songs.length} songs · shared batch saved ${new Date(shared.batch.at).toLocaleString()}`:'The first visitor to refresh will generate a shared AI batch.';
    $('.week-tabs').innerHTML=[1,2].map(n=>`<button data-shared-week="${n}" aria-pressed="${week===n}">Week ${n}<span>Mixed languages</span></button>`).join('');
    $('#week-title').textContent=`Week ${week} · the shared mix`;
    $('#week-description').textContent='Songs from the current shared batch. Refresh replaces this plan for everyone.';
    $('#plan-count').textContent=`${songs.length} shared songs`;
    $('#plan-cards').innerHTML=songs.slice((week-1)*6,week*6).map(card).join('')||'<p class="empty">This batch has fewer than seven songs. Listen to Week 1, or refresh for a new batch.</p>';
    const ratings=Object.values(shared?.songRatings||{}).sort((a,b)=>b.at-a.at);
    $('#shared-count').textContent=String(shared?.seedSongCount||0);
    $('#shared-likes').textContent=String(ratings.filter(r=>r.value==='replay').length);
    $('#shared-ratings').innerHTML=ratings.map(t=>`<div class="rating-row"><div><strong>${esc(t.title)}</strong> · ${esc(t.artist)}<br><span>${({replay:'More songs like this',skip:'Exclude this song',known:'Already known'})[t.value]||''}</span></div><button class="secondary" data-shared-rating="clear" data-artist="${esc(t.artist)}" data-title="${esc(t.title)}">Clear for everyone</button></div>`).join('')||'<p>No shared feedback yet. Rate a song in Discover.</p>';
    $('.side-sources .small').textContent=shared?.seedSongCount?`${shared.seedSongCount} playlist songs guide catalog discovery. No Spotify sync.`:'Playlist starting taste has not been uploaded by the owner yet.';
    controls();
  }
  function navigate(){
    const hash=win.location.hash.slice(1),view=['discover','plan','comfort','profile'].includes(hash)?hash:'discover';
    doc.querySelectorAll('.view').forEach(s=>s.hidden=s.id!=='view-'+view);
    doc.querySelectorAll('.nav-link').forEach(a=>{a.classList.toggle('active',a.dataset.view===view);if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    doc.title='Munna’s Grooves — Shared listening room';
  }
  async function sync(){
    if(busy||polling||doc.hidden)return;
    polling=true;
    try{accept(await request('/state'));status(shared.refreshing?'Someone is generating the next shared batch. Current picks stay available.':'Connected to the shared room. Everyone sees these picks and ratings.');}
    catch{status('Shared service unavailable. Showing the last loaded picks; feedback has not been saved locally.');}
    finally{polling=false;}
  }
  $('.ai-panel').innerHTML='<p class="eyebrow accent">ONE SHARED LISTENING ROOM · NO SIGN-IN</p><h2>Everyone helps choose what comes next.</h2><p>Everyone sees the same songs. Feedback is public and affects the next batch for everyone. The latest rating for a song replaces its previous shared rating.</p><p class="small muted">AI runs on Cloudflare using song metadata and shared feedback. No model download or GPU is needed. It does not listen to the audio. Up to 12 picks per batch; all languages mixed. Refresh is limited to once a minute and 30 attempts per day for this room.</p><p id="ai-status" role="status">Connecting to the shared room…</p>';
  $('.filters').innerHTML='<span class="small">One mix for everyone · all languages · all moods</span>';
  $('.feature-panel').hidden=true;$('#ai-diagnostics').hidden=true;
  $('#basis').textContent='Shared feedback applies to individual songs. Recent recommendations stay excluded for 14 days across every browser.';
  $('.side-bottom .small').textContent='Shared across all browsers';
  $('[data-view="profile"]').textContent='Shared taste';
  $('.side-sources .text-link').textContent='Shared taste & song feedback →';
  $('#view-profile').innerHTML='<div class="page-heading"><div><p class="eyebrow accent">ONE PROFILE FOR EVERYONE</p><h1>Our shared taste.</h1><p class="muted">No account needed. Anyone can change a song’s shared rating. The latest choice wins.</p></div></div><div class="stats"><div><strong id="shared-count">0</strong><span>Playlist starting songs</span></div><div><strong id="shared-likes">0</strong><span>Shared song likes</span></div></div><section class="panel spaced"><h2>Shared feedback</h2><div id="shared-ratings"></div></section><p class="notice">Playlist setup is managed by the owner. Your old browser-only feedback is not automatically published. Shared ratings are visible to visitors and used by Cloudflare AI. A short-lived network hash limits rapid feedback; visitors have no accounts.</p>';
  $('#view-discover .feedback-prompt p').textContent='Like asks for related songs. Not for us and Already know exclude this song. Each choice updates the shared profile for everyone.';
  $('#view-discover .feedback-prompt a').textContent='See shared taste';
  $('#view-plan h1').textContent='Our two-week plan.';
  $('#view-plan .page-heading .muted').textContent='Up to six songs each week from the current shared batch.';
  $('#today').textContent=new Date().toLocaleDateString();
  $('#comfort-mixes').innerHTML=data.mixes.map(m=>`<article class="mix"><div class="mix-head"><h2>${esc(m.title)}</h2><p>${esc(m.note)}</p></div><ol>${m.tracks.map(([a,t])=>`<li><div><strong>${esc(t)}</strong><span>${esc(a)}</span></div><a href="${search(a,t)}" target="_blank" rel="noopener noreferrer">Play ↗</a></li>`).join('')}</ol></article>`).join('');
  $('#refresh').addEventListener('click',async()=>{
    if(busy||!shared)return;busy=true;controls();status('Generating the next shared AI batch. Everyone’s current picks stay available…');
    try{accept(await request('/refresh',{}));status(`${shared.batch.items.length} AI picks saved for everyone.`);}
    catch(error){status(error.message+' Current shared picks have not been replaced.');}
    finally{busy=false;controls();}
  });
  doc.addEventListener('click',async event=>{
    const tab=event.target.closest('[data-shared-week]');if(tab){week=Number(tab.dataset.sharedWeek);render();return;}
    const button=event.target.closest('[data-shared-rating]');if(!button||busy||!shared)return;
    busy=true;controls();
    try{accept(await request('/feedback',{artist:button.dataset.artist,title:button.dataset.title,rating:button.dataset.sharedRating}));status('Song feedback saved for everyone. It will shape the next batch.');}
    catch(error){status('Feedback was not saved. '+error.message);}
    finally{busy=false;controls();}
  });
  win.addEventListener('hashchange',navigate);win.addEventListener('focus',sync);doc.addEventListener('visibilitychange',sync);
  render();navigate();await sync();
  const timer=win.setInterval(sync,60000);win.addEventListener('pagehide',()=>win.clearInterval(timer),{once:true});
  return {sync};
}
