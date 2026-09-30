import {songKey} from '../ai-core.mjs';
import {selectedLanguages} from './languages.mjs';

const DAY=86400000;
const codes={tel:'Telugu',hin:'Hindi',eng:'English',tam:'Tamil',kan:'Kannada',mal:'Malayalam',pan:'Punjabi',ben:'Bengali'};
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
const norm=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const text=s=>typeof s==='string'&&s.trim()&&s.length<=300;
const artistMatches=(value,credits)=>credits.some(c=>norm(c.name||c.artist?.name)===norm(value));
export const lastfmEnabled=env=>!!env.LASTFM_API_KEY&&env.LASTFM_PUBLIC_APPROVED==='true';
export const discoveryEnabled=env=>lastfmEnabled(env)||env.LISTENBRAINZ_ENABLED!=='false';
export function sourceLink(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.last.fm'&&!u.username&&!u.password&&!u.port&&u.pathname.startsWith('/music/')?u.href:null;}catch{return null;}}
export function workLanguages(work){return [...new Set([...(Array.isArray(work.languages)?work.languages:[]),work.language].map(c=>codes[c]).filter(Boolean))];}

// Private, bounded state: no credential-bearing URLs, raw replies or listening history.
export async function discoverSongs(state,env,{anchors,excluded=new Set(),usedSources=new Set(),existing=[],enrichLanguage=false,language='Mixed',stats={},deadline=Date.now()+45000,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 const keys=new WeakMap(),keyOf=t=>{let k=keys.get(t);if(k===undefined){k=songKey(t);keys.set(t,k);}return k;};
 if(!discoveryEnabled(env))throw Error('Song discovery needs a Last.fm key and public-use approval.');
 const cache=state.songDiscovery ||= {queries:{},languages:{},backoff:{},mbNext:0};
 cache.queries ||= {};cache.languages ||= {};cache.backoff ||= {};cache.secondary ||= {};cache.seedIds ||= {};cache.providerNext ||= {};cache.identities ||= {};
 stats.discovery ||= {requests:0,cacheHits:0,verifiedLanguage:0,unknownLanguage:0,errors:[]};
 const d=stats.discovery,transient={};
 cache.lastFailures ||= {};
 const snapshotCooldowns=()=>{d.providerCooldowns=Object.entries(cache.backoff).filter(([,until])=>until>now()).map(([provider,until])=>({provider,until,retryAfterSeconds:Math.ceil((until-now())/1000),cause:cache.lastFailures[provider]||{category:'unknown_legacy_cooldown'}}));};
 const recordFailure=error=>{const saved={...error,at:now()};cache.lastFailures[error.provider]=saved;d.errors.push(saved);snapshotCooldowns();};
 snapshotCooldowns();
 const queries=()=>{
  const merged={...cache.queries,...transient};
  for(const [key,q] of Object.entries(cache.secondary))if(q.until>now()){
   const primary=merged[key];merged[key]={until:Math.max(q.until,primary?.until||0),tracks:[...(primary?.until>now()?primary.tracks:[]),...q.tracks]};
  }
  return merged;
 };
 const fetcher=env.DISCOVERY_FETCH||fetch;
 async function get(url,provider,redirects=0){
  if(d.requests>=24||now()+9000>deadline||cache.backoff[provider]>now())return null;
  // Preserve metadata capacity across every pool in this refresh, not just one call.
  if(provider==='Last.fm'&&(d.requestsByProvider?.[provider]||0)>=6)return null;
  if(provider==='ListenBrainz'&&(d.requestsByProvider?.[provider]||0)>=2)return null;
  if(provider==='MusicBrainz'){
   const delay=Math.max(0,(cache.mbNext||0)-now());
   if(now()+delay+9000>deadline)return null;
   if(delay)await sleep(delay);
   cache.mbNext=now()+1100;
  }
  if(provider!=='MusicBrainz'){const delay=Math.max(0,(cache.providerNext[provider]||0)-now());if(delay)await sleep(delay);cache.providerNext[provider]=now()+500;}
  d.requests++;
  d.requestsByProvider ||= {};d.requestsByProvider[provider]=(d.requestsByProvider[provider]||0)+1;
  try{
   const r=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json',...(provider==='MusicBrainz'?{'User-Agent':'MunnasGrooves/2.0 (https://github.com/navakanthboyina/side-b-music)'}:{})}});
   // Workers supports manual/follow only. Never follow a credential-bearing URL.
   if(r.status>=300&&r.status<400){
    let target;try{target=new URL(r.headers.get('location')||'',url);}catch{}
    if(provider==='MusicBrainz'&&redirects<1&&target&&target.href!==url&&target.protocol==='https:'&&target.hostname==='musicbrainz.org'&&!target.port&&!target.username&&!target.password&&target.pathname.startsWith('/ws/2/')){
     d.redirectsFollowed=(d.redirectsFollowed||0)+1;
     return get(target.href,provider,redirects+1);
    }
    cache.backoff[provider]=now()+60000;recordFailure({provider,category:'redirect_blocked',status:r.status});return null;
   }
   const entity=new URL(url).pathname.match(/^\/ws\/2\/(recording|work)\/([0-9a-f-]+)\/?$/i);
   if(provider==='MusicBrainz'&&r.status===404&&entity&&uuid(entity[2])){
    d.notFound ||= {};d.notFound[entity[1]]=(d.notFound[entity[1]]||0)+1;
    return {notFound:true,body:{},ttl:DAY};
   }
   let body;try{body=await r.json();}catch{
    const retry=r.headers.get('retry-after'),seconds=Number(retry),until=retry?(Number.isFinite(seconds)?now()+seconds*1000:Date.parse(retry)):0;
    cache.backoff[provider]=Math.max(now()+(r.status===429||r.status===503?300000:60000),Number.isFinite(until)?until:0);
    recordFailure({provider,category:r.ok?'invalid_json':'http_error',status:r.status});return null;
   }
   if(!body||typeof body!=='object'){cache.backoff[provider]=now()+60000;recordFailure({provider,category:'invalid_response',status:r.status});return null;}
   // A missing reference track is not a provider outage. Continue with other taste songs.
   if(provider==='Last.fm'&&[6,7].includes(body.error))return {body:{similartracks:{track:[]}},ttl:3600000};
   if(!r.ok||body.error){
    const rate=r.status===429||r.status===503||body.error===29;
    const retry=r.headers.get('retry-after'),seconds=Number(retry);
    const until=retry?(Number.isFinite(seconds)?now()+seconds*1000:Date.parse(retry)):0;
    cache.backoff[provider]=Math.max(now()+(rate?300000:60000),Number.isFinite(until)?until:0);
    recordFailure({provider,category:'http_or_api_error',status:r.status,code:typeof body.error==='number'?body.error:undefined});return null;
   }
   const cc=r.headers.get('cache-control')||'';
   const maxAge=cc.match(/(?:^|,)\s*max-age=(\d+)/i);
   return {body,ttl:/no-store|no-cache/i.test(cc)?0:maxAge?Math.min(7*DAY,Number(maxAge[1])*1000):DAY};
  }catch(error){cache.backoff[provider]=now()+60000;recordFailure({provider,category:['TimeoutError','AbortError'].includes(error?.name)?'timeout':'network_or_request',errorName:['TypeError','Error','TimeoutError','AbortError'].includes(error?.name)?error.name:'Error'});return null;}
 }
 const active=new Map([...(state.seedSongs||[]),...Object.values(state.songRatings||{}).filter(t=>t.value==='replay')].filter(t=>!state.songRatings?.[keyOf(t)]||state.songRatings[keyOf(t)].value==='replay').map(t=>[keyOf(t),t]));
 const deniedKeys=new Set([...excluded,...Object.keys(state.songRatings||{}),...Object.keys(state.familiar||{}),...(state.seedSongs||[]).map(keyOf)]);
 const denied=t=>deniedKeys.has(keyOf(t));
 const trimCache=()=>{
 for(const [key,q] of Object.entries(cache.queries))if(q.until<=now()||!active.has(key))delete cache.queries[key];
 cache.queries=Object.fromEntries(Object.entries(cache.queries).slice(-40));
 for(const [key,q] of Object.entries(cache.secondary))if(q.until<=now()||!active.has(key))delete cache.secondary[key];
 cache.secondary=Object.fromEntries(Object.entries(cache.secondary).slice(-40));
 cache.seedIds=Object.fromEntries(Object.entries(cache.seedIds).filter(([,v])=>v.until>now()).slice(-100));
 cache.identities=Object.fromEntries(Object.entries(cache.identities).filter(([,v])=>v.until>now()).slice(-400));
 cache.languages=Object.fromEntries(Object.entries(cache.languages).filter(([,v])=>v.until>now()).slice(-400));
 };
 const referenceCounts=new Map();
 for(const t of existing){if(t.evidence?.reference){const k=keyOf(t.evidence.reference);referenceCounts.set(k,(referenceCounts.get(k)||0)+1);}}
 const cappedReferences=new Set([...referenceCounts].filter(([,n])=>n>=2).map(([k])=>k));
 const available=()=>{
  const audit={expiredReference:0,inactiveReference:0,cappedReference:0,ratedOrExcluded:0,duplicate:0,unknownLanguage:0,otherLanguage:0,eligibleBeforePoolLimit:0,languages:{}};
  const rows=[],seen=new Set();
  for(const [key,q] of Object.entries(queries())){
   if(q.until<=now()){audit.expiredReference+=q.tracks.length;continue;}
   if(!active.has(key)){audit.inactiveReference+=q.tracks.length;continue;}
   if(cappedReferences.has(key)){audit.cappedReference+=q.tracks.length;continue;}
   for(const t of q.tracks){
    if(denied(t)){audit.ratedOrExcluded++;continue;}
    if(seen.has(keyOf(t))){audit.duplicate++;continue;}
    const info=cache.languages[keyOf(t)]||cache.identities[keyOf(t)],labels=info?.until>now()?(info.labels||[]):[];
    for(const l of labels.length?labels:['Unknown'])audit.languages[l]=(audit.languages[l]||0)+1;
    if(language!=='Mixed'&&!labels.some(l=>selectedLanguages(language).includes(l))){audit[labels.length?'otherLanguage':'unknownLanguage']++;continue;}
    let a=anchors.find(a=>keyOf(a)===key);
    if(!a){const ref=active.get(key);a={id:Math.max(0,...anchors.map(x=>x.id))+1,artist:ref.artist,title:ref.title,source:state.songRatings?.[key]?.value==='replay'?'liked song':'playlist song'};anchors.push(a);}
    seen.add(keyOf(t));rows.push({...t,anchorIds:[a.id],evidence:{type:'similar_track',provider:t.provider||'Last.fm',candidateId:t.id,reference:{artist:a.artist,title:a.title},match:t.match,url:t.url,languages:labels,recordingId:info?.recordingId||(t.provider==='ListenBrainz'?t.mbid:undefined),releaseId:info?.releaseId||t.releaseId,artistIds:info?.artistIds||t.artistIds}});
   }
  }
  audit.eligibleBeforePoolLimit=rows.length;d.eligibility=audit;
  // Interleave starting songs so a large response from one reference cannot monopolize the pool.
  const buckets=new Map();for(const t of rows.sort((a,b)=>b.match-a.match)){const k=t.anchorIds[0];if(!buckets.has(k))buckets.set(k,[]);if(buckets.get(k).length<4)buckets.get(k).push(t);}
  const out=[];while(out.length<24&&[...buckets.values()].some(a=>a.length))for(const list of buckets.values()){if(list.length&&out.length<24)out.push(list.shift());}return out;
 };
 let rows=available();
 if(rows.length>=24&&(language!=='Mixed'||enrichLanguage||(d.identityChecks||0)>=2)){d.cacheHits+=rows.length;trimCache();return rows;}
 const needsLanguage=language!=='Mixed'||enrichLanguage;
 const backlog=()=>Object.entries(queries()).filter(([k,v])=>v.until>now()&&active.has(k)&&!cappedReferences.has(k))
  .flatMap(([,v])=>v.tracks).filter(t=>!denied(t)&&!(cache.languages[keyOf(t)]?.until>now()));
 // Drain saved candidates before purchasing more metadata work with external requests.
 const backlogFirst=needsLanguage&&backlog().length>=12&&!(cache.backoff.MusicBrainz>now());
 d.scheduling={mode:backlogFirst?'enrich_saved_candidates':'discover_then_enrich',backlogBefore:backlog().length,lastfmRequestLimit:6,metadataPaused:cache.backoff.MusicBrainz>now()};
 for(const a of (lastfmEnabled(env)&&!backlogFirst?anchors:[]).filter(a=>!cappedReferences.has(keyOf(a))).slice(0,6)){
  const key=keyOf(a);usedSources.add(key);if(cache.queries[key]?.until>now()){d.cacheHits++;continue;}
  const u=new URL('https://ws.audioscrobbler.com/2.0/');
  u.search=new URLSearchParams({method:'track.getsimilar',artist:a.artist,track:a.title,autocorrect:'0',limit:'30',format:'json',api_key:env.LASTFM_API_KEY});
  const response=await get(u.href,'Last.fm');if(!response)continue;
  const raw=response.body.similartracks?.track;
  if(!Array.isArray(raw)){d.errors.push({provider:'Last.fm',category:'invalid_shape'});continue;}
  const tracks=raw.filter(t=>text(t.name)&&text(t.artist?.name)&&Number.isFinite(Number(t.match))&&Number(t.match)>0).map(t=>({provider:'Last.fm',artist:t.artist.name.trim(),title:t.name.trim(),id:keyOf({artist:t.artist.name.trim(),title:t.name.trim()}),match:Number(t.match),mbid:uuid(t.mbid)?t.mbid:null,url:sourceLink(t.url)||'https://www.last.fm/music/'+encodeURIComponent(t.artist.name.trim())+'/_/'+encodeURIComponent(t.name.trim())}));
  // Responses that prohibit reuse can serve this request, but never enter the source cache.
  if(response.ttl>0)cache.queries[key]={until:now()+response.ttl,tracks};
  else transient[key]={until:deadline+1,tracks};
 }
 // ListenBrainz is optional and fails independently of Last.fm. Its public dataset API
 // requires MusicBrainz recording IDs; exact title/credit matching resolves only unambiguous seeds.
 if(env.LISTENBRAINZ_ENABLED!=='false'&&!backlogFirst)for(const a of anchors.filter(a=>!cappedReferences.has(keyOf(a))).slice(0,2)){
  const key=keyOf(a);if(cache.secondary[key]?.until>now()){d.cacheHits++;continue;}
  let id=cache.seedIds[key]?.until>now()?cache.seedIds[key].id:null;
  if(!id&&!(cache.seedIds[key]?.until>now())){
   const quote=x=>'"'+x.replace(/[\\"]/g,'\\$&')+'"';
   const q=new URLSearchParams({query:'recording:'+quote(a.title)+' AND artist:'+quote(a.artist),fmt:'json',limit:'5'});
   const found=await get('https://musicbrainz.org/ws/2/recording?'+q,'MusicBrainz');
   if(found){const matches=(Array.isArray(found.body.recordings)?found.body.recordings:[]).filter(r=>uuid(r.id)&&norm(r.title)===norm(a.title)&&artistMatches(a.artist,r['artist-credit']||[]));
    id=matches.length===1?matches[0].id:null;cache.seedIds[key]={id,until:now()+(id?30*DAY:DAY)};}
  }
  if(!id){d.unresolvedSeeds=(d.unresolvedSeeds||0)+1;continue;}
  const algorithm=env.LISTENBRAINZ_ALGORITHM||'session_based_days_7500_session_300_contribution_5_threshold_15_limit_50_skip_30_top_n_listeners_1000';
  const response=await get('https://labs.api.listenbrainz.org/similar-recordings/json?'+new URLSearchParams({recording_mbids:id,algorithm}),'ListenBrainz');
  if(!response)continue;
  if(!Array.isArray(response.body)){d.errors.push({provider:'ListenBrainz',category:'invalid_shape'});continue;}
  const raw=response.body.filter(t=>uuid(t.recording_mbid)&&t.reference_mbid===id&&t.recording_mbid!==id&&text(t.recording_name)&&text(t.artist_credit_name)&&Number.isFinite(Number(t.score))&&Number(t.score)>0).slice(0,30);
  const top=Math.max(1,...raw.map(t=>Number(t.score)));
  const tracks=raw.map(t=>({provider:'ListenBrainz',artist:t.artist_credit_name,title:t.recording_name,id:keyOf({artist:t.artist_credit_name,title:t.recording_name}),match:Number(t.score)/top,mbid:t.recording_mbid,
   releaseId:uuid(t.release_mbid)?t.release_mbid:null,artistIds:(Array.isArray(t['[artist_credit_mbids]']||t.artist_credit_mbids)?(t['[artist_credit_mbids]']||t.artist_credit_mbids):[]).filter(uuid),url:'https://listenbrainz.org/'}));
  d.listenBrainzResults=(d.listenBrainzResults||0)+tracks.length;
  if(response.ttl>0)cache.secondary[key]={until:now()+response.ttl,tracks};
  else transient[key]={until:deadline+1,tracks:[...(queries()[key]?.tracks||[]),...tracks]};
 }
 // Mixed ranking does not require language labels. Enrich separately during daily warming.
 if(language==='Mixed'&&!enrichLanguage){
  // Identity lookup is best-effort for Mixed, never a playback or recommendation dependency.
  for(const t of available()){
   if((d.identityChecks||0)>=2)break;
   if(!uuid(t.mbid)||cache.identities[keyOf(t)]?.until>now()||cache.languages[keyOf(t)]?.recordingId)continue;
   d.identityChecks=(d.identityChecks||0)+1;
   const r=await get('https://musicbrainz.org/ws/2/recording/'+t.mbid+'?inc=artist-credits+releases&fmt=json','MusicBrainz');
   if(r&&uuid(r.body.id)&&norm(r.body.title)===norm(t.title)&&artistMatches(t.artist,r.body['artist-credit']||[]))cache.identities[keyOf(t)]={recordingId:r.body.id,artistIds:(r.body['artist-credit']||[]).map(c=>c.artist?.id).filter(uuid),releaseId:(r.body.releases||[]).find(r=>uuid(r.id))?.id,until:now()+30*DAY};
  }
  rows=available();d.eligible=rows.length;trimCache();return rows;
 }
 // Resolve recordings, then their performed works. Release text-language is never a song label.
 // Only enrich tracks that could enter this batch, fairly across taste references.
 // Previously this scanned capped/inactive references and exhausted the metadata budget.
 const queues=Object.entries(queries()).filter(([key,q])=>q.until>now()&&active.has(key)&&!cappedReferences.has(key))
  .map(([,q])=>q.tracks.filter(t=>!denied(t)&&!(cache.languages[keyOf(t)]?.until>now())));
 const candidates=[];
 for(let i=0;queues.some(q=>i<q.length);i++)for(const q of queues)if(q[i])candidates.push(q[i]);
 d.enrichmentQueued=candidates.length;
 const visited=new Set();
 for(const t of candidates){
  const key=keyOf(t);if(visited.has(key)||cache.languages[key]?.until>now())continue;visited.add(key);
  if(d.requests>=24||now()+9000>deadline||cache.backoff.MusicBrainz>now())break;
  const missing=()=>{cache.languages[key]={labels:[],until:now()+DAY};d.unknownLanguage++;};
  const lookup=id=>get(`https://musicbrainz.org/ws/2/recording/${id}?inc=work-rels+artist-credits+releases&fmt=json`,'MusicBrainz');
  let id=t.mbid,rec=id?await lookup(id):null;
  if(id&&!rec)continue; // An outage must not be cached as a metadata miss.
  if(!id||rec?.notFound){
   if(id)d.recordingSearchFallbacks=(d.recordingSearchFallbacks||0)+1;
   const quote=s=>'"'+s.replace(/[\\"]/g,'\\$&')+'"';
   const q=new URLSearchParams({query:'recording:'+quote(t.title)+' AND artist:'+quote(t.artist),fmt:'json',limit:'5'});
   const found=await get('https://musicbrainz.org/ws/2/recording?'+q,'MusicBrainz');if(!found)continue;
   if(!Array.isArray(found.body.recordings)){d.errors.push({provider:'MusicBrainz',category:'invalid_search_response'});continue;}
   const matches=found.body.recordings.filter(r=>norm(r.title)===norm(t.title)&&artistMatches(t.artist,r['artist-credit']||[])&&uuid(r.id));
   if(matches.length!==1){missing();continue;}
   id=matches[0].id;rec=await lookup(id);if(!rec)continue;
  }
  if(rec.notFound){missing();continue;}
  // Merged IDs may differ; exact title, artist and version checks still apply.
  if(!uuid(rec.body.id)||/\b(instrumental|karaoke)\b/i.test(t.title+' '+(rec.body.disambiguation||''))||norm(rec.body.title)!==norm(t.title)||!artistMatches(t.artist,rec.body['artist-credit']||[])){missing();continue;}
  id=rec.body.id;
  const works=(rec.body.relations||[]).filter(r=>r.type==='performance'&&uuid(r.work?.id)).map(r=>r.work.id);
  const labels=[];let complete=true,missingWork=false;
  // Medleys can have many works; leave them unknown rather than attach partial language evidence.
  if(works.length>3){cache.languages[key]={labels:[],until:now()+DAY};continue;}
  for(const work of works){const result=await get(`https://musicbrainz.org/ws/2/work/${work}?fmt=json`,'MusicBrainz');if(result?.notFound){missingWork=true;}else if(result&&uuid(result.body.id))labels.push(...workLanguages(result.body));else complete=false;}
  if(missingWork){missing();continue;}
  if(complete){cache.languages[key]={recordingId:id,artistIds:(rec.body['artist-credit']||[]).map(c=>c.artist?.id).filter(uuid),releaseId:(rec.body.releases||[]).find(r=>uuid(r.id))?.id,labels:[...new Set(labels)],until:now()+(labels.length?30*DAY:DAY)};if(labels.length)d.verifiedLanguage++;else d.unknownLanguage++;}
 }
 trimCache();
 d.errors=d.errors.slice(-12);
 rows=available();d.eligible=rows.length;d.stopReason=cache.backoff.MusicBrainz>now()?'metadata_provider_cooldown':d.requests>=24?'request_budget':now()+9000>deadline?'deadline':'available_metadata_checked';return rows;
}
