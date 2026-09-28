import {songKey} from '../ai-core.mjs';
import {selectedLanguages} from './languages.mjs';

const DAY=86400000;
const codes={tel:'Telugu',hin:'Hindi',eng:'English',tam:'Tamil',kan:'Kannada',mal:'Malayalam',pan:'Punjabi',ben:'Bengali'};
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
const norm=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const text=s=>typeof s==='string'&&s.trim()&&s.length<=300;
const artistMatches=(value,credits)=>credits.some(c=>norm(c.name||c.artist?.name)===norm(value));
export const discoveryEnabled=env=>!!env.LASTFM_API_KEY&&env.LASTFM_PUBLIC_APPROVED==='true';
export function sourceLink(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.last.fm'&&!u.username&&!u.password&&!u.port&&u.pathname.startsWith('/music/')?u.href:null;}catch{return null;}}
export function workLanguages(work){return [...new Set([...(Array.isArray(work.languages)?work.languages:[]),work.language].map(c=>codes[c]).filter(Boolean))];}

// Private, bounded state: no credential-bearing URLs, raw replies or listening history.
export async function discoverSongs(state,env,{anchors,excluded=new Set(),language='Mixed',stats={},deadline=Date.now()+45000,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 if(!discoveryEnabled(env))throw Error('Song discovery needs a Last.fm key and public-use approval.');
 const cache=state.songDiscovery ||= {queries:{},languages:{},backoff:{},mbNext:0};
 cache.queries ||= {};cache.languages ||= {};cache.backoff ||= {};
 stats.discovery ||= {requests:0,cacheHits:0,verifiedLanguage:0,unknownLanguage:0,errors:[]};
 const d=stats.discovery,transient={};
 const queries=()=>({...cache.queries,...transient});
 const fetcher=env.DISCOVERY_FETCH||fetch;
 async function get(url,provider){
  if(d.requests>=24||now()+9000>deadline||cache.backoff[provider]>now())return null;
  if(provider==='MusicBrainz'){
   const delay=Math.max(0,(cache.mbNext||0)-now());
   if(now()+delay+9000>deadline)return null;
   if(delay)await sleep(delay);
   cache.mbNext=now()+1100;
  }
  d.requests++;
  try{
   const r=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json',...(provider==='MusicBrainz'?{'User-Agent':'MunnasGrooves/2.0 (https://github.com/navakanthboyina/side-b-music)'}:{})}});
   // Workers supports manual/follow only. Never follow a credential-bearing URL.
   if(r.status>=300&&r.status<400){cache.backoff[provider]=now()+60000;d.errors.push({provider,category:'redirect_blocked',status:r.status});return null;}
   let body;try{body=await r.json();}catch{
    cache.backoff[provider]=now()+(r.status===429||r.status===503?300000:60000);
    d.errors.push({provider,category:r.ok?'invalid_json':'http_error',status:r.status});return null;
   }
   if(!body||typeof body!=='object'){cache.backoff[provider]=now()+60000;d.errors.push({provider,category:'invalid_response',status:r.status});return null;}
   // A missing reference track is not a provider outage. Continue with other taste songs.
   if(provider==='Last.fm'&&[6,7].includes(body.error))return {body:{similartracks:{track:[]}},ttl:3600000};
   if(!r.ok||body.error){
    const rate=r.status===429||r.status===503||body.error===29;
    const retry=r.headers.get('retry-after'),seconds=Number(retry);
    const until=retry?(Number.isFinite(seconds)?now()+seconds*1000:Date.parse(retry)):0;
    cache.backoff[provider]=Math.max(now()+(rate?300000:60000),Number.isFinite(until)?until:0);
    d.errors.push({provider,status:r.status,code:typeof body.error==='number'?body.error:undefined});return null;
   }
   const cc=r.headers.get('cache-control')||'';
   const maxAge=cc.match(/(?:^|,)\s*max-age=(\d+)/i);
   return {body,ttl:/no-store|no-cache/i.test(cc)?0:maxAge?Math.min(7*DAY,Number(maxAge[1])*1000):DAY};
  }catch(error){cache.backoff[provider]=now()+60000;d.errors.push({provider,category:['TimeoutError','AbortError'].includes(error?.name)?'timeout':'network_or_request',errorName:['TypeError','Error','TimeoutError','AbortError'].includes(error?.name)?error.name:'Error'});return null;}
 }
 const active=new Map([...(state.seedSongs||[]),...Object.values(state.songRatings||{}).filter(t=>t.value==='replay')].filter(t=>!state.songRatings?.[songKey(t)]||state.songRatings[songKey(t)].value==='replay').map(t=>[songKey(t),t]));
 const denied=t=>excluded.has(songKey(t))||!!state.songRatings?.[songKey(t)]||!!state.familiar?.[songKey(t)]||(state.seedSongs||[]).some(s=>songKey(s)===songKey(t));
 const available=()=>{
  const rows=[],seen=new Set();
  for(const [key,q] of Object.entries(queries())){
   if(q.until<=now()||!active.has(key))continue;
   for(const t of q.tracks){
    if(denied(t)||seen.has(songKey(t)))continue;
    const info=cache.languages[songKey(t)],labels=info?.until>now()?info.labels:[];
    if(language!=='Mixed'&&!labels.some(l=>selectedLanguages(language).includes(l)))continue;
    let a=anchors.find(a=>songKey(a)===key);
    if(!a){const ref=active.get(key);a={id:Math.max(0,...anchors.map(x=>x.id))+1,artist:ref.artist,title:ref.title,source:state.songRatings?.[key]?.value==='replay'?'liked song':'playlist song'};anchors.push(a);}
    seen.add(songKey(t));rows.push({...t,anchorIds:[a.id],evidence:{type:'similar_track',provider:'Last.fm',candidateId:t.id,reference:{artist:a.artist,title:a.title},match:t.match,url:t.url,languages:labels,recordingId:info?.recordingId}});
   }
  }
  // Interleave starting songs so a large response from one reference cannot monopolize the pool.
  const buckets=new Map();for(const t of rows.sort((a,b)=>b.match-a.match)){const k=t.anchorIds[0];if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(t);}
  const out=[];while(out.length<24&&[...buckets.values()].some(a=>a.length))for(const list of buckets.values()){if(list.length&&out.length<24)out.push(list.shift());}return out;
 };
 let rows=available();
 if(rows.length>=24){d.cacheHits+=rows.length;return rows;}
 for(const a of anchors.slice(0,6)){
  const key=songKey(a);if(cache.queries[key]?.until>now()){d.cacheHits++;continue;}
  const u=new URL('https://ws.audioscrobbler.com/2.0/');
  u.search=new URLSearchParams({method:'track.getsimilar',artist:a.artist,track:a.title,autocorrect:'0',limit:'30',format:'json',api_key:env.LASTFM_API_KEY});
  const response=await get(u.href,'Last.fm');if(!response)continue;
  const raw=response.body.similartracks?.track;
  if(!Array.isArray(raw)){d.errors.push({provider:'Last.fm',category:'invalid_shape'});continue;}
  const tracks=raw.filter(t=>text(t.name)&&text(t.artist?.name)&&Number.isFinite(Number(t.match))&&Number(t.match)>0).map(t=>({artist:t.artist.name.trim(),title:t.name.trim(),id:songKey({artist:t.artist.name.trim(),title:t.name.trim()}),match:Number(t.match),mbid:uuid(t.mbid)?t.mbid:null,url:sourceLink(t.url)||'https://www.last.fm/music/'+encodeURIComponent(t.artist.name.trim())+'/_/'+encodeURIComponent(t.name.trim())}));
  // Responses that prohibit reuse can serve this request, but never enter the source cache.
  if(response.ttl>0)cache.queries[key]={until:now()+response.ttl,tracks};
  else transient[key]={until:deadline+1,tracks};
 }
 // Resolve recordings, then their performed works. Release text-language is never a song label.
 const candidates=Object.values(queries()).filter(q=>q.until>now()).flatMap(q=>q.tracks).filter(t=>!denied(t));
 const visited=new Set();
 for(const t of candidates){
  const key=songKey(t);if(visited.has(key)||cache.languages[key]?.until>now())continue;visited.add(key);
  if(d.requests>=24||now()+9000>deadline)break;
  let id=t.mbid;
  if(!id){
   const quote=s=>'"'+s.replace(/[\\"]/g,'\\$&')+'"';
   const q=new URLSearchParams({query:'recording:'+quote(t.title)+' AND artist:'+quote(t.artist),fmt:'json',limit:'5'});
   const found=await get('https://musicbrainz.org/ws/2/recording/?'+q,'MusicBrainz');if(!found)continue;
   const matches=(found.body.recordings||[]).filter(r=>norm(r.title)===norm(t.title)&&artistMatches(t.artist,r['artist-credit']||[])&&uuid(r.id));
   if(matches.length!==1){cache.languages[key]={labels:[],until:now()+DAY};d.unknownLanguage++;continue;}
   id=matches[0].id;
  }
  const rec=await get(`https://musicbrainz.org/ws/2/recording/${id}?inc=work-rels+artist-credits&fmt=json`,'MusicBrainz');if(!rec)continue;
  if(rec.body.id!==id||/\b(instrumental|karaoke)\b/i.test(t.title+' '+(rec.body.disambiguation||''))||norm(rec.body.title)!==norm(t.title)||!artistMatches(t.artist,rec.body['artist-credit']||[])){cache.languages[key]={labels:[],until:now()+DAY};continue;}
  const works=(rec.body.relations||[]).filter(r=>r.type==='performance'&&uuid(r.work?.id)).map(r=>r.work.id);
  const labels=[];let complete=true;
  // Medleys can have many works; leave them unknown rather than attach partial language evidence.
  if(works.length>3){cache.languages[key]={labels:[],until:now()+DAY};continue;}
  for(const work of works){const result=await get(`https://musicbrainz.org/ws/2/work/${work}?fmt=json`,'MusicBrainz');if(result&&result.body.id===work)labels.push(...workLanguages(result.body));else complete=false;}
  if(complete){cache.languages[key]={recordingId:id,labels:[...new Set(labels)],until:now()+(labels.length?30*DAY:DAY)};if(labels.length)d.verifiedLanguage++;else d.unknownLanguage++;}
 }
 for(const [key,q] of Object.entries(cache.queries))if(q.until<=now()||!active.has(key))delete cache.queries[key];
 cache.queries=Object.fromEntries(Object.entries(cache.queries).slice(-40));
 cache.languages=Object.fromEntries(Object.entries(cache.languages).filter(([,v])=>v.until>now()).slice(-400));
 d.errors=d.errors.slice(-12);
 rows=available();d.eligible=rows.length;return rows;
}
