import {installPreviewPlayer} from './preview-player.mjs?v=familiar-language-option-1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const key=t=>'track:'+t.artist.split(/\s*(?:,|&|;)\s*/).map(norm).sort().join('|')+':'+norm(t.title);
const search=(artist,title)=>'https://www.youtube.com/results?search_query='+encodeURIComponent(artist+' '+title+' official');

export async function startShared({apiBase},data,doc=document,win=window) {
  const $=s=>doc.querySelector(s); let shared=null,busy=false,week=1,polling=false,searchResults=[],chosenLanguage='Mixed',languageTouched=false;
  const languages=['Mixed','Telugu','Hindi','English','Tamil','Kannada','Malayalam','Punjabi','Bengali'];
  const api=apiBase.replace(/\/$/,'');
  if(!/^https:\/\//.test(api))throw Error('The shared service needs an HTTPS URL.');
  const activeBatch=()=>shared?.batch?.relevanceVersion===2?shared.batch:null;
  const status=text=>{$('#ai-status').textContent=text;};
  async function request(path,body) {
    const response=await win.fetch(api+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(path==='/refresh'?190000:15000)});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||'Shared service unavailable.');return payload;
  }
  function accept(value) {
    if(!value||!Number.isInteger(value.revision)||!value.songRatings||!('batch' in value))throw Error('Invalid shared service response.');
    // A delayed GET must not overwrite the response to a newer feedback write.
    if(!shared||value.revision>=shared.revision)shared=value;
    render();
  }
  function controls(){doc.querySelectorAll('[data-shared-rating],[data-add-taste],#song-search button,#refresh,#allow-unverified-familiar,[data-language],[data-preview]').forEach(b=>b.disabled=busy||!shared||(b.id==='allow-unverified-familiar'&&!shared?.familiarLanguageOverrideSupported||b.hasAttribute('data-preview')&&!shared?.previewSupported||b.hasAttribute('data-language')&&b.dataset.language!=='Mixed'&&!shared?.languages?.includes(b.dataset.language)||b.hasAttribute('data-add-taste')&&shared?.songRatings[key(searchResults[Number(b.dataset.addTaste)])]?.value==='replay'||b.id==='refresh'&&(shared.recommenderVersion!==2||shared.needsTasteImport)));}
  function card(t,i){
    const rating=shared?.songRatings[key(t)]?.value;
    const color=[...t.artist].reduce((n,c)=>n+c.charCodeAt(0),0)%5;
    return `<article class="music-card"><div class="track-art art-${color}" aria-hidden="true">${t.artwork&&/^https:\/\/(?:[^/]+\.mzstatic\.com|coverartarchive\.org)\//.test(t.artwork)?`<img class="catalog-art" src="${esc(t.artwork)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">`:'<div class="mini-record"></div>'}<span class="art-caption">MUNNA’S / DISCOVERIES</span><span class="art-number">${String(i+1).padStart(2,'0')}</span></div><div class="card-top"><span>${t.reusedRating?(t.reusedRating==='replay'?'RETURNING FAVORITE':'FAMILIAR PICK'):t.aiSong?'AI-RANKED PICK':t.rankingMode?'TASTE-RANKED PICK':'SHARED PICK'}</span><span>${String(i+1).padStart(2,'0')}</span></div><div class="card-body"><h3>${esc(t.title)}</h3>${t.unverifiedFamiliar?'<p class="small">Familiar fallback · language unverified</p>':''}<div class="track-title">${esc(t.artist)}</div><details class="track-context"><summary>Why this song</summary><p>${esc(t.reason)}</p>${t.language?`<p class="small">${esc(t.language)} · ${esc(t.languageBasis||'Metadata estimate')}</p>`:''}${typeof t.sourceUrl==='string'&&/^https:\/\/www\.last\.fm\/music\//.test(t.sourceUrl)?`<a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener noreferrer">Last.fm · powered by AudioScrobbler ↗</a>`:t.sourceUrl==='https://listenbrainz.org/'?'<a href="https://listenbrainz.org/" target="_blank" rel="noopener noreferrer">ListenBrainz discovery ↗</a>':''}${t.artworkSource?`<p class="small">Artwork: ${esc(t.artworkSource)}</p>`:''}</details><button class="preview-button secondary" data-preview data-artist="${esc(t.artist)}" data-title="${esc(t.title)}">▶ Preview · 30 sec</button><div class="card-links">${t.catalog?.link&&/^https:\/\/(?:music\.apple\.com|itunes\.apple\.com|www\.deezer\.com)\//.test(t.catalog.link)?`<a class="listen" href="${esc(t.catalog.link)}" target="_blank" rel="noopener noreferrer">Open song ↗</a>`:''}<a class="alt-link" href="https://soundcloud.com/search/sounds?q=${encodeURIComponent(t.artist+' '+t.title)}" target="_blank" rel="noopener noreferrer">SoundCloud</a><a class="alt-link" href="https://bandcamp.com/search?q=${encodeURIComponent(t.artist+' '+t.title)}" target="_blank" rel="noopener noreferrer">Bandcamp</a></div></div><div class="card-feedback">${[['replay','Like'],['skip','Not for us'],['known','Already know']].map(([value,label])=>`<button class="rate" data-shared-rating="${rating===value?'clear':value}" data-artist="${esc(t.artist)}" data-title="${esc(t.title)}" aria-pressed="${rating===value}" aria-label="${esc(label+' '+t.title+' for everyone')}">${label}</button>`).join('')}</div></article>`;
  }
  function render(){
    const batch=activeBatch(), songs=batch?.items||[],weekSize=Math.ceil(songs.length/2);
    if(shared?.discoverySetup==='ready'||(shared?.pendingSelectionStats||batch?.selectionStats)?.engine==='Last.fm + MusicBrainz')$('#discovery-method').textContent='Your playlists and feedback guide one shared mix. Last.fm and ListenBrainz find related songs. Taste ranking works independently; AI can refine the order. MusicBrainz helps match recordings and languages. Apple is checked first for previews, then Deezer. No audio is analyzed.';
    if(!languageTouched)chosenLanguage=shared?.pendingSongCount?shared.pendingLanguage||'Mixed':batch?.language||'Mixed';
    $('#language-options').innerHTML=languages.map(l=>`<button type="button" class="language-chip" data-language="${l}" aria-pressed="${chosenLanguage.split(' + ').includes(l)}">${l==='Mixed'?'All languages':l}</button>`).join('');
    $('#language-note').textContent=`Next refresh: ${chosenLanguage==='Mixed'?'a mixed-language set':chosenLanguage+' picks'}. Changes the shared mix for everyone. Select several, or All languages. Language evidence is shown in each song’s details.`;
    $('#draft-progress').value=shared?.pendingSongCount||0;
    $('#draft-meter').hidden=!shared?.pendingSongCount;
    $('#draft-label').textContent=`${shared?.pendingSongCount||0} of 12 next picks ready`;
    $('#view-plan .page-heading .muted').textContent=songs.length===12?'Six songs each day from the complete shared batch.':`${songs.length} songs in the previous batch, split across both days while the next 12-song batch is prepared.`;
    $('#feed').innerHTML=songs.map(card).join('')||'<p class="empty">No recommendations from the updated taste model yet. Complete playlist setup, then refresh.</p>';
    $('#feed-badge').textContent=batch?(batch.selectionStats?.ai?.mode==='ai-reranked'?'AI-RANKED · YOUR FEEDBACK COUNTS':'TASTE-RANKED · YOUR FEEDBACK COUNTS'):'AWAITING RELEVANT PICKS';
    $('#feed-status').textContent=batch?`${songs.length} ${songs.length===1?'song':'songs'} · saved ${new Date(batch.at).toLocaleString()} · ${batch.language||'Mixed'} mix`:'Earlier batches are hidden because they used the old relevance rules.';
    $('.week-tabs').innerHTML=[1,2].map(n=>`<button data-shared-week="${n}" aria-pressed="${week===n}">Day ${n}<span>${esc(batch?.language||'Mixed')} mix</span></button>`).join('');
    $('#week-title').textContent=`Day ${week} · the shared mix`;
    $('#week-description').textContent='Songs from the current shared batch. Refresh replaces this plan for everyone.';
    $('#plan-count').textContent=`${songs.length} shared songs`;
    $('#plan-cards').innerHTML=songs.slice((week-1)*weekSize,week*weekSize).map(card).join('')||'<p class="empty">No songs for this day yet. Refresh generates a complete 12-song batch.</p>';
    const ratings=Object.values(shared?.songRatings||{}).sort((a,b)=>b.at-a.at);
    $('#shared-count').textContent=String(shared?.seedSongCount||0);
    $('#shared-likes').textContent=String(ratings.filter(r=>r.value==='replay').length);
    $('#shared-ratings').innerHTML=ratings.map(t=>`<div class="rating-row"><div><strong>${esc(t.title)}</strong> · ${esc(t.artist)}<br><span>${({replay:'More songs like this',skip:'Exclude this song',known:'Already known'})[t.value]||''}</span></div><button class="secondary" data-shared-rating="clear" data-artist="${esc(t.artist)}" data-title="${esc(t.title)}">Clear for everyone</button></div>`).join('')||'<p>No shared feedback yet. Rate a song in Discover.</p>';
    $('.side-sources .small').textContent=shared?.seedSongCount?`${shared.seedSongCount} playlist songs guide catalog discovery. No Spotify sync.`:'Playlist starting taste has not been uploaded by the owner yet.';
    renderComfort();renderSearch();controls();
  }
  function navigate(){
    const hash=win.location.hash.slice(1),view=['discover','plan','comfort','profile'].includes(hash)?hash:'discover';
    doc.querySelectorAll('.view').forEach(s=>s.hidden=s.id!=='view-'+view);
    doc.querySelectorAll('.nav-link').forEach(a=>{a.classList.toggle('active',a.dataset.view===view);if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    doc.title='Munna’s Grooves — '+({discover:'Discover',plan:'Two-day plan',comfort:'Comfort mixes',profile:'Shared taste'})[view];
    const heading=$('#view-'+view+' h1');if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
    win.scrollTo({top:0,left:0,behavior:'instant'});

  }
  async function sync(){
    if(busy||polling||doc.hidden)return;
    polling=true;
    try{accept(await request('/state'));status(shared.recommenderVersion!==2?'The owner needs to deploy the updated recommendation backend.':shared.needsTasteImport?'The owner needs to re-import the playlists once to enable song-level taste.':shared.pendingSongCount?`${shared.pendingSongCount}/${shared.batchTarget||12} approved songs saved in the shared draft. ${shared.pendingSelectionStats?.stopReason==='both_catalogs_paused'?'Both catalogs failed on the last attempt. Your draft is safe; '+(shared.pendingSelectionStats.catalogErrors||[]).slice(-2).map(e=>e.host+': '+(e.status||e.category)).join('; '):'Refresh after the cooldown to continue filling it.'}`:shared.refreshing?'Someone is generating the next shared batch. Current picks stay available.':'Your shared mix is ready. Press play, find a favorite, make it yours.');}
    catch{status('Shared service unavailable. Showing the last loaded picks; feedback has not been saved locally.');}
    finally{polling=false;}
  }
  $('.ai-panel').innerHTML=`<div class="room-copy"><p class="eyebrow accent">GOOD SONGS. SHARED DISCOVERIES.</p><h2 id="ai-title">Your taste sets<br>the next track.</h2><p>A familiar starting point. A new song to fall for. Explore picks inspired by our playlists, and like the songs you want to hear more of.</p><div class="room-facts"><span>12 songs</span><span>2 days of listening</span><span>One shared mix</span></div><a href="#profile" class="text-link">Add a song you love <span aria-hidden="true">↗</span></a></div><div class="room-art" aria-hidden="true"><div class="record-sleeve"><span>THE NEXT<br>REPEAT.</span><small>VOL. 01 / MUNNA’S GROOVES</small></div><div class="hero-record"><span>MG<br>33⅓</span></div></div><div class="room-bottom"><p id="ai-status" role="status">Connecting to our listening room…</p><div id="draft-meter" hidden><label id="draft-label" for="draft-progress"></label><progress id="draft-progress" max="12" value="0"></progress></div><details class="room-details"><summary>How our shared mix works</summary><p id="discovery-method">No sign-in. Everyone hears the same saved mix. Likes and skips shape the next set; the latest rating for a song wins. We search your selected languages around playlist and liked songs, check catalog connections, then use AI to rank the picks. If language searches find no matches, we also explore connected releases. These are discovery connections, not audio analysis.</p><p>Six songs per day, with no more than two per artist or starting song. We also limit shared releases when release metadata is available. Fresh matches come first. If fewer than 12 qualify, liked and already-known songs may fill the remaining places. These returns are labeled; disliked songs stay excluded. The current mix stays until 12 qualifying songs are ready. Changing the selected languages starts a different draft. Language-specific picks require supported language metadata; unknown-language discoveries are only included in Mixed. The optional familiar-song fallback can include unverified-language liked or already-known songs; those are labeled explicitly. AI reorders verified picks; if AI is unavailable, taste ranking still works. Preview plays are weak feedback, not automatic likes. Refresh is available once a minute, up to 30 attempts a day.</p></details></div>`;
  $('.filters').innerHTML='<div class="mix-controls"><p class="eyebrow">CHOOSE LANGUAGES FOR YOUR NEXT MIX</p><div id="language-options" class="language-options" role="group" aria-label="Select one or more languages for the next mix"></div><p id="language-note" class="small muted"></p><label class="small"><input type="checkbox" id="allow-unverified-familiar"> Allow familiar songs with unverified language to fill gaps</label></div><div id="refresh-slot"></div>';
  $('#refresh-slot').append($('#refresh'));
  $('#refresh').textContent='Find my next mix ↻';
  $('#view-discover .page-heading h1').textContent='A new favorite is waiting.';
  $('#view-discover .page-heading .muted').textContent='Follow a familiar song somewhere new.';
  $('#view-discover .page-heading .eyebrow').textContent='THE DISCOVERY EDIT';
  $('.topbar .small').textContent='Independent ears. Shared discoveries.';
  $('.feature-panel').hidden=true;$('#ai-diagnostics').hidden=true;
  $('#basis').textContent='Shared feedback applies to individual songs. Unrated recommendations can return after two days. Liked and already-known songs may return to fill a short batch. Disliked songs stay excluded.';
  $('.side-bottom .small').textContent='Shared across all browsers';
  $('[data-view="profile"]').textContent='Shared taste';
  $('.side-sources .text-link').textContent='Shared taste & song feedback →';
  $('#view-profile').innerHTML='<div class="page-heading"><div><p class="eyebrow accent">ONE PROFILE FOR EVERYONE</p><h1>Our shared taste.</h1><p class="muted">No account needed. Anyone can change a song’s shared rating. The latest choice wins.</p></div></div><div class="stats"><div><strong id="shared-count">0</strong><span>Playlist starting songs</span></div><div><strong id="shared-likes">0</strong><span>Shared song likes</span></div></div><section class="panel spaced"><h2>Add a song to our taste</h2><p>Search a song you like, then add it as a shared song like. It will guide future recommendations for everyone. Adding or changing feedback restarts any unfinished draft.</p><form id="song-search"><label for="song-query">Song title or artist</label><div class="search-controls"><input id="song-query" type="search" minlength="2" maxlength="200" required placeholder="Song title and artist"><button class="secondary" type="submit">Search</button></div></form><p id="song-search-status" role="status"></p><div id="song-search-results"></div></section><section class="panel spaced"><h2>Shared feedback</h2><div id="shared-ratings"></div></section>';
  $('#view-discover .feedback-prompt p').textContent='Like prioritizes this song as a taste reference. Not for us is negative feedback for this song; Already know marks it as familiar. Liked and familiar songs may return when fresh matches are insufficient; disliked songs stay excluded. Each choice updates the shared profile for everyone.';
  $('#view-discover .feedback-prompt a').textContent='See shared taste';
  $('#view-plan h1').textContent='Our two-day plan.';
  $('#view-plan .page-heading .muted').textContent='Six songs each day from a complete shared batch.';
  $('#today').textContent=new Date().toLocaleDateString();
  function renderComfort(){
    const songs=shared?.comfortSongs||[];
    $('#comfort-mixes').innerHTML=`<p class="notice">Familiar songs from our playlists and shared likes. Rotates daily, or shuffle now for everyone. These mixes are not AI recommendations.</p><button class="secondary" id="shuffle-comfort" ${busy||!shared?.comfortShuffle?'disabled':''}>Shuffle comfort mixes ↻</button>`+[0,1].map((n)=>`<article class="mix"><div class="mix-head"><h2>${n?'Another familiar turn':'Back to our favorites'}</h2><p>A rotating selection from our shared taste.</p></div><ol>${songs.slice(n*6,n*6+6).map(t=>`<li><div><strong>${esc(t.title)}</strong><span>${esc(t.artist)}</span></div><button class="secondary" data-preview data-artist="${esc(t.artist)}" data-title="${esc(t.title)}">▶ Preview</button><a href="${search(t.artist,t.title)}" target="_blank" rel="noopener noreferrer">Listen ↗</a></li>`).join('')}</ol></article>`).join('');
  }
  $('#comfort-mixes').addEventListener('click',async e=>{if(!e.target.closest('#shuffle-comfort')||busy||!shared?.comfortShuffle)return;busy=true;renderComfort();controls();try{accept(await request('/comfort/shuffle',{}));}catch(error){status(error.message);}finally{busy=false;renderComfort();controls();}});

  const searchStatus=text=>{$('#song-search-status').textContent=text;};
  function renderSearch(){
    $('#song-search-results').innerHTML=searchResults.map((t,i)=>{
      const added=shared?.songRatings[key(t)]?.value==='replay';
      return `<div class="rating-row"><div><strong>${esc(t.title)}</strong><br>${esc(t.artist)}</div><button class="secondary" data-preview data-provider="${esc(t.provider)}" data-id="${t.id}" data-artist="${esc(t.artist)}" data-title="${esc(t.title)}">▶ Preview · 30 sec</button><button class="secondary" data-add-taste="${i}" ${added?'disabled':''}>${added?'Added':'Add to taste'}</button></div>`;
    }).join('');
  }
  $('#song-search').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!shared)return;
    busy=true;controls();searchStatus('Searching the music catalog…');
    searchResults=[];renderSearch();
    try{const result=await request('/search',{query:$('#song-query').value.trim()});searchResults=result.songs||[];renderSearch();searchStatus(searchResults.length?`${searchResults.length} songs found. Choose the recording you like.`:'No songs found. Try a title with the artist name.');}
    catch(error){searchStatus(error.message);}
    finally{busy=false;controls();renderSearch();}
  });
  $('#song-search-results').addEventListener('click',async event=>{
    const button=event.target.closest('[data-add-taste]');if(!button||busy||!shared)return;
    const song=searchResults[Number(button.dataset.addTaste)];if(!song)return;
    busy=true;controls();searchStatus('Adding to our shared taste…');
    try{accept(await request('/taste/add',{provider:song.provider,id:song.id}));searchStatus(`Added “${song.title}” to shared taste. It will guide the next batch for everyone.`);status('Shared taste updated. Any unfinished draft was reset to use the new feedback.');}
    catch(error){searchStatus('Song was not added. '+error.message);}
    finally{busy=false;controls();renderSearch();}
  });
  $('#refresh').addEventListener('click',async()=>{
    if(busy||!shared)return;busy=true;controls();status(`Finding ${chosenLanguage==='Mixed'?'your next mixed-language set':chosenLanguage+' discoveries'}… The current mix is still here to enjoy.`);
    try{const result=await request('/refresh',{...(shared.multiLanguage?{languages:chosenLanguage.split(' + ')}:{language:chosenLanguage}),allowUnverifiedFamiliar:$('#allow-unverified-familiar').checked});accept(result);status(result.message||`${shared.batch?.items.length||0} AI picks saved for everyone.`);}
    catch(error){status(error.message+' Current shared picks have not been replaced.');}
    finally{busy=false;controls();}
  });
  doc.addEventListener('click',async event=>{
    const route=event.target.closest('a[href^="#"]');
    if(route&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&event.button===0&&['#discover','#plan','#comfort','#profile'].includes(route.getAttribute('href'))){
      event.preventDefault();const hash=route.getAttribute('href');if(win.location.hash!==hash)win.history.pushState(null,'',hash);navigate();return;
    }

    const languageButton=event.target.closest('[data-language]');if(languageButton&&!busy&&!languageButton.disabled){const l=languageButton.dataset.language;
      if(l==='Mixed'||!shared?.multiLanguage)chosenLanguage=l;
      else {const selected=new Set(chosenLanguage==='Mixed'?[]:chosenLanguage.split(' + '));if(selected.has(l))selected.delete(l);else selected.add(l);chosenLanguage=languages.filter(x=>selected.has(x)).join(' + ')||'Mixed';}
      languageTouched=true;render();controls();return;}
    const tab=event.target.closest('[data-shared-week]');if(tab){week=Number(tab.dataset.sharedWeek);render();return;}
    const button=event.target.closest('[data-shared-rating]');if(!button||busy||!shared)return;
    busy=true;controls();
    try{accept(await request('/feedback',{artist:button.dataset.artist,title:button.dataset.title,rating:button.dataset.sharedRating}));status('Song feedback saved for everyone. It will shape the next batch.');}
    catch(error){status('Feedback was not saved. '+error.message);}
    finally{busy=false;controls();}
  });
  if('scrollRestoration' in win.history)win.history.scrollRestoration='manual';
  win.addEventListener('popstate',navigate);win.addEventListener('hashchange',navigate);win.addEventListener('focus',sync);doc.addEventListener('visibilitychange',sync);
  installPreviewPlayer(doc,win,song=>request('/preview',song),event=>request('/activity',event));
  render();navigate();await sync();
  const timer=win.setInterval(sync,60000);win.addEventListener('pagehide',()=>win.clearInterval(timer),{once:true});
  return {sync};
}
