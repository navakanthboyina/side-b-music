import {songKey} from '../ai-core.mjs';
import {findPreview} from './preview.mjs';
import {uuid} from './ranking.mjs';
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
export async function getResource(db,song,now=Date.now()){
 const row=await q(db,'SELECT data,expires FROM song_resources WHERE key=?',songKey(song)).first();
 return row&&row.expires>now?JSON.parse(row.data):null;
}
export async function resolveResource(db,song,fetchCatalog,stats={},fetchArtwork=fetch){
 const cached=await getResource(db,song);
 if(cached){stats.cacheHit=true;stats.attempts=cached.diagnostics?.attempts||[];stats.selectedProvider=cached.preview?.source;return cached;}
 const resource={artist:song.artist,title:song.title,preview:null,diagnostics:stats};
 resource.preview=await findPreview(song,fetchCatalog,stats,resource);
 const releaseId=song.releaseId||song.evidence?.releaseId;
 if(!resource.artwork&&uuid(releaseId)){
  // CAA redirects to Internet Archive. Store the official stable image URL only after a match.
  const url='https://coverartarchive.org/release/'+releaseId+'/front-250';
  try{const r=await fetchArtwork(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(2000)});
   if(r.ok||[301,302,307,308].includes(r.status)){resource.artwork=url;resource.artworkSource='Cover Art Archive';}
  }catch{}
 }
 resource.youtube=!resource.preview?'https://www.youtube.com/results?search_query='+encodeURIComponent(song.artist+' '+song.title+' official'):null;
 const failed=stats.attempts?.some(a=>['http_error','timeout','request_failed','invalid_response'].includes(a.outcome));
 // Cache URLs/metadata, never audio. Retry outages soon; successful mappings last 6 hours.
 const ttl=resource.preview?6*3600000:failed?60000:15*60000;
 if(!stats.noStore)await q(db,'INSERT INTO song_resources(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires',songKey(song),JSON.stringify(resource),Date.now()+Math.min(ttl,stats.maxAgeMs??ttl)).run();
 return resource;
}
export async function activityState(db){
 // D1 JSON aggregation keeps the adapter compatible with its existing first/run interface.
 const row=await q(db,"SELECT json_group_object(key,json_object('plays',plays,'completions',completions,'skips',skips,'lastAt',last_at)) AS data FROM song_activity").first();
 return JSON.parse(row?.data||'{}');
}
export async function recordActivity(db,song,event,id){
 const now=Date.now();
 const inserted=await q(db,'INSERT OR IGNORE INTO activity_events(id,expires) VALUES(?,?)',id,now+86400000).run();
 if(!inserted.meta.changes)return;
 await q(db,`INSERT INTO song_activity(key,artist,title,plays,completions,skips,last_at) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(key) DO UPDATE SET plays=plays+excluded.plays,completions=completions+excluded.completions,skips=skips+excluded.skips,last_at=excluded.last_at`,songKey(song),song.artist,song.title,event==='play'?1:0,event==='complete'?1:0,event==='skip'?1:0,now).run();
}
