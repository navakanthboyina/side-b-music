import {fillWithRatedSongs,verifiedSongLanguages} from './rated-fallback.mjs';
import {catalogFetcher} from './catalog-access.mjs';
import {PRIMARY_MODEL,rankCandidates,selectDiverse,rerankBatch,RECENT_MS,identities,uuid,cleanDraft,rankingStatus} from './ranking.mjs';
import {resolveResource,activityState,recordActivity,getResource} from './resources.mjs';
import {discoverSongs,discoveryEnabled} from './song-discovery.mjs';
import {cachedCatalogFetch} from './catalog-cache.mjs';
import {searchLanguageCandidates} from './language-search.mjs';
import {comfortSongs} from './comfort.mjs';
import {prioritizeLanguageReferences} from './language-discovery.mjs';
import {findPreview,safePreviewUrl,applePreview} from './preview.mjs';
import {LANGUAGES,languageSelection} from './languages.mjs';
import {collectEvidenceCandidates as collectCandidates, memoizedCatalogFetch} from './evidence.mjs';
import starter from './starter.mjs';
import { songKey } from '../ai-core.mjs';
import { RELEVANCE_VERSION, credits, matchesArtist, tasteAnchors, relevanceMessages, parseRelevantPicks, selectionFormat } from './relevance.mjs';

export const RECOMMENDER_BUILD = 'apple-backoff-1';
export const MODEL = PRIMARY_MODEL;
const WINDOW = 14 * 86400000;
const norm = s => s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const fail = (status, message) => Object.assign(new Error(message), { status });
const validText = s => typeof s === 'string' && s.trim() && s.length <= 300;
const cleanSong = s => {
  if (!s || !validText(s.artist) || !validText(s.title) || !norm(s.artist) || !norm(s.title)) throw fail(400, 'Artist and song title are required.');
  return { artist: s.artist.trim(), title: s.title.trim() };
};
const query = (db, sql, ...args) => db.prepare(sql).bind(...args);
async function read(db) {
  const row = await query(db, 'SELECT * FROM community WHERE id=1').first();
  if (!row) throw fail(503, 'Shared database needs its migration.');
  return { ...row, state: JSON.parse(row.data) };
}
async function readDiscovery(db) {
  const row=await query(db,"SELECT revision,lease,lease_until,next_refresh,json_remove(data,'$.catalogCache','$.referenceLanguageCache') AS data FROM community WHERE id=1").first();
  if(!row)throw fail(503,'Shared database needs its migration.');
  return {...row,state:JSON.parse(row.data)};
}
async function readPublic(db) {
  const row=await query(db,"SELECT revision,lease_until,next_refresh,json_remove(data,'$.catalogCache','$.songDiscovery','$.referenceLanguageCache','$.shown','$.history') AS data FROM community WHERE id=1").first();
  if(!row)throw fail(503,'Shared database needs its migration.');
  return {...row,state:JSON.parse(row.data)};
}
function publicState(row) {
  return { revision: row.revision, recommenderVersion: RELEVANCE_VERSION, recommenderBuild: RECOMMENDER_BUILD, familiarLanguageOverrideSupported:true, batch: row.state.batch?.relevanceVersion===RELEVANCE_VERSION ? row.state.batch : null, needsTasteImport: !(row.state.seedSongs?.length), songRatings: row.state.songRatings,
    comfortSongs:comfortSongs(row.state), comfortShuffle:true, batchTarget: 12, previewSupported:true, multiLanguage:true, languages:LANGUAGES, pendingLanguage:row.state.pending?.language||'Mixed', pendingSelectionStats: row.state.lastSelectionStats || (row.state.pending?.at>Date.now()-86400000?row.state.pending.selectionStats:null), lastSelectionStats:row.state.lastSelectionStats||null,
    pendingSongCount: row.state.pending?.at>Date.now()-86400000 ? row.state.pending.items.length : 0,
    refreshing: row.lease_until > Date.now(), nextRefresh: row.next_refresh,
    seedSongCount: Object.keys(row.state.familiar).length, model: MODEL };
}
async function mutate(db, edit) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await read(db); edit(row.state);
    const result = await query(db, 'UPDATE community SET data=?, revision=revision+1 WHERE id=1 AND revision=?', JSON.stringify(row.state), row.revision).run();
    if (result.meta.changes) return publicState(await readPublic(db));
  }
  throw fail(409, 'Someone else updated the shared profile. Please try again.');
}
async function limited(db, key, max, expires) {
  const result = await query(db, `INSERT INTO limits(key,count,expires) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`, key, expires, max).first();
  if (!result) throw fail(429, 'Shared usage limit reached. Please try later; existing picks are still saved.');
}
async function bodyOf(request, max = 4096) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw fail(415, 'Send JSON.');
  if (Number(request.headers.get('content-length')) > max) throw fail(413, 'Request too large.');
  const reader = request.body?.getReader(); let length = 0, chunks = [];
  if (!reader) throw fail(400, 'Missing request body.');
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length; if (length > max) { await reader.cancel(); throw fail(413, 'Request too large.'); }
    chunks.push(value);
  }
  const all = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw fail(400, 'Invalid JSON.'); }
}
async function ipLimit(request, db) {
  const now = Date.now(), minute = Math.floor(now / 60000);
  const input = `${minute}:${request.headers.get('cf-connecting-ip') || 'local'}`;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  await limited(db, `feedback:${hash}`, 30, now + 120000);
}
function knownSongs(state) {
  return [...starter.map(a=>({artist:a.name,title:a.track})), ...(state.seedSongs||[]), ...(state.batch?.items || []), ...Object.values(state.songRatings)];
}
export {collectEvidenceCandidates as collectCandidates} from './evidence.mjs';
export function aiReplyText(result) {
  const value = result?.response ?? result?.choices?.[0]?.message?.content;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}
export function aiFailureDiagnostic(response, error, candidateCount, attempt) {
  const reply = response?.response;
  return {
    event: 'munna-ai-validation', version: 1, model: MODEL, attempt: attempt + 1,
    candidateCount, responseType: typeof reply,
    responseKeys: response && typeof response === 'object' ? Object.keys(response).slice(0,10) : [],
    rejected: error.diagnostics?.rejected || null,
    formatError:error.diagnostics?.formatError||null,
    languageDistribution:error.diagnostics?.languageDistribution||null,
    validationError: error.message || null,
    replyLength: (typeof reply === 'string' ? reply : JSON.stringify(reply) || '').length
  };
}
export function budgetedCatalogFetch(fetcher,stats,deadline) {
  const hosts=new Set(['itunes.apple.com','api.deezer.com']),failures=new Map();
  const record=(host,category,status)=>{failures.set(host,(failures.get(host)||0)+1);stats.providerFailures={...(stats.providerFailures||{}),[host]:failures.get(host)};const list=stats.catalogErrors||(stats.catalogErrors=[]);if(list.length<12)list.push({host,category,...(status?{status}:{})});};
  const problem=code=>Object.assign(new Error(code),{catalogCode:code});
  return async(input,options={})=>{
    let url=new URL(input);const {timeoutMs=8000,...fetchOptions}=options;
    for(let hop=0;hop<=2;hop++) {
      if(url.protocol!=='https:'||!hosts.has(url.hostname)||url.username||url.password)throw problem('unsupported redirect destination');
      if((failures.get(url.hostname)||0)>=3)throw problem('provider paused after repeated failures');
      if(stats.catalogRequests>=30||Date.now()>=deadline)throw problem('request budget exhausted');
      stats.catalogRequests++;
      let response;
      try {response=await fetcher(url.toString(),{...fetchOptions,signal:AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,deadline-Date.now()))),redirect:'manual'});}
      catch(error){record(url.hostname,/timeout|abort/i.test(String(error?.name)+' '+String(error?.message))?'timeout':'network_error');throw problem('catalog network request failed');}
      if(response.status>=400)record(url.hostname,'http_error',response.status);
      else if(response.status===200){try{const data=await response.clone().json();if(data?.error){record(url.hostname,'api_error');}}catch{record(url.hostname,'invalid_json');}}


      if(![301,302,303,307,308].includes(response.status))return response;
      const location=response.headers.get('location');
      await response.body?.cancel();
      if(!location)throw problem('redirect missing location');
      if(hop===2)throw problem('too many redirects');
      url=new URL(location,url);
    }
  };
}
export function inferenceFailure(error) {
  // Classify locally; never return provider messages, which may echo prompt data.
  const message=typeof error==='string'?error:String(error?.message||error?.cause?.message||''), code=String(error?.code||error?.cause?.code||'');
  const numericCode=/^\d{3,6}$/.test(code)?Number(code):Number(message.match(/(?:^|error[ :]*|code[ :=]*)(\d{3,6})\b/i)?.[1])||null;
  const known={5028:['model_unavailable','The configured AI model has been retired. The owner must update it.'],5007:['model_unavailable','The selected AI model was not found.'],3042:['model_unavailable','The model ID is invalid.'],5035:['access','This AI model requires a paid Workers plan.'],5018:['access','This account cannot access the AI model.'],3041:['access','This account cannot access the AI model.'],5016:['access','The model terms must be accepted.'],3023:['access','AI is unavailable for this account.'],3036:['quota','Cloudflare AI allowance is exhausted.'],3040:['rate_limit','Cloudflare AI is temporarily out of capacity.'],3007:['timeout','Cloudflare AI timed out.'],3006:['request_invalid','The AI request is too large.']};
  if(known[numericCode])return {category:known[numericCode][0],detail:known[numericCode][1],code:numericCode};
  let category='provider_error',detail='Cloudflare AI could not complete the request.';
  if(/quota|neurons|daily.*limit|allowance/i.test(message)){category='quota';detail='Cloudflare AI allowance is exhausted.';}
  else if(/rate.?limit|too many requests|\b429\b/i.test(message)){category='rate_limit';detail='Cloudflare AI is rate limiting requests.';}
  else if(/unauthorized|forbidden|not authorized|permission|\b401\b|\b403\b/i.test(message)){category='access';detail='Cloudflare denied access to the AI model.';}
  else if(/grammar|json.?schema|response.format|JSON Mode/i.test(message)){category='response_format';detail='Cloudflare could not generate the requested structured response.';}
  else if(/timed? ?out|timeout/i.test(message)){category='timeout';detail='Cloudflare AI timed out.';}
  else if(/deprecated|retired|model.*not found|unknown model|model.*not available/i.test(message)){category='model_unavailable';detail='The selected AI model is unavailable.';}
  return {category,detail,...(numericCode?{code:numericCode}:{})};
}
async function refresh(env,language='Mixed',allowUnverifiedFamiliar=false) {
  let referenceCache,catalogCache,discoveryCache,latestStats,cacheSaved=false;
  const now = Date.now(), lease = crypto.randomUUID();
  const locked = await query(env.DB, 'UPDATE community SET lease=?, lease_until=?, next_refresh=? WHERE id=1 AND lease_until<=? AND next_refresh<=?', lease, now+180000, now+60000, now, now).run();
  if (!locked.meta.changes) throw fail(409, 'A shared batch is generating, or refresh is cooling down. Wait a minute and check again.');
  try {
    await limited(env.DB, 'generation:'+new Date(now).toISOString().slice(0,10), 30, now+2*86400000);
    // Advance source rotation even on empty catalog/AI failure, without replacing the saved batch.
    await query(env.DB,"UPDATE community SET data=json_set(data,'$.rotation',coalesce(json_extract(data,'$.rotation'),0)+1),revision=revision+1 WHERE id=1").run();
    const row = discoveryEnabled(env)?await readDiscovery(env.DB):await read(env.DB), state = row.state;
    const ratings = Object.values(state.songRatings).sort((a,b)=>b.at-a.at);
    const feedback=ratings.slice(0,24).map(({artist,title,value})=>({artist,title,rating:value}));
    const draft=[RECOMMENDER_BUILD,'song-identity-1','preview-match-1','familiar-language-option-1','rated-fallback-1','provider-resilience-1','candidate-ranking-1','discovery-audit-1','preview-cpu-1','discovery-diversity-1','musicbrainz-missing-1','musicbrainz-redirect-1','discovery-runtime-2','saved-discovery-1','catalog-recovery-1','language-search-1','reference-cache-1','comfort-replay-1','compact-selection-1','language-discovery-1'].includes(state.pending?.selectionStats?.build)&&(state.pending.language||'Mixed')===language&&state.pending?.at>now-86400000?state.pending:null;
    let picks=cleanDraft((draft?.items||[]).filter(t=>allowUnverifiedFamiliar||language==='Mixed'||!t.unverifiedFamiliar),state).slice(0,12);const shortlist=[...picks];
    const modern=discoveryEnabled(env);
    if(modern)state.activity=await activityState(env.DB);
    discoveryCache=state.songDiscovery||{queries:{},languages:{},backoff:{}};state.songDiscovery=discoveryCache;
    const selectionStats=latestStats={at:now,engine:modern?'Last.fm + ListenBrainz + MusicBrainz':'legacy catalog',build:RECOMMENDER_BUILD,target:12,language,resumedCount:picks.length,candidateCount:0,catalogRequests:0,pools:[],attempts:[]};
    const usedSources=new Set(draft?.usedSources||[]),examined=new Set([...(draft?.examined||[]),...picks.map(songKey)]),deadline=now+(modern?90000:155000);
    referenceCache=state.referenceLanguageCache||{};state.referenceLanguageCache=referenceCache;
    const referenceQueue=modern||language==='Mixed'?null:await prioritizeLanguageReferences(tasteAnchors(state,usedSources,64),language,input=>env.AI.run(MODEL,input),selectionStats,Math.min(20000,deadline-Date.now()),referenceCache);
    // One refresh has a bounded request/time budget, including every replacement pool.
    catalogCache=state.catalogCache||{};state.catalogCache=catalogCache;
    const fetchCatalog=memoizedCatalogFetch(cachedCatalogFetch(budgetedCatalogFetch(catalogFetcher(env),selectionStats,deadline),catalogCache,selectionStats));
    const providersPaused=()=>['itunes.apple.com','api.deezer.com'].every(h=>(selectionStats.providerFailures?.[h]||0)>=3);
    for(let pool=0;pool<3&&picks.length<12&&Date.now()<deadline;pool++) {
      const poolState={...state,rotation:state.rotation+pool};
      const capped=new Set([...new Set(picks.map(t=>norm(t.artist)))].filter(a=>picks.filter(t=>norm(t.artist)===a).length>=2));
      let anchors=referenceQueue?referenceQueue.filter(a=>!usedSources.has(songKey(a))&&!capped.has(norm(a.artist))).slice(0,16):tasteAnchors(poolState,new Set([...usedSources,...capped]));
      if(!anchors.length&&picks.length){usedSources.clear();anchors=tasteAnchors(poolState,capped);}
      if(!anchors.length){if(pool===0&&!picks.length)throw fail(409,'Playlist song details need a one-time owner re-import before relevant recommendations can be generated.');break;}
      const poolStats={pool:pool+1,candidates:0,accepted:0};selectionStats.pools.push(poolStats);
      let candidates;
      try {
        if(modern){poolStats.discoveryMode='saved song-to-song discovery';candidates=await discoverSongs(state,env,{anchors,excluded:examined,usedSources,existing:picks,language,stats:selectionStats,deadline});}
        else {candidates=language==='Mixed'?[]:await searchLanguageCandidates(poolState,fetchCatalog,{anchors,usedSources,excluded:examined,language,stats:poolStats});
        if(candidates.length)poolStats.discoveryMode='language search';
        else {poolStats.discoveryMode='reference release fallback';candidates=await collectCandidates(poolState,fetchCatalog,{anchors,usedSources,excluded:examined,sourceLimit:6,language});}}

      } catch(error) {
        poolStats.error=error.status===422?'no fresh candidates':'catalog unavailable';
        poolStats.detail=error.message.slice(0,700);
        if(selectionStats.catalogRequests>=30||providersPaused()){selectionStats.stopReason=providersPaused()?'both_catalogs_paused':'catalog_budget';break;}
        continue;
      }
      if(!candidates.length){poolStats.error='no eligible saved candidates';continue;}
      poolStats.candidates=candidates.length;selectionStats.candidateCount+=candidates.length;
      if(modern){
        const ranking={};const ranked=rankCandidates(candidates,anchors,state,language,ranking);
        shortlist.push(...ranked);const before=picks.length;picks=selectDiverse(ranked,picks,12,language);
        poolStats.accepted=picks.length-before;poolStats.ranking=ranking;
        // Ranking is deterministic here; AI only reorders a complete verified shortlist.
        for(const t of candidates)examined.add(songKey(t));
        continue;
      }
      const before=picks.length,messages=relevanceMessages(candidates,anchors,feedback,language);
      messages.push({role:'user',content:`Score all ${candidates.length} candidates, one entry for every ID: ${candidates.map((_,i)=>i+1).join(',')}. Do not stop after one good match. Rank the supplied evidence; unfamiliar titles are not evidence of a poor match. The server selects qualifying songs and enforces the batch size and artist limits. No IDs outside this list.`});
      let structured=false;const evaluatedIds=new Set();
      for(let attempt=0;attempt<2&&picks.length<12&&Date.now()<deadline;attempt++) {
        let timer,response;
        const stats={pool:pool+1,returned:0,accepted:0,structured};selectionStats.attempts.push(stats);
        try {
          response=await Promise.race([
            env.AI.run(MODEL,{messages,max_tokens:2000,temperature:0, ...(structured?{response_format:selectionFormat(candidates.length)}:{})}),
            new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('AI timed out')),Math.max(1,Math.min(35000,deadline-Date.now())));})
          ]).finally(()=>clearTimeout(timer));
        } catch(error) {
          stats.error='inference failed';stats.inference=inferenceFailure(error);
          console.warn(JSON.stringify({event:'munna-inference-error',model:MODEL,...stats.inference}));
          if(['quota','rate_limit','access','model_unavailable'].includes(stats.inference.category))throw Object.assign(fail(503,stats.inference.detail+' Previous picks remain saved.'),{selectionStats});
          // Use a bounded unstructured retry for format or unclassified provider failures.
          // IDs, scores, references and artist limits still pass the same validator.
          if(['response_format','provider_error'].includes(stats.inference.category))structured=false;
          continue;
        }
        const replyText=aiReplyText(response);
        try {picks=parseRelevantPicks(replyText,candidates,anchors,picks,stats,12,language);}
        catch(error){stats.error='validation failed';error.diagnostics=stats;console.warn(JSON.stringify(aiFailureDiagnostic(response,error,candidates.length,attempt)));}
        for(const id of stats.scoredIds||[]){evaluatedIds.add(id);examined.add(songKey(candidates[id-1]));}
        const remainingIds=candidates.flatMap((_,i)=>evaluatedIds.has(i+1)?[]:[i+1]);
        if(!remainingIds.length){poolStats.fullyScored=true;break;}
        const selectedIds=candidates.flatMap((t,i)=>picks.some(p=>songKey(p)===songKey(t))?[i+1]:[]);
        messages.push({role:'user',content:`Last pass: ${stats.formatError||stats.error||'incomplete coverage'}. Rejections: ${JSON.stringify(stats.rejected||{})}. Accepted IDs: ${JSON.stringify(selectedIds)}. Return additional supported selections by scoring every remaining ID in this pool: ${remainingIds.join(',')}. Use supplied release evidence even for songs you do not recognize. JSON only: {"picks":[{"id":1,"score":80,"language":"actual sung language or Unknown"}]}. EVERY entry must include id, score and language. Missing or invalid language fields must be corrected; never assume a song matches the requested language. Return wrong-language and Unknown labels too, so the server can validate them. Never invent IDs. Do not stop after the first match.`});
      }
      poolStats.accepted=picks.length-before;
      if(selectionStats.catalogRequests>=30||providersPaused()){selectionStats.stopReason=providersPaused()?'both_catalogs_paused':'catalog_budget';break;}
    }
    if(modern)picks=fillWithRatedSongs(picks,state,language,selectionStats,Date.now(),allowUnverifiedFamiliar);
    if(!picks.length&&selectionStats.attempts.length&&selectionStats.attempts.every(a=>a.error==='inference failed'))throw Object.assign(fail(503,selectionStats.attempts.at(-1).inference.detail+' No AI selections were returned. Previous picks remain saved.'),{selectionStats});
    if(!picks.length&&language!=='Mixed'&&selectionStats.attempts.length){
      const missing=selectionStats.attempts.reduce((n,a)=>n+(a.rejected?.missingLanguage||0),0),filtered=selectionStats.attempts.reduce((n,a)=>n+(a.rejected?.languageFilter||0),0);
      throw Object.assign(fail(422,`No new ${language} picks were approved. ${missing?'AI omitted valid language labels for '+missing+' entries. ':''}${filtered?filtered+' entries were another language or Unknown. ':''}${selectionStats.attempts.some(a=>a.formatError)?'Some AI replies had an invalid format. ':''}The previous batch is unchanged. Try All languages or refresh for other playlist references.`),{selectionStats});
    }
    if(!picks.length)throw Object.assign(fail(422,`${selectionStats.candidateCount===0&&selectionStats.pools.some(p=>p.error==='catalog unavailable')?'Catalog requests failed before AI selection. ':''}Found ${picks.length} of 12 required matches after searching ${selectionStats.pools.length} candidate pools. The previous batch is unchanged. Try again later for other playlist references.`),{selectionStats});
    if(modern&&picks.length===12)picks=await rerankBatch(picks,env,selectionStats,feedback,30000,picks.some(t=>t.reusedRating)?picks:shortlist);
    if(modern&&picks.length===12){
      const enrichment={requests:0,cacheHits:0,errors:0};selectionStats.catalog=enrichment;
      const end=Date.now()+20000,base=budgetedCatalogFetch(catalogFetcher(env),{catalogRequests:0},end);
      const get=async(url,options)=>{if(enrichment.requests>=12||Date.now()>=end)throw Error('catalog_budget');enrichment.requests++;return base(url,options);};
      for(const t of picks){
        try{const diagnostics={},r=await resolveResource(env.DB,t,get,diagnostics,async(url,options)=>{if(enrichment.requests>=12||Date.now()>=end)throw Error('catalog_budget');enrichment.requests++;return (env.ARTWORK_FETCH||fetch)(url,options);});
          if(diagnostics.cacheHit)enrichment.cacheHits++;t.catalog=r.apple||r.deezer||null;t.artwork=r.artwork||null;t.artworkSource=r.artworkSource||null;
        }catch{enrichment.errors++;}
      }
    }
    state.lastSelectionStats=selectionStats;
    const at=Date.now();
    const complete=picks.length===12;
    if(complete) {
      state.batch={at,language,items:picks.map(({artist,title,reason,aiSong,rankingMode,language,languageBasis,sourceUrl,recordingId,releaseId,artistIds,catalog,artwork,artworkSource,reusedRating,unverifiedFamiliar})=>({artist,title,reason,aiSong,rankingMode,language,languageBasis,sourceUrl,recordingId,releaseId,artistIds,catalog,artwork,artworkSource,reusedRating,unverifiedFamiliar})),model:MODEL,relevanceVersion:RELEVANCE_VERSION,selectionStats};
      state.pending=null;
      state.history=[...(state.history||[]).filter(t=>at-t.at<14*86400000),...state.batch.items.map(({artist,title,recordingId})=>({artist,title,recordingId,at}))].slice(-500);
      for(const [key,time] of Object.entries(state.shown))if(at-time>=WINDOW)delete state.shown[key];
      for(const t of state.batch.items)state.shown[songKey(t)]=at;
    } else {
      state.pending={language,at:picks.length>(draft?.items.length||0)?at:draft.at,items:picks,usedSources:[...usedSources].slice(-200),examined:[...examined].slice(-500),selectionStats};
    }
    delete state.activity; // Activity has its own table and never replaces concurrent events.
    const committed = await query(env.DB,'UPDATE community SET data=?,revision=revision+1,lease=NULL,lease_until=0 WHERE id=1 AND revision=? AND lease=? AND lease_until>?',JSON.stringify(state),row.revision,lease,at).run();
    if(!committed.meta.changes)throw fail(409,'Shared feedback changed while AI was working. Existing picks remain. Refresh again for the new feedback.');
    cacheSaved=true;
    return {...publicState(await readPublic(env.DB)),generationStatus:complete?'saved':'pending',message:complete?(selectionStats.ratedFallback?.added?`12 picks saved for everyone · ${selectionStats.ratedFallback.added} returning favorites or familiar songs.`:modern?('12 picks saved for everyone · '+rankingStatus(selectionStats.ai)+'.'):'12 new AI picks saved for everyone.'):`${picks.length}/12 approved songs saved in the shared draft. ${modern&&selectionStats.discovery?.errors.length?'Discovery providers could not complete some requests; saved candidates and your draft were preserved. Check discovery errors in diagnostics.':modern?'Still looking for '+(12-picks.length)+' songs with supported language and taste matches. Cached candidates will be reused on the next refresh.':providersPaused()?'Both music catalogs failed; generation stopped and your picks were preserved. See catalogErrors in diagnostics.':'After the cooldown, refresh to find the remaining '+(12-picks.length)+'.'} The visible batch has not changed.`};
  } finally {
    if(latestStats&&!cacheSaved)await query(env.DB,"UPDATE community SET data=json_set(data,'$.lastSelectionStats',json(?)),revision=revision+1 WHERE id=1 AND lease=?",JSON.stringify(latestStats),lease).run();
    if(discoveryCache&&!cacheSaved)await query(env.DB,"UPDATE community SET data=json_set(data,'$.songDiscovery',json(?)),revision=revision+1 WHERE id=1 AND lease=?",JSON.stringify(discoveryCache),lease).run();
    if(referenceCache&&!cacheSaved)await query(env.DB,"UPDATE community SET data=json_set(data,'$.referenceLanguageCache',json(?)),revision=revision+1 WHERE id=1 AND lease=?",JSON.stringify(referenceCache),lease).run();
    if(catalogCache&&!cacheSaved)await query(env.DB,"UPDATE community SET data=json_set(data,'$.catalogCache',json(?)),revision=revision+1 WHERE id=1 AND lease=?",JSON.stringify(catalogCache),lease).run();
    await query(env.DB,'UPDATE community SET lease=NULL,lease_until=0 WHERE id=1 AND lease=?',lease).run(); }
}
function catalogSong(provider,t) {
  if(!t)return null;
  const id=provider==='apple'?t.trackId:t.id;
  const artist=provider==='apple'?t.artistName:t.artist?.name;
  const title=provider==='apple'?t.trackName:t.title;
  if(!Number.isSafeInteger(id)||id<=0||!validText(artist)||!validText(title)||!norm(artist)||!norm(title))return null;
  if(provider==='apple'&&t.kind!=='song')return null;
  return {provider,id,artist,title};
}
async function searchSongs(term,fetchCatalog) {
  let succeeded=false;
  for(const provider of ['apple','deezer']) {
    const url=provider==='apple'?'https://itunes.apple.com/search?'+new URLSearchParams({term,entity:'song',media:'music',country:'IN',limit:'20'}):'https://api.deezer.com/search?'+new URLSearchParams({q:term,limit:'20'});
    try {
      const response=await fetchCatalog(url);if(!response.ok)continue;
      const data=await response.json(),rows=provider==='apple'?data.results:data.data;
      if(!Array.isArray(rows))continue;
      succeeded=true;
      const songs=[...new Map(rows.map(t=>catalogSong(provider,t)).filter(Boolean).map(t=>[songKey(t),t])).values()].slice(0,20);
      if(songs.length)return songs;
    } catch {}
  }
  if(!succeeded)throw fail(503,'Music search is unavailable. Please try again later.');
  return [];
}

export default {
  async fetch(request, env) {
    const origin=request.headers.get('origin'), path=new URL(request.url).pathname;
    const headers={'content-type':'application/json','cache-control':'no-store','vary':'Origin','access-control-allow-origin':env.ALLOWED_ORIGIN,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type, Authorization'};
    const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
    try {
      if(origin && origin!==env.ALLOWED_ORIGIN)throw fail(403,'Origin not allowed.');
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(path==='/state'&&request.method==='GET')return reply({...publicState(await readPublic(env.DB)),discoverySetup:discoveryEnabled(env)?'ready':!env.LASTFM_API_KEY?'Last.fm key not configured':'Last.fm public-use approval not confirmed'});
      if(path==='/admin/ai-check'&&request.method==='POST') {
        if(!env.ADMIN_TOKEN||request.headers.get('authorization')!==`Bearer ${env.ADMIN_TOKEN}`)throw fail(401,'Owner access required.');
        await bodyOf(request);
        await limited(env.DB,'ai-check:'+Math.floor(Date.now()/60000),1,Date.now()+120000);
        const checks=[];
        for(const structured of [false,true]) {
          let timer;
          try {
            const result=await Promise.race([
              env.AI.run(MODEL,{messages:[{role:'user',content:'Return only this JSON: {"picks":[{"id":1,"score":80}]}'}],max_tokens:100,temperature:0,...(structured?{response_format:selectionFormat(1)}:{})}),
              new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('AI timed out')),20000);})
            ]).finally(()=>clearTimeout(timer));
            checks.push({structured,ok:true,reply:aiReplyText(result).slice(0,500)});
          }catch(error){
            // Owner-only fixed synthetic prompt: no playlist, ratings or catalog data involved.
            checks.push({structured,ok:false,...inferenceFailure(error),errorName:String(error?.name||'Error').slice(0,80),message:String(error?.message||error).slice(0,1200)});
            if(['quota','access','rate_limit','model_unavailable'].includes(inferenceFailure(error).category))break;
          }
        }
        return reply({build:RECOMMENDER_BUILD,model:MODEL,checks});
      }
      if(path==='/admin/seed'&&request.method==='POST') {
        if(!env.ADMIN_TOKEN || request.headers.get('authorization')!==`Bearer ${env.ADMIN_TOKEN}`)throw fail(401,'Owner access required.');
        const body=await bodyOf(request,2*1024*1024);
        if(!Array.isArray(body.songs)||body.songs.length>10000)throw fail(400,'Up to 10,000 songs allowed.');
        const songs=body.songs.map(cleanSong);
        return reply(await mutate(env.DB,s=>{
          s.seedSongs=[...new Map(songs.map(t=>[songKey(t),t])).values()];
          s.familiar=Object.fromEntries(songs.map(t=>[songKey(t),true]));
          s.seedArtists=[...new Set(songs.flatMap(t=>t.artist.split(/\s*(?:,|&|;)\s*/)).filter(validText))].slice(0,1000);
          s.rotation=0;
          s.pending=null;
        }));
      }
      if(request.method!=='POST'||!['/feedback','/refresh','/search','/taste/add','/preview','/activity','/comfort/shuffle'].includes(path))throw fail(404,'Not found.');
      if(origin!==env.ALLOWED_ORIGIN)throw fail(403,'Use the dashboard to update the shared profile.');
      const body=await bodyOf(request);
      if(path==='/refresh'){const language=languageSelection(body.languages??body.language);if(!language)throw fail(400,'Choose a supported language or Mixed.');if(body.allowUnverifiedFamiliar!==undefined&&typeof body.allowUnverifiedFamiliar!=='boolean')throw fail(400,'Invalid familiar-song language option.');return reply(await refresh(env,language,body.allowUnverifiedFamiliar===true));}
      if(path==='/comfort/shuffle'){await ipLimit(request,env.DB);return reply(await mutate(env.DB,s=>{s.comfortRotation=(Number(s.comfortRotation)||0)+1;}));}
      if(path==='/activity'){
        const song=cleanSong(body);if(!['play','complete','skip'].includes(body.event)||!uuid(body.eventId))throw fail(400,'Invalid playback event.');
        await ipLimit(request,env.DB);const row=await readPublic(env.DB);
        if(!knownSongs(row.state).some(t=>songKey(t)===songKey(song))&&!await getResource(env.DB,song))throw fail(400,'Choose a known song.');
        await recordActivity(env.DB,song,body.event,body.eventId);return reply({saved:true});
      }
      if(path==='/preview') {
        const previewResult=(preview,diagnostics)=>{
          console.warn(JSON.stringify({event:'munna-preview',build:RECOMMENDER_BUILD,...diagnostics,found:!!preview}));
          return reply({preview,diagnostics});
        };
        if(body.provider!==undefined){
          if(!['apple','deezer'].includes(body.provider)||!Number.isSafeInteger(body.id)||body.id<=0)throw fail(400,'Choose a catalog search result.');
          await ipLimit(request,env.DB);
          const get=budgetedCatalogFetch(catalogFetcher(env),{catalogRequests:0},Date.now()+12000);
          try{
            const url=body.provider==='deezer'?'https://api.deezer.com/track/'+body.id :'https://itunes.apple.com/lookup?id='+body.id+'&entity=song';
            const response=await get(url);if(!response.ok)throw Error();const data=await response.json();
            const raw=body.provider==='deezer'?data:data.results?.find(t=>t.trackId===body.id),song=catalogSong(body.provider,raw);
            if(!song||song.id!==body.id)throw Error();
            const diagnostics={};const r=await resolveResource(env.DB,song,get,diagnostics);
            return previewResult(r.preview,diagnostics);
          }catch{throw fail(503,'Could not load this catalog preview. Try the listening links.');}
        }

        const song=cleanSong(body),row=await readPublic(env.DB);
        if(!knownSongs(row.state).some(t=>songKey(t)===songKey(song)))throw fail(400,'Choose a song from the shared dashboard.');
        await ipLimit(request,env.DB);
        try{const diagnostics={};const known=knownSongs(row.state).find(t=>songKey(t)===songKey(song));const r=await resolveResource(env.DB,known||song,budgetedCatalogFetch(catalogFetcher(env),{catalogRequests:0},Date.now()+12000),diagnostics);return previewResult(r.preview,diagnostics);}
        catch{throw fail(503,'Song previews are unavailable right now. Try the listening links instead.');}
      }
      if(path==='/search'||path==='/taste/add') {
        await ipLimit(request,env.DB);
        const fetchCatalog=budgetedCatalogFetch(catalogFetcher(env),{catalogRequests:0},Date.now()+12000);
        if(path==='/search') {
          if(typeof body.query!=='string'||body.query.trim().length<2||body.query.length>200)throw fail(400,'Enter a song title or artist (2–200 characters).');
          return reply({songs:await searchSongs(body.query.trim(),fetchCatalog)});
        }
        if(!['apple','deezer'].includes(body.provider)||!Number.isSafeInteger(body.id)||body.id<=0)throw fail(400,'Choose a song from search results.');
        const url=body.provider==='apple'?'https://itunes.apple.com/lookup?id='+body.id+'&entity=song':'https://api.deezer.com/track/'+body.id;
        let song;
        try {
          const response=await fetchCatalog(url);if(!response.ok)throw Error();
          const data=await response.json();
          song=catalogSong(body.provider,body.provider==='apple'?data.results?.find(t=>t.trackId===body.id):data);
          if(!song||song.id!==body.id)throw Error();
        } catch {throw fail(503,'Could not verify this catalog song. Please search again later.');}
        return reply(await mutate(env.DB,s=>{
          const {artist,title}=song,key=songKey(song);
          if(s.songRatings[key]?.value==='replay')return;
          s.songRatings[key]={artist,title,value:'replay',at:Date.now()};
          if(Object.keys(s.songRatings).length>5000)throw fail(409,'Shared feedback is full. Ask the owner to archive it.');
          s.pending=null;
        }));
      }

      const song=cleanSong(body), key=songKey(song);
      if(!['replay','skip','known','clear'].includes(body.rating))throw fail(400,'Invalid feedback.');
      await ipLimit(request,env.DB);
      return reply(await mutate(env.DB,s=>{
        if(!knownSongs(s).some(t=>songKey(t)===key))throw fail(400,'Rate a song from the shared dashboard.');
        s.pending=null; // A draft must never carry scores from an older feedback profile.
        if(body.rating==='clear')delete s.songRatings[key];
        else s.songRatings[key]={...song,value:body.rating,at:Date.now(),verifiedLanguages:verifiedSongLanguages(song,s)};
        if(Object.keys(s.songRatings).length>5000)throw fail(409,'Shared feedback is full. Ask the owner to archive it.');
      }));
    } catch(error) { return reply({error:error.status?error.message:'Shared service is unavailable or its free allowance is exhausted. Existing picks remain saved.',...(error.selectionStats?{selectionStats:error.selectionStats}:{})},error.status||503); }
  },
  async scheduled(event,env) {
    await query(env.DB,'DELETE FROM limits WHERE expires<?',Date.now()).run();
    await query(env.DB,'DELETE FROM song_resources WHERE expires<?',Date.now()).run();
    await query(env.DB,'DELETE FROM activity_events WHERE expires<?',Date.now()).run();
    if(!discoveryEnabled(env))return;
    const lease=crypto.randomUUID(),now=Date.now();
    const locked=await query(env.DB,'UPDATE community SET lease=?,lease_until=? WHERE id=1 AND lease_until<=?',lease,now+60000,now).run();
    if(!locked.meta.changes)return;
    let state;
    try{
      state=(await readDiscovery(env.DB)).state;
      const anchors=tasteAnchors({...state,rotation:(state.discoveryRotation||0)+state.rotation},new Set(),16);
      await discoverSongs(state,env,{anchors,enrichLanguage:true,deadline:now+45000});
      await query(env.DB,"UPDATE community SET data=json_set(data,'$.songDiscovery',json(?),'$.discoveryRotation',?),revision=revision+1 WHERE id=1 AND lease=?",JSON.stringify(state.songDiscovery),(state.discoveryRotation||0)+1,lease).run();
    }finally{await query(env.DB,'UPDATE community SET lease=NULL,lease_until=0 WHERE id=1 AND lease=?',lease).run();}
  }
};
