import starter from './starter.mjs';
import { songKey } from '../ai-core.mjs';
import { RELEVANCE_VERSION, credits, matchesArtist, tasteAnchors, relevanceMessages, parseRelevantPicks } from './relevance.mjs';

export const MODEL = '@cf/meta/llama-3.2-3b-instruct';
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
  return { revision: row.revision, recommenderVersion: RELEVANCE_VERSION, batch: row.state.batch?.relevanceVersion===RELEVANCE_VERSION ? row.state.batch : null, needsTasteImport: !(row.state.seedSongs?.length), songRatings: row.state.songRatings,
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
      failures.push(provider+' '+(['TimeoutError','AbortError'].includes(error.name)?'timeout':'request failed'));
    }
  }
  if (succeeded) return [];
  throw new Error(failures.join('; '));
}
export async function collectCandidates(state, fetchCatalog = fetch) {
  const anchors=tasteAnchors(state), seeds = new Map();
  if(!anchors.length) throw fail(409,'Playlist song details need a one-time owner re-import before relevant recommendations can be generated.');
  for(const anchor of anchors) for(const name of credits(anchor.artist)) {
    if(!seeds.has(norm(name)))seeds.set(norm(name),{name,anchorIds:[]});
    seeds.get(norm(name)).anchorIds.push(anchor.id);
  }
  const selected=[...seeds.values()].slice(0,12);
  const excluded = new Set([...Object.keys(state.songRatings), ...Object.keys(state.familiar), ...Object.entries(state.shown).filter(([,at])=>Date.now()-at<WINDOW).map(([key])=>key)]);
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
async function refresh(env) {
  const now = Date.now(), lease = crypto.randomUUID();
  const locked = await query(env.DB, 'UPDATE community SET lease=?, lease_until=?, next_refresh=? WHERE id=1 AND lease_until<=? AND next_refresh<=?', lease, now+180000, now+60000, now, now).run();
  if (!locked.meta.changes) throw fail(409, 'A shared batch is generating, or refresh is cooling down. Wait a minute and check again.');
  try {
    await limited(env.DB, 'generation:'+new Date(now).toISOString().slice(0,10), 30, now+2*86400000);
    // Advance source rotation even on empty catalog/AI failure, without replacing the saved batch.
    await mutate(env.DB, s=>{s.rotation++;});
    const row = await read(env.DB), state = row.state;
    const candidates = await collectCandidates(state, env.CATALOG_FETCH || fetch);
    if (!candidates.length) throw fail(422, 'No unseen catalog songs in this search. Existing picks remain; refresh later to try other sources.');
    const ratings = Object.values(state.songRatings).sort((a,b)=>b.at-a.at);
    const anchors=tasteAnchors(state);
    const feedback=ratings.slice(0,24).map(({artist,title,value})=>({artist,title,rating:value}));
    const messages = relevanceMessages(candidates,anchors,feedback); let picks=[];
    const selectionStats={candidateCount:candidates.length,attempts:[]};
    for (let attempt=0;attempt<2;attempt++) {
      let timer, response;
      const stats={returned:0,accepted:0}; selectionStats.attempts.push(stats);
      try {
        response = await Promise.race([
          env.AI.run(MODEL,{messages,max_tokens:1800,temperature:0.3}),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail(504,'AI timed out. Existing picks remain.')),60000);})
        ]).finally(()=>clearTimeout(timer));
      } catch(error) {
        stats.error='inference failed';
        if(picks.length)break;
        throw error;
      }
      const replyText = aiReplyText(response);
      try { picks=parseRelevantPicks(replyText,candidates,anchors,picks,stats); }
      catch (error) {
        stats.error='validation failed';
        console.warn(JSON.stringify(aiFailureDiagnostic(response,error,candidates.length,attempt)));
        if(attempt===1&&!picks.length)throw fail(422,'AI did not select eligible songs. Existing picks remain. Owner diagnostic: munna-ai-validation.');
      }
      if(picks.length>=12)break;
      const selectedIds=candidates.flatMap((t,i)=>picks.some(p=>songKey(p)===songKey(t))?[i+1]:[]);
      messages.push({role:'user',content:
        `Last pass validation counts: ${JSON.stringify(stats)}. Fix any formatting or reference errors using the original candidate data. Already accepted candidate IDs: ${JSON.stringify(selectedIds)}. Review the remaining candidates for up to ${12-picks.length} ADDITIONAL supported matches. Return only {"picks":[{"id":1,"score":80,"reason":"specific estimated musical similarity"}]}. Use only valid candidate IDs. Compare each to its embedded reference song; do not return anchorId. Keep the same relevance threshold; do not repeat accepted songs or fill slots with weak matches.`});
    }
    const at=Date.now();
    state.batch={at,items:picks.map(({artist,title,reason,aiSong})=>({artist,title,reason,aiSong})),model:MODEL,relevanceVersion:RELEVANCE_VERSION,selectionStats};
    for(const [key,time] of Object.entries(state.shown))if(at-time>=WINDOW)delete state.shown[key];
    for(const t of state.batch.items)state.shown[songKey(t)]=at;
    const committed = await query(env.DB,'UPDATE community SET data=?,revision=revision+1,lease=NULL,lease_until=0 WHERE id=1 AND revision=? AND lease=? AND lease_until>?',JSON.stringify(state),row.revision,lease,at).run();
    if(!committed.meta.changes)throw fail(409,'Shared feedback changed while AI was working. Existing picks remain. Refresh again for the new feedback.');
    return publicState(await read(env.DB));
  } finally { await query(env.DB,'UPDATE community SET lease=NULL,lease_until=0 WHERE id=1 AND lease=?',lease).run(); }
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
        }));
      }
      if(request.method!=='POST'||!['/feedback','/refresh'].includes(path))throw fail(404,'Not found.');
      if(origin!==env.ALLOWED_ORIGIN)throw fail(403,'Use the dashboard to update the shared profile.');
      const body=await bodyOf(request);
      if(path==='/refresh')return reply(await refresh(env));
      const song=cleanSong(body), key=songKey(song);
      if(!['replay','skip','known','clear'].includes(body.rating))throw fail(400,'Invalid feedback.');
      await ipLimit(request,env.DB);
      return reply(await mutate(env.DB,s=>{
        if(!knownSongs(s).some(t=>songKey(t)===key))throw fail(400,'Rate a song from the shared dashboard.');
        if(body.rating==='clear')delete s.songRatings[key];
        else s.songRatings[key]={...song,value:body.rating,at:Date.now()};
        if(Object.keys(s.songRatings).length>5000)throw fail(409,'Shared feedback is full. Ask the owner to archive it.');
      }));
    } catch(error) { return reply({error:error.status?error.message:'Shared service is unavailable or its free allowance is exhausted. Existing picks remain saved.'},error.status||503); }
  },
  async scheduled(event,env) { await query(env.DB,'DELETE FROM limits WHERE expires<?',Date.now()).run(); }
};
