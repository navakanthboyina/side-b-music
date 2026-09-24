import starter from './starter.mjs';
import { songKey, candidateMessages, parseCandidatePicks } from '../ai-core.mjs';

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
  return { revision: row.revision, batch: row.state.batch, songRatings: row.state.songRatings,
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
async function catalogTracks(name, fetchCatalog) {
  const apple = new URL('https://itunes.apple.com/search');
  apple.search = new URLSearchParams({term:name,media:'music',entity:'song',attribute:'artistTerm',country:'IN',limit:'100'});
  const deezer = new URL('https://api.deezer.com/search');
  deezer.search = new URLSearchParams({q:'artist:"'+name.replace(/["\\]/g,' ')+'"',limit:'100'});
  const failures = [];
  for (const [provider,url] of [['Apple',apple],['Deezer',deezer]]) {
    try {
      const response = await fetchCatalog(url,{signal:AbortSignal.timeout(8000)});
      if (!response.ok) { failures.push(provider+' HTTP '+response.status); continue; }
      let data;
      try { data = await response.json(); } catch { failures.push(provider+' invalid JSON'); continue; }
      const rows = provider==='Apple' ? data.results : data.data;
      if (!Array.isArray(rows)) { failures.push(provider+' invalid response'); continue; }
      return provider==='Apple' ? rows : rows.map(t=>({artistName:t.artist?.name,trackName:t.title}));
    } catch(error) {
      failures.push(provider+' '+(['TimeoutError','AbortError'].includes(error.name)?'timeout':'request failed'));
    }
  }
  throw new Error(failures.join('; '));
}
export async function collectCandidates(state, fetchCatalog = fetch) {
  const seeds = new Map();
  // Imported playlist rows stay out of the AI prompt. Only live catalog candidates and explicit shared feedback reach AI.
  for (const name of [...state.seedArtists, ...starter.map(a=>a.name), ...Object.values(state.songRatings).filter(r=>r.value==='replay').flatMap(r=>r.artist.split(/\s*(?:,|&|;)\s*/))]) {
    if (validText(name)) seeds.set(norm(name), name);
  }
  const all = [...seeds.values()];
  const selected = Array.from({length:Math.min(18,all.length)},(_,i)=>all[(state.rotation*6+i)%all.length]);
  const excluded = new Set([...Object.keys(state.songRatings), ...Object.keys(state.familiar), ...Object.entries(state.shown).filter(([,at])=>Date.now()-at<WINDOW).map(([key])=>key)]);
  const candidates = [], seen = new Set(); let successfulSearches = 0, failedSearches = 0; const failureReasons = new Set();
  // Try more artists when the first searches contain only familiar songs.
  for (let offset=0;offset<selected.length && candidates.length<24;offset+=6) {
  const results = await Promise.allSettled(selected.slice(offset,offset+6).map(async name => {
    const tracks = await catalogTracks(name,fetchCatalog);
    const unique = new Set();
    return tracks.filter(t=> {
      if (!validText(t.artistName) || !validText(t.trackName)) return false;
      if (!t.artistName.split(/\s*(?:,|&|;)\s*/).map(norm).includes(norm(name)) && norm(t.artistName)!==norm(name)) return false;
      const key = songKey({artist:t.artistName,title:t.trackName});
      if (excluded.has(key) || unique.has(key)) return false; unique.add(key); return true;
    }).slice(0,4).map(t=>({artist:t.artistName,title:t.trackName,genre:t.primaryGenreName||'',language:'Unspecified',mood:'Any mood'}));
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
  return candidates.slice(0,24);
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
    const profile = {candidates,feedback:[...ratings.filter(r=>r.value==='replay').slice(0,10),...ratings.filter(r=>r.value!=='replay').slice(0,10)].map(({artist,title,value})=>({artist,title,rating:value})),recentSongs:state.batch?.items||[],language:'All languages',mood:'Any mood',provisional:!ratings.some(r=>r.value==='replay')};
    const messages = candidateMessages(profile); let picks;
    for (let attempt=0;attempt<2;attempt++) {
      let timer;
      const response = await Promise.race([
        env.AI.run(MODEL,{messages,max_tokens:300,temperature:0.5}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail(504,'AI timed out. Existing picks remain.')),60000);})
      ]).finally(()=>clearTimeout(timer));
      try { picks=parseCandidatePicks(response.response,profile); break; }
      catch { if (attempt===1) throw fail(422,'AI did not select eligible songs. Existing picks remain.');
        messages.push({role:'assistant',content:String(response.response||'').slice(0,1500)},{role:'user',content:'Return only {"ids":[...]} using numbers from candidates. Select up to 12 distinct IDs.'}); }
    }
    const at=Date.now();
    state.batch={at,items:picks.map(t=>({artist:t.artist,title:t.title,reason:profile.provisional?'AI selection from the shared discovery pool.':'AI selection using the community’s individual song feedback.',aiSong:true})),model:MODEL};
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
