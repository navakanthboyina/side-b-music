'use strict';
(() => {
const D=window.SIDE_B_DATA, $=s=>document.querySelector(s), KEY='side-b-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const REPEAT_WINDOW=14*24*60*60*1000;
const trackKey=t=>'track:'+t.artist.split(/\s*(?:,|&|;)\s*/).map(norm).sort().join('|')+':'+norm(t.title);
const blank=()=>({version:1,engine:'ai',songRatings:{},shown:{},artistVisits:{},rotation:0,ratings:{},explored:[],imports:[],seeds:[],filters:{language:'All languages',mood:'Any mood'},cache:null});
function validate(raw){
 if(!raw||raw.version!==1||!Array.isArray(raw.imports)||!Array.isArray(raw.seeds)||!Array.isArray(raw.explored)||!raw.ratings||typeof raw.ratings!=='object'||Array.isArray(raw.ratings))throw Error('Not a valid Munna’s Grooves backup.');
 if(raw.imports.length>10000||raw.seeds.length>1000||Object.keys(raw.ratings).length>2000)throw Error('Backup is too large.');
 const s=blank(),valid=v=>typeof v==='string'&&v.trim().length>0&&v.length<=300;
 s.imports=raw.imports.map(t=>{if(!valid(t.artist)||!valid(t.title)||!valid(t.source))throw Error('Invalid track in backup.');return {artist:t.artist.trim(),title:t.title.trim(),source:t.source.trim()};});
 s.seeds=raw.seeds.map(a=>{if(!valid(a.name)||!['Telugu','Tamil','Hindi','English','Unspecified'].includes(a.language))throw Error('Invalid artist in backup.');return {name:a.name.trim(),language:a.language};});
 for(const[k,r]of Object.entries(raw.ratings)){if(!valid(r.name)||k!==norm(r.name)||!['replay','skip','known'].includes(r.value))throw Error('Invalid rating in backup.');s.ratings[k]={name:r.name,value:r.value};}
 s.explored=[...new Set(raw.explored.filter(id=>D.artists.some(a=>a.id===id)))];
 if(raw.filters&&['All languages','Telugu','Tamil','Hindi','English'].includes(raw.filters.language)&&['Any mood','Warm','Reflective','Energetic'].includes(raw.filters.mood))s.filters=raw.filters;
 for(const field of ['shown','artistVisits']){
  if(raw[field]!==undefined){
   if(!raw[field]||typeof raw[field]!=='object'||Array.isArray(raw[field]))throw Error('Invalid recommendation history.');
   for(const [key,at] of Object.entries(raw[field])){
    if(!key.startsWith(field==='shown'?'track:':'artist:')||key.length>2000||!Number.isFinite(at)||at<0||at>Date.now())throw Error('Invalid recommendation history.');
    if(Date.now()-at<REPEAT_WINDOW)s[field][key]=at;
   }
  }
 }
 if(raw.songRatings!==undefined){
  if(!raw.songRatings||typeof raw.songRatings!=='object'||Array.isArray(raw.songRatings)||Object.keys(raw.songRatings).length>10000)throw Error('Invalid song feedback.');
  for(const [key,r] of Object.entries(raw.songRatings)){
   if(!r||!valid(r.artist)||!valid(r.title)||key!==trackKey(r)||!['replay','skip','known'].includes(r.value))throw Error('Invalid song feedback.');
   s.songRatings[key]={artist:r.artist,title:r.title,value:r.value,at:Number.isFinite(r.at)?r.at:0};
  }
 }
 s.engine=raw.engine==='catalog'?'catalog':'ai';
 s.rotation=Number.isSafeInteger(raw.rotation)&&raw.rotation>=0?raw.rotation:0;
 return s;
}
let aiController=null;
let state=blank(),week=1,busy=false,mode='starter',items=[],message='',toastTimer,storageError=false;
try{const raw=localStorage.getItem(KEY);if(raw){const parsed=JSON.parse(raw);state=validate(parsed);const c=parsed.cache;if(c&&Number.isFinite(c.at)&&typeof c.filter==='string'&&Array.isArray(c.items)&&c.items.length<=30&&c.items.every(t=>['artist','title','seed','language','mood','reason'].every(k=>typeof t[k]==='string')))state.cache=c;}}catch{storageError=true;}
function pruneHistory(){for(const field of ['shown','artistVisits'])for(const [k,at] of Object.entries(state[field]))if(Date.now()-at>=REPEAT_WINDOW)delete state[field][k];}
function recentlyShown(t){const at=state.shown[trackKey(t)];return Number.isFinite(at)&&Date.now()-at<REPEAT_WINDOW;}
// Migrate the most recent pre-upgrade batch without renewing its original timestamp.
if(state.cache){for(const t of state.cache.items){const k=trackKey(t);if(!Object.hasOwn(state.shown,k)&&Date.now()-state.cache.at<REPEAT_WINDOW)state.shown[k]=state.cache.at;}}
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));return true;}catch{toast('Browser storage is unavailable or full. Download a backup to keep changes.');return false;}}
const getSongRating=t=>state.songRatings[trackKey(t)]?.value;
const excludedSong=t=>['skip','known'].includes(getSongRating(t));
function setSongRating(artist,title,value){
 if(![artist,title].every(x=>typeof x==='string'&&norm(x)&&x.length<=300)||!['replay','skip','known','clear'].includes(value))throw Error('A song title, artist and valid rating are required.');
 const song={artist,title},key=trackKey(song);
 if(value==='clear')delete state.songRatings[key];else state.songRatings[key]={...song,value,at:Date.now()};
 save();render();toast('Updated this song only. Refresh picks to find related songs.');return {...song,rating:getSongRating(song)||null};
}

function url(q,p='YouTube'){q=encodeURIComponent(q);return p==='SoundCloud'?'https://soundcloud.com/search/sounds?q='+q:p==='Bandcamp'?'https://bandcamp.com/search?q='+q:'https://www.youtube.com/results?search_query='+q;}
function links(q){return `<div class="card-links"><a class="listen" href="${url(q)}" target="_blank" rel="noopener noreferrer">YouTube ↗</a><a class="alt-link" href="${url(q,'SoundCloud')}" target="_blank" rel="noopener noreferrer">SoundCloud</a><a class="alt-link" href="${url(q,'Bandcamp')}" target="_blank" rel="noopener noreferrer">Bandcamp</a></div>`;}
function buttons(artist,title){if(!title)return '';const song={artist,title};return `<div class="card-feedback">${[['replay','♡ Like'],['skip','Not for me'],['known','Already know']].map(([v,t])=>`<button class="rate" data-artist="${esc(artist)}" data-title="${esc(title)}" data-rating="${v}" aria-label="${esc(t+' '+title+' by '+artist)}" aria-pressed="${getSongRating(song)===v}">${t}</button>`).join('')}</div>`;}

function seeds(){const map=new Map(D.artists.map(a=>[norm(a.name),{...a,origin:'starter'}]));for(const t of state.imports)for(const name of t.artist.split(/\s*;\s*/).filter(Boolean)){const k=norm(name);if(k&&!map.has(k))map.set(k,{id:k,name,language:'Unspecified',mood:'Any mood',origin:'import'});}for(const a of state.seeds){const k=norm(a.name);map.set(k,{...(map.get(k)||{id:k,mood:'Any mood'}),...a,origin:'added'});}return [...map.values()];}
function score(a){return 1+(a.origin&&a.origin!=='starter'?3:0);}
function hash(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function matches(a){return (state.filters.language==='All languages'||a.language===state.filters.language)&&(state.filters.mood==='Any mood'||a.mood===state.filters.mood);}
function chosen(){const day=new Date().toISOString().slice(0,10);return seeds().filter(matches).sort((a,b)=>((state.artistVisits['artist:'+norm(a.name)]||0)-(state.artistVisits['artist:'+norm(b.name)]||0))||(score(b)+hash(day+state.rotation+b.name)%100/40)-(score(a)+hash(day+state.rotation+a.name)%100/40)).slice(0,3);}
const starters=()=>D.artists.filter(matches).sort((a,b)=>score(b)-score(a)).slice(0,6);
function card(a,i,plan=false){return `<article class="music-card"><div class="card-top"><span>${plan?['MONDAY','WEDNESDAY','FRIDAY'][i]:esc(a.language)+' / '+esc(a.mood)}</span><span class="card-index">${String(i+1).padStart(2,'0')}</span></div><div class="card-body"><h3>${esc(a.name)}</h3><div class="track-title">${esc(a.track||'Explore their songs')}</div><p>${esc(a.note||'An artist you added to your taste profile.')}</p>${links(a.query||a.name+' official music')}</div>${plan?`<label class="explored"><input type="checkbox" data-explored="${a.id}" ${state.explored.includes(a.id)?'checked':''}> I explored this artist</label>`:''}${buttons(a.name,a.track)}</article>`;}
function liveCard(t,i){return `<article class="music-card"><div class="card-top"><span>${t.aiSong?'AI SONG PICK':'CATALOG PICK'}</span><span class="card-index">${String(i+1).padStart(2,'0')}</span></div><div class="card-body"><h3>${esc(t.title)}</h3><div class="track-title">${esc(t.artist)}</div><p>${esc(t.reason)}${t.year?' · Released '+esc(t.year):''}</p>${links(t.artist+' '+t.title+' official')}</div>${buttons(t.artist,t.title)}</article>`;}
function renderFeed(){const a=chosen().find(x=>x.track)||starters()[0]||chosen()[0];$('.feature-panel').hidden=!a;if(a){$('#featured-name').textContent=a.name;$('#featured-note').textContent=a.note||'An artist from your imported songs or added favorites.';$('#featured-link').innerHTML=links(a.query||a.name+' official music');}
 if(mode==='empty'){$('#feed').innerHTML='<p class="empty">'+esc(message)+'</p>';$('#feed-badge').textContent='14-DAY NO REPEATS';$('#feed-status').textContent='Your recent songs remain excluded.';}else if(mode==='live'){const visible=items.filter(t=>matches({name:t.seed,language:t.language,mood:t.mood}));$('#feed').innerHTML=visible.map(liveCard).join('')||'<p class="empty">No current results match. Refresh picks or choose a wider mood and language.</p>';$('#feed-badge').textContent=(visible.some(t=>t.aiSong)?'AI + CATALOG':'CATALOG')+' · 14-DAY NO REPEATS';$('#feed-status').textContent=message;}else{$('#feed').innerHTML=starters().map((a,i)=>card(a,i)).join('')||'<p class="empty">No starter picks match. Widen your filters or refresh live picks for imported artists.</p>';$('#feed-badge').textContent='CURATED START';$('#feed-status').textContent=message||'Starter selections · press Refresh picks for live catalog results.';}
 $('#basis').textContent=Object.keys(state.songRatings).length?'AI uses your individual song feedback to find related songs across artists. Playlist links are not synced.':'Like a few individual songs to personalize AI picks—no file import needed. Until then, suggestions are provisional. Playlist links alone do not reveal your taste.';
}
function renderPlan(){$('.week-tabs').innerHTML=D.weeks.map((w,i)=>`<button data-week="${i+1}" aria-pressed="${week===i+1}">Week ${String(i+1).padStart(2,'0')}<span>${['Telugu','Tamil','Hindi indie','Crossover'][i]}</span></button>`).join('');$('#week-title').textContent=D.weeks[week-1].title;$('#week-description').textContent=D.weeks[week-1].description;$('#plan-cards').innerHTML=D.artists.filter(a=>a.week===week).map((a,i)=>card(a,i,true)).join('');$('#plan-count').textContent=`${state.explored.length} / 12 explored`;}
function renderProfile(){$('#import-count').textContent=state.imports.length;$('#liked-count').textContent=Object.values(state.songRatings).filter(r=>r.value==='replay').length;$('#explored-count').textContent=state.explored.length;const counts=new Map();state.imports.forEach(t=>t.artist.split(/\s*;\s*/).forEach(n=>counts.set(n,(counts.get(n)||0)+1)));const top=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,8);$('#taste-summary').innerHTML=top.length?`<p class="small muted">Optional Catalog mode: artists in your imports</p><div class="chips">${top.map(([n,c])=>`<span class="chip">${esc(n)} · ${c}</span>`).join('')}</div>`:'<p class="muted">Confirmed: English, Telugu, Hindi, and Tamil. Rate songs to teach AI your taste. No import is required.</p>';$('#seed-list').innerHTML=state.seeds.map((a,i)=>`<span class="chip">${esc(a.name)} · ${esc(a.language)}<button data-remove-seed="${i}" aria-label="Remove ${esc(a.name)}">×</button></span>`).join('');const rates=Object.values(state.songRatings).sort((a,b)=>b.at-a.at);$('#ratings-list').innerHTML=rates.length?rates.map(r=>`<div class="rating-row"><div><strong>${esc(r.title)}</strong> · ${esc(r.artist)}<br><span>${({replay:'More songs like this song',skip:'Exclude this song only',known:'Already know this song'})[r.value]}</span></div><button class="secondary" data-artist="${esc(r.artist)}" data-title="${esc(r.title)}" data-rating="clear">Undo</button></div>`).join(''):'<p class="muted">Like or skip individual songs in Discover or your listening plan. Old artist ratings are archived and no longer affect recommendations.</p>';$('.side-sources .small').textContent=state.imports.length?`${state.imports.length} songs imported on this device. No Spotify sync.`:'Playlist links only. No automatic song access.';}
function render(){renderFeed();renderPlan();renderProfile();}
function navigate(){const hash=location.hash.slice(1),v=['discover','plan','comfort','profile'].includes(hash)?hash:'discover';document.querySelectorAll('.view').forEach(s=>s.hidden=s.id!=='view-'+v);document.querySelectorAll('.nav-link').forEach(a=>{a.classList.toggle('active',a.dataset.view===v);if(a.dataset.view===v)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});document.title='Munna’s Grooves — '+({discover:'Discover',plan:'Four-week plan',comfort:'Comfort mixes',profile:'Your taste'})[v];}
function catalog(params){return new Promise((resolve,reject)=>{const callback='sideB_'+crypto.randomUUID().replace(/-/g,''),script=document.createElement('script');let settled=false;const cleanup=()=>{script.remove();clearTimeout(timer);window[callback]=()=>{};setTimeout(()=>delete window[callback],60000);};const fail=()=>{if(settled)return;settled=true;cleanup();reject(Error('Catalog unavailable'));};const timer=setTimeout(fail,14000);window[callback]=data=>{if(settled)return;settled=true;cleanup();resolve(data);};script.onerror=fail;script.src='https://itunes.apple.com/search?'+new URLSearchParams({...params,callback});document.head.append(script);});}
const filterKey=()=>state.filters.language+'|'+state.filters.mood;
const profileKey=()=>JSON.stringify([state.filters,state.songRatings,state.imports,state.seeds,state.engine]);
async function refresh(){
 if(busy)return;
 pruneHistory();busy=true;
 const key=filterKey(), snapshot=profileKey(), ai=state.engine==='ai', btn=$('#refresh');
 btn.disabled=true;$('#recommendation-mode').disabled=true;btn.textContent=ai?'Finding AI picks…':'Finding music…';
 let selected,failed=0;
 try {
  if(ai){
   aiController=new AbortController();$('#cancel-ai').hidden=false;
   $('#ai-status').textContent='Preparing local AI. First load may take several minutes…';
   const [client,core]=await Promise.all([import('./ai-client.mjs'),import('./ai-core.mjs')]);
   selected=await client.recommend(core.tasteProfile(state),text=>$('#ai-status').textContent=text,aiController.signal);
   // Validate all current exclusions again, including feedback outside the prompt sample.
   selected=selected.filter(a=>matches(a)&&!getSongRating(a));
   $('#ai-status').textContent='AI songs selected. Checking exact titles and artist credits…';
  } else selected=chosen();
  if(snapshot!==profileKey())throw Error('Your taste or filters changed. Refresh again for your latest choices.');
  if(!selected.length)throw Error('No artist suggestions match. Widen filters or add favorite artists.');
  for(const a of selected)state.artistVisits['artist:'+norm(a.name)]=Date.now();save();
  $('#feed-status').textContent='Checking the catalog for '+selected.map(a=>a.name).join(', ')+'…';
  const results=await Promise.allSettled(selected.map(async seed=>{
   const d=await catalog({term:ai?seed.title+' '+seed.artist:seed.name,media:'music',entity:'song',attribute:ai?'songTerm':'artistTerm',country:seed.language==='English'?'US':'IN',limit:'40'});
   if(!Array.isArray(d.results))throw Error('Invalid catalog response');
   const seen=new Set(),found=d.results.filter(t=>{
    if(typeof t.artistName!=='string'||typeof t.trackName!=='string')return false;
    const names=t.artistName.split(/\s*(?:,|&|;| feat\. | featuring )\s*/i).map(norm),hit=norm(t.artistName)===norm(seed.name)||names.includes(norm(seed.name)),k=norm(t.trackName);
    if(!hit||(ai&&norm(t.trackName)!==norm(seed.title))||excludedSong({artist:t.artistName,title:t.trackName})||seen.has(k)||recentlyShown({artist:t.artistName,title:t.trackName}))return false;
    seen.add(k);return true;
   });
   const day=new Date().toISOString().slice(0,10);
   found.sort((a,b)=>hash(day+state.rotation+a.trackName)-hash(day+state.rotation+b.trackName));
   return found.slice(0,ai?1:3).map(t=>({artist:t.artistName,title:t.trackName,seed:seed.name,language:seed.language,mood:seed.mood,ai,aiSong:ai,
    year:/^\d{4}-/.test(t.releaseDate||'')?t.releaseDate.slice(0,4):'',
    reason:ai?'AI fit: '+seed.reason:seed.origin==='import'?'From an artist in your imported playlists':seed.origin==='added'?'From an artist you added':'Exploring your provisional '+seed.language+' '+seed.mood.toLowerCase()+' direction'}));
  }));
  if(aiController?.signal.aborted)throw Error('AI stopped. No new picks were saved.');
  if(snapshot!==profileKey())throw Error('Your taste or filters changed. Refresh again for your latest choices.');
  let fresh=[];results.forEach(r=>{if(r.status==='fulfilled')fresh.push(...r.value);else failed++;});state.rotation++;
  const batchKeys=new Set();fresh=fresh.filter(t=>{const k=trackKey(t);if(batchKeys.has(k)||recentlyShown(t)||excludedSong(t)||(ai&&getSongRating(t))||!matches({name:t.seed,language:t.language,mood:t.mood}))return false;batchKeys.add(k);return true;});
  if(fresh.length){
   items=fresh;mode='live';const at=Date.now();for(const t of items)state.shown[trackKey(t)]=at;state.cache={at,filter:key,items};
   message=`Checked ${new Date(at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})} · ${ai?'Local AI song discovery + ':''}iTunes metadata · ${failed?'Some searches unavailable.':'Listen through the links below.'}`;
  }else{
   mode='empty';items=[];state.cache=null;
   message=failed?'Live catalog unavailable. No new batch was generated; try again later.':'No unseen songs found for these artists within the 14-day window. Refresh to try other artists, widen filters, or add artists.';
  }
  save();renderFeed();
  if(ai)$('#ai-status').textContent=fresh.length?'AI batch ready. Refresh picks generates another batch; these results are saved for your next visit.':message;
 }catch(err){
  const text=err.message||'Could not generate picks. Please try again.';
  if(ai)$('#ai-status').textContent=text;
  $('#feed-status').textContent=text+' Existing results have not been replaced.';
 }finally{
  aiController=null;busy=false;btn.disabled=false;$('#recommendation-mode').disabled=false;$('#cancel-ai').hidden=true;
  btn.innerHTML='Refresh picks <span aria-hidden="true">↻</span>';
 }
}
$('#recommendation-mode').value=state.engine;
$('#recommendation-mode').addEventListener('change',()=>{
 state.engine=$('#recommendation-mode').value;save();
 $('#ai-status').textContent=state.engine==='ai'?'Refresh picks loads local AI and generates a new batch. Your existing results remain until then.':'Catalog mode uses artist-search rules, without AI.';
 if(state.engine==='catalog')import('./ai-client.mjs').then(m=>m.stop()).catch(()=>{});
});
$('#cancel-ai').addEventListener('click',()=>{aiController?.abort();$('#ai-status').textContent='Stopping AI…';});

function parseCSV(text){text=text.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0],delim=first.includes('\t')?'\t':first.split(';').length>first.split(',').length?';':',';let rows=[],row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===delim&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}else field+=c;}if(quoted)throw Error('CSV has an unclosed quote.');row.push(field);if(row.some(x=>x.trim()))rows.push(row);return rows;}
function addTracks(tracks){if(!tracks.length)throw Error('No valid songs found.');if(state.imports.length+tracks.length>10000)throw Error('Maximum 10,000 imported songs.');for(const t of tracks)if(!t.artist.trim()||!t.title.trim()||t.artist.length>300||t.title.length>300)throw Error('Artist and title must each be 1–300 characters.');const seen=new Set(state.imports.map(t=>norm(t.artist)+'|'+norm(t.title)+'|'+t.source));let added=0;for(const t of tracks){const k=norm(t.artist)+'|'+norm(t.title)+'|'+t.source;if(!seen.has(k)){state.imports.push(t);seen.add(k);added++;}}state.cache=null;save();render();$('#import-status').textContent=`${added} songs added; ${tracks.length-added} duplicates ignored. Refresh picks to use these artists.`;toast('Songs added to your taste profile.');}
function importCSV(text){const rows=parseCSV(text);if(rows.length<2)throw Error('CSV needs a header and at least one song.');const h=rows.shift().map(norm),ai=h.findIndex(x=>['artist','artists','artistname','artistnames'].includes(x)),ti=h.findIndex(x=>['track','trackname','song','songname','title','name'].includes(x));if(ai<0||ti<0)throw Error('CSV needs Artist Name(s) / Track Name or Artist / Title columns.');addTracks(rows.filter(r=>r[ai]?.trim()&&r[ti]?.trim()).map(r=>({artist:r[ai].trim(),title:r[ti].trim(),source:$('#import-source').value})));}
async function readFile(input,handler){const f=input.files[0];if(!f)return;try{if(f.size>2*1024*1024)throw Error('Choose a file smaller than 2 MB.');await handler(await f.text());}catch(e){$('#import-status').textContent=e.message;toast(e.message);}finally{input.value='';}}
$('#today').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});$('#language').value=state.filters.language;$('#mood').value=state.filters.mood;
for(const id of ['language','mood'])$('#'+id).addEventListener('change',()=>{state.filters[id]=$('#'+id).value;mode='starter';message='Filters updated. Refresh picks for live catalog results.';save();renderFeed();});
$('#refresh').addEventListener('click',refresh);
document.addEventListener('click',e=>{const r=e.target.closest('[data-rating]');if(r){setSongRating(r.dataset.artist,r.dataset.title,getSongRating({artist:r.dataset.artist,title:r.dataset.title})===r.dataset.rating?'clear':r.dataset.rating);return;}const w=e.target.closest('[data-week]');if(w){week=Number(w.dataset.week);renderPlan();$('.week-tabs [data-week="'+week+'"]').focus();}const s=e.target.closest('[data-remove-seed]');if(s){state.seeds.splice(Number(s.dataset.removeSeed),1);state.cache=null;save();render();}});
document.addEventListener('change',e=>{if(e.target.matches('[data-explored]')){const id=e.target.dataset.explored;state.explored=state.explored.filter(x=>x!==id);if(e.target.checked)state.explored.push(id);save();$('#plan-count').textContent=`${state.explored.length} / 12 explored`;renderProfile();}});
window.addEventListener('hashchange',()=>{navigate();window.scrollTo(0,0);});
$('#csv-import').addEventListener('change',e=>readFile(e.target,importCSV));
$('#import-paste').addEventListener('click',()=>{try{const raw=$('#paste-tracks').value;if(raw.length>2*1024*1024)throw Error('Paste less than 2 MB of text.');addTracks(raw.split(/\r?\n/).filter(x=>x.trim()).map(line=>{const p=line.split(/\s+[—–-]\s+|\t/);if(p.length<2)throw Error('Use Artist — Song title on every line.');return {artist:p.shift().trim(),title:p.join(' — ').trim(),source:$('#import-source').value};}));$('#paste-tracks').value='';}catch(e){$('#import-status').textContent=e.message;toast(e.message);}});
$('#seed-form').addEventListener('submit',e=>{e.preventDefault();const name=$('#seed-name').value.trim();if(!norm(name))return;const existing=state.seeds.find(a=>norm(a.name)===norm(name));if(existing)existing.language=$('#seed-language').value;else if(state.seeds.length<1000)state.seeds.push({name,language:$('#seed-language').value});state.cache=null;save();$('#seed-name').value='';render();toast('Artist saved. Refresh picks to hear more.');});
$('#export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({...state,cache:null},null,2)],{type:'application/json'}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download='side-b-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);});
$('#restore').addEventListener('change',e=>readFile(e.target,text=>{const restored=validate(JSON.parse(text));if(!window.confirm('Replace this device’s Munna’s Grooves ratings, imports, and progress with this backup?'))return;state=restored;$('#recommendation-mode').value=state.engine;mode='starter';message='Backup restored. Refresh picks to use your restored profile.';$('#language').value=state.filters.language;$('#mood').value=state.filters.mood;save();render();toast('Backup restored.');}));
$('#comfort-mixes').innerHTML=D.mixes.map(m=>`<article class="mix"><div class="mix-head"><p class="eyebrow">${esc(m.subtitle)}</p><h2>${esc(m.title)}</h2><p>${esc(m.note)}</p></div><ol>${m.tracks.map(([a,t])=>`<li><div><strong>${esc(t)}</strong><span>${esc(a)}</span></div><a href="${url(a+' '+t+' official')}" target="_blank" rel="noopener noreferrer" aria-label="Find ${esc(t)} on YouTube">Play ↗</a></li>`).join('')}</ol></article>`).join('');
if(state.cache&&state.cache.filter===filterKey()){mode='live';items=state.cache.items;message='Last checked '+new Date(state.cache.at).toLocaleString()+' · cached catalog metadata';}
pruneHistory();save();render();navigate();if(storageError)toast('Saved data could not be loaded. Use Download backup to keep new changes.');
if(state.engine==='catalog'&&(!state.cache||Date.now()-state.cache.at>86400000))setTimeout(()=>{if(state.engine==='catalog')refresh();},1200);
if(document.modelContext?.registerTool){const lifecycle=new AbortController();try{Promise.resolve(document.modelContext.registerTool({name:'rate_music_song',description:'Set or clear feedback for one song only; does not rate the whole artist.',inputSchema:{type:'object',properties:{artist:{type:'string',minLength:1,maxLength:300},title:{type:'string',minLength:1,maxLength:300},rating:{type:'string',enum:['replay','skip','known','clear']}},required:['artist','title','rating'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||typeof input.artist!=='string'||typeof input.title!=='string'||!['replay','skip','known','clear'].includes(input.rating))throw Error('Song, artist and valid rating required');return setSongRating(input.artist,input.title,input.rating);}},{signal:lifecycle.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}
})();
