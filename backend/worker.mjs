import starter from './starter.mjs';
import { songKey } from '../ai-core.mjs';
import { RELEVANCE_VERSION, credits, matchesArtist, tasteAnchors, relevanceMessages, parseRelevantPicks, selectionFormat } from './relevance.mjs';

export const RECOMMENDER_BUILD = 'active-model-12-1';
export const MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
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
function publicState(row) {
  return { revision: row.revision, recommenderVersion: RELEVANCE_VERSION, recommenderBuild: RECOMMENDER_BUILD, batch: row.state.batch?.relevanceVersion===RELEVANCE_VERSION ? row.state.batch : null, needsTasteImport: !(row.state.seedSongs?.length), songRatings: row.state.songRatings,
    batchTarget: 12, pendingSelectionStats: row.state.pending?.selectionStats || null,
    pendingSongCount: row.state.pending?.at>Date.now()-86400000 ? row.state.pending.items.length : 0,
    refreshing: row.lease_until > Date.now(), nextRefresh: row.next_refresh,
    seedSongCount: Object.keys(row.state.familiar).length, model: MODEL };
}
async function mutate(db, edit) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await read(db); edit(row.state);
    const result = await query(db, 'UPDATE community SET data=?, revision=revision+1 WHERE id=1 AND revision=?', JSON.stringify(row.state), row.revision).run();
    if (result.meta.changes) return publicState(await read(db));
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
  return [...starter.map(a=>({artist:a.name,title:a.track})), ...(state.batch?.items || []), ...Object.values(state.songRatings)];
}
// Only public track metadata is requested; listening links stay on the dashboard's platforms.
async function catalogTracks(name, fetchCatalog, accept, stats) {
  const apple = new URL('https://itunes.apple.com/search');
  apple.search = new URLSearchParams({term:name,media:'music',entity:'song',attribute:'artistTerm',country:'IN',limit:'100'});
  const deezer = new URL('https://api.deezer.com/search/artist');
  deezer.search = new URLSearchParams({q:name,limit:'10'});
  const failures = []; let succeeded = false;
  for (const [provider,url] of [['Apple',apple],['Deezer',deezer]]) {
    try {
      const response = await fetchCatalog(url.toString(),{signal:AbortSignal.timeout(8000)});
      if (!response.ok) { failures.push(provider+' HTTP '+response.status); continue; }
      let data;
      try { data = await response.json(); } catch { failures.push(provider+' invalid JSON'); continue; }
      if(provider==='Deezer') {
        const artist=Array.isArray(data.data) ? data.data.find(a=>validText(a.name)&&matchesArtist(a.name,name)&&Number.isInteger(a.id)&&a.id>0) : null;
        if(!Array.isArray(data.data)){failures.push('Deezer invalid artist response');continue;}
        if(!artist){succeeded=true;stats.searches++;continue;}
        const top=await fetchCatalog('https://api.deezer.com/artist/'+artist.id+'/top?limit=100',{signal:AbortSignal.timeout(8000)});
        if(!top.ok){failures.push('Deezer tracks HTTP '+top.status);continue;}
        data=await top.json();
      }
      const rows = provider==='Apple' ? data.results : data.data;
      if (!Array.isArray(rows)) { failures.push(provider+' invalid response'); continue; }
      succeeded = true; stats.searches++; stats.rows += rows.length;
      const tracks = provider==='Apple' ? rows : rows.map(t=>({artistName:t.artist?.name,trackName:t.title}));
      const eligible = tracks.filter(accept);
      if (eligible.length) return eligible;
    } catch(error) {
      failures.push(provider+' '+(error.catalogCode||(['TimeoutError','AbortError'].includes(error.name)?'timeout':'request failed ('+error.name+')')));
    }
  }
  if (succeeded) return [];
  throw new Error(failures.join('; '));
}
export async function collectCandidates(state, fetchCatalog = fetch, options={}) {
  const anchors=options.anchors||tasteAnchors(state), seeds = new Map();
  if(!anchors.length) throw fail(409,'Playlist song details need a one-time owner re-import before relevant recommendations can be generated.');
  for(const anchor of anchors) for(const name of credits(anchor.artist)) {
    if(options.usedSources?.has(norm(name)))continue;
    if(!seeds.has(norm(name)))seeds.set(norm(name),{name,anchorIds:[]});
    seeds.get(norm(name)).anchorIds.push(anchor.id);
  }
  const selected=[...seeds.values()].slice(0,options.sourceLimit||12);
  for(const source of selected)options.usedSources?.add(norm(source.name));
  const excluded = new Set([...(options.excluded||[]), ...Object.keys(state.songRatings), ...Object.keys(state.familiar), ...Object.entries(state.shown).filter(([,at])=>Date.now()-at<WINDOW).map(([key])=>key)]);
  const stats = {searches:0,rows:0,invalid:0,artistMismatch:0,excluded:0,duplicate:0};
  const candidates = [], seen = new Set(); let successfulSearches = 0, failedSearches = 0; const failureReasons = new Set();
  // Try more artists when the first searches contain only familiar songs.
  for (let offset=0;offset<selected.length && candidates.length<24;offset+=6) {
  const results = await Promise.allSettled(selected.slice(offset,offset+6).map(async ({name,anchorIds}) => {
    const unique = new Set();
    // Verify catalog credits; never trust broad search relevance alone.
    const tracks = await catalogTracks(name,fetchCatalog,t=> {
      if (!validText(t.artistName) || !validText(t.trackName)) { stats.invalid++; return false; }
      if (!matchesArtist(t.artistName,name)) { stats.artistMismatch++; return false; }
      const key = songKey({artist:t.artistName,title:t.trackName});
      if (excluded.has(key)) { stats.excluded++; return false; }
      if (unique.has(key)) { stats.duplicate++; return false; }
      unique.add(key); return true;
    },stats);
    return tracks.slice(0,4).map(t=>({artist:t.artistName,title:t.trackName,genre:t.primaryGenreName||'',anchorIds,language:'Unspecified',mood:'Any mood'}));
  }));
  for (const result of results) {
    if (result.status !== 'fulfilled') { failedSearches++; failureReasons.add(result.reason.message); continue; }
    successfulSearches++;
    for (const song of result.value) { const key=songKey(song); if (!seen.has(key)) { seen.add(key); candidates.push(song); } }
  }
  }
  if (!candidates.length && failedSearches) throw fail(503, successfulSearches
    ? 'Some music catalog searches failed; the remaining searches found no fresh songs. Existing picks remain. Try again later.'
    : 'The music catalog could not be reached. AI selection has not started. Existing picks remain. '+[...failureReasons].slice(0,2).join(' | '));
  if (!candidates.length) throw fail(422, 'No unseen catalog songs. Search diagnostics: '+JSON.stringify(stats)+'. Existing picks remain.');
  return candidates.slice(0,24);
}
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
    validationError: error.message || null,
    replyLength: (typeof reply === 'string' ? reply : JSON.stringify(reply) || '').length
  };
}
export function budgetedCatalogFetch(fetcher,stats,deadline) {
  const hosts=new Set(['itunes.apple.com','api.deezer.com']);
  const problem=code=>Object.assign(new Error(code),{catalogCode:code});
  return async(input,options={})=>{
    let url=new URL(input);
    for(let hop=0;hop<=2;hop++) {
      if(url.protocol!=='https:'||!hosts.has(url.hostname)||url.username||url.password)throw problem('unsupported redirect destination');
      if(stats.catalogRequests>=30||Date.now()>=deadline)throw problem('request budget exhausted');
      stats.catalogRequests++;
      const response=await fetcher(url.toString(),{...options,signal:AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now()))),redirect:'manual'});
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
async function refresh(env) {
  const now = Date.now(), lease = crypto.randomUUID();
  const locked = await query(env.DB, 'UPDATE community SET lease=?, lease_until=?, next_refresh=? WHERE id=1 AND lease_until<=? AND next_refresh<=?', lease, now+180000, now+60000, now, now).run();
  if (!locked.meta.changes) throw fail(409, 'A shared batch is generating, or refresh is cooling down. Wait a minute and check again.');
  try {
    await limited(env.DB, 'generation:'+new Date(now).toISOString().slice(0,10), 30, now+2*86400000);
    // Advance source rotation even on empty catalog/AI failure, without replacing the saved batch.
    await mutate(env.DB, s=>{s.rotation++;});
    const row = await read(env.DB), state = row.state;
    const ratings = Object.values(state.songRatings).sort((a,b)=>b.at-a.at);
    const feedback=ratings.slice(0,24).map(({artist,title,value})=>({artist,title,rating:value}));
    const draft=state.pending?.at>now-86400000?state.pending:null;
    let picks=(draft?.items||[]).slice(0,12);
    const selectionStats={build:RECOMMENDER_BUILD,target:12,resumedCount:picks.length,candidateCount:0,catalogRequests:0,pools:[],attempts:[]};
    const usedSources=new Set(draft?.usedSources||[]),examined=new Set([...(draft?.examined||[]),...picks.map(songKey)]),deadline=now+155000;
    // One refresh has a bounded request/time budget, including every replacement pool.
    const fetchCatalog=budgetedCatalogFetch(env.CATALOG_FETCH||fetch,selectionStats,deadline);
    for(let pool=0;pool<3&&picks.length<12&&Date.now()<deadline;pool++) {
      const poolState={...state,rotation:state.rotation+pool};
      const capped=new Set([...new Set(picks.map(t=>norm(t.artist)))].filter(a=>picks.filter(t=>norm(t.artist)===a).length>=2));
      let anchors=tasteAnchors(poolState,new Set([...usedSources,...capped]));
      if(!anchors.length&&picks.length){usedSources.clear();anchors=tasteAnchors(poolState,capped);}
      if(!anchors.length){if(pool===0&&!picks.length)throw fail(409,'Playlist song details need a one-time owner re-import before relevant recommendations can be generated.');break;}
      const poolStats={pool:pool+1,candidates:0,accepted:0};selectionStats.pools.push(poolStats);
      let candidates;
      try {
        candidates=await collectCandidates(poolState,fetchCatalog,{anchors,usedSources,excluded:examined,sourceLimit:6});
      } catch(error) {
        poolStats.error=error.status===422?'no fresh candidates':'catalog unavailable';
        poolStats.detail=error.message.slice(0,700);
        if(selectionStats.catalogRequests>=30)break;
        continue;
      }
      candidates.forEach(t=>examined.add(songKey(t)));
      poolStats.candidates=candidates.length;selectionStats.candidateCount+=candidates.length;
      const before=picks.length,messages=relevanceMessages(candidates,anchors,feedback);
      messages.push({role:'user',content:`There are already ${picks.length} accepted songs from earlier pools. This pool contains exactly ${candidates.length} candidates. Valid IDs are ${candidates.map((_,i)=>i+1).join(",")}. Select no more than ${Math.min(candidates.length,12-picks.length)} of these candidates. Never fill missing slots with IDs outside this pool. Already accepted artist counts: ${JSON.stringify(picks.reduce((counts,t)=>{counts[t.artist]=(counts[t.artist]||0)+1;return counts;},{}))}. Keep a maximum of two per artist across the complete batch.`});
      let structured=true;
      for(let attempt=0;attempt<2&&picks.length<12&&Date.now()<deadline;attempt++) {
        let timer,response;
        const stats={pool:pool+1,returned:0,accepted:0,structured};selectionStats.attempts.push(stats);
        try {
          response=await Promise.race([
            env.AI.run(MODEL,{messages,max_tokens:1200,temperature:0, ...(structured?{response_format:selectionFormat(candidates.length)}:{})}),
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
        try {picks=parseRelevantPicks(replyText,candidates,anchors,picks,stats,12);}
        catch(error){stats.error='validation failed';console.warn(JSON.stringify(aiFailureDiagnostic(response,error,candidates.length,attempt)));}
        const selectedIds=candidates.flatMap((t,i)=>picks.some(p=>songKey(p)===songKey(t))?[i+1]:[]);
        messages.push({role:'user',content:`Last pass counts: ${JSON.stringify(stats)}. Accepted IDs from this pool: ${JSON.stringify(selectedIds)}. Return up to ${Math.min(candidates.length,12-picks.length)} additional supported selections as {"picks":[{"id":1,"score":80}]}. Compare each candidate to its embedded reference. Keep the same fit threshold and total two-per-artist limit. Do not repeat accepted songs.`});
      }
      poolStats.accepted=picks.length-before;
      if(selectionStats.catalogRequests>=30)break;
    }
    if(!picks.length&&selectionStats.attempts.length&&selectionStats.attempts.every(a=>a.error==='inference failed'))throw Object.assign(fail(503,selectionStats.attempts.at(-1).inference.detail+' No AI selections were returned. Previous picks remain saved.'),{selectionStats});
    if(!picks.length)throw Object.assign(fail(422,`${selectionStats.candidateCount===0&&selectionStats.pools.some(p=>p.error==='catalog unavailable')?'Catalog requests failed before AI selection. ':''}Found ${picks.length} of 12 required matches after searching ${selectionStats.pools.length} candidate pools. The previous batch is unchanged. Try again later for other playlist references.`),{selectionStats});
    const at=Date.now();
    const complete=picks.length===12;
    if(complete) {
      state.batch={at,items:picks.map(({artist,title,reason,aiSong})=>({artist,title,reason,aiSong})),model:MODEL,relevanceVersion:RELEVANCE_VERSION,selectionStats};
      state.pending=null;
      for(const [key,time] of Object.entries(state.shown))if(at-time>=WINDOW)delete state.shown[key];
      for(const t of state.batch.items)state.shown[songKey(t)]=at;
    } else {
      state.pending={at:picks.length>(draft?.items.length||0)?at:draft.at,items:picks,usedSources:[...usedSources].slice(-200),examined:[...examined].slice(-500),selectionStats};
    }
    const committed = await query(env.DB,'UPDATE community SET data=?,revision=revision+1,lease=NULL,lease_until=0 WHERE id=1 AND revision=? AND lease=? AND lease_until>?',JSON.stringify(state),row.revision,lease,at).run();
    if(!committed.meta.changes)throw fail(409,'Shared feedback changed while AI was working. Existing picks remain. Refresh again for the new feedback.');
    return {...publicState(await read(env.DB)),generationStatus:complete?'saved':'pending',message:complete?'12 new AI picks saved for everyone.':`${picks.length}/12 approved songs saved in the shared draft. After the cooldown, refresh to find the remaining ${12-picks.length}. The visible batch has not changed.`};
  } finally { await query(env.DB,'UPDATE community SET lease=NULL,lease_until=0 WHERE id=1 AND lease=?',lease).run(); }
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
      if(path==='/state'&&request.method==='GET')return reply(publicState(await read(env.DB)));
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
      if(request.method!=='POST'||!['/feedback','/refresh','/search','/taste/add'].includes(path))throw fail(404,'Not found.');
      if(origin!==env.ALLOWED_ORIGIN)throw fail(403,'Use the dashboard to update the shared profile.');
      const body=await bodyOf(request);
      if(path==='/refresh')return reply(await refresh(env));
      if(path==='/search'||path==='/taste/add') {
        await ipLimit(request,env.DB);
        const fetchCatalog=budgetedCatalogFetch(env.CATALOG_FETCH||fetch,{catalogRequests:0},Date.now()+12000);
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
        else s.songRatings[key]={...song,value:body.rating,at:Date.now()};
        if(Object.keys(s.songRatings).length>5000)throw fail(409,'Shared feedback is full. Ask the owner to archive it.');
      }));
    } catch(error) { return reply({error:error.status?error.message:'Shared service is unavailable or its free allowance is exhausted. Existing picks remain saved.',...(error.selectionStats?{selectionStats:error.selectionStats}:{})},error.status||503); }
  },
  async scheduled(event,env) { await query(env.DB,'DELETE FROM limits WHERE expires<?',Date.now()).run(); }
};
