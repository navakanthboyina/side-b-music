import {credits,matchesArtist} from './relevance.mjs';
const norm=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const artistMatch=(a,b)=>credits(b).some(credit=>matchesArtist(a,credit));
export const PREVIEW_COUNTRIES=['IN','US'];
export function safePreviewUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^(?:[a-z0-9-]+\.)*(?:dzcdn\.net|deezer\.com|itunes\.apple\.com|mzstatic\.com)$/.test(u.hostname)?u.href:null;}catch{return null;}
}
export function applePreview(track){
 const url=safePreviewUrl(track?.previewUrl);let link;try{link=new URL(track?.trackViewUrl);}catch{return null;}
 if(!url||!/\.(?:itunes\.apple\.com|mzstatic\.com)$/.test(new URL(url).hostname)||!Number.isSafeInteger(track.trackId)||track.trackId<=0||link.protocol!=='https:'||!['music.apple.com','itunes.apple.com'].includes(link.hostname)||link.username||link.password||link.port)return null;
 return {url,source:'iTunes',duration:30,link:link.href,attribution:'Preview provided courtesy of iTunes'};
}
// Counts and provider statuses only: no search terms, taste profile or media URLs in logs.
export async function findPreview(song,fetchCatalog,diagnostics={},resource={}){
 diagnostics.attempts ||= [];
 for(const country of PREVIEW_COUNTRIES){
  const attempt={provider:'iTunes',country};diagnostics.attempts.push(attempt);
  try{
   const response=await fetchCatalog('https://itunes.apple.com/search?'+new URLSearchParams({term:song.artist+' '+song.title,entity:'song',media:'music',country,limit:'15'}),{timeoutMs:3500});
   attempt.status=response.status;
   if(!response.ok){attempt.outcome='http_error';attempt.limitSource=response.headers.get('x-munna-limit-source')||'upstream';attempt.retryAfterSeconds=Number(response.headers.get('retry-after'))||undefined;break;}
   const cc=response.headers.get('cache-control')||'';
   if(/no-store|no-cache/i.test(cc))diagnostics.noStore=true;
   const age=cc.match(/max-age=(\d+)/i);if(age)diagnostics.maxAgeMs=Math.min(diagnostics.maxAgeMs??Infinity,Number(age[1])*1000);
   const data=await response.json();if(!Array.isArray(data.results)){attempt.outcome='invalid_response';break;}
   const matches=data.results.filter(t=>norm(t.trackName)===norm(song.title)&&artistMatch(song.artist,t.artistName||''));
   attempt.rows=data.results.length;attempt.identityMatches=matches.length;
   const catalog=matches[0];
   if(catalog){resource.apple={id:catalog.trackId,country,link:applePreview(catalog)?.link||(/^https:\/\/(music|itunes)\.apple\.com\//.test(catalog.trackViewUrl||'')?catalog.trackViewUrl:null),album:catalog.collectionName,genre:catalog.primaryGenreName};
    if(/^https:\/\/[^/]+\.mzstatic\.com\//.test(catalog.artworkUrl100||'')){resource.artwork=catalog.artworkUrl100;resource.artworkSource='iTunes';}}
   const t=matches.find(applePreview);
   attempt.outcome=t?'found':matches.length?'no_playable_preview':'no_matching_song';
   if(t){diagnostics.selectedProvider='iTunes';return {...applePreview(t),country};}
  }catch(error){attempt.outcome=['TimeoutError','AbortError'].includes(error?.name)?'timeout':'request_failed';break;}
 }
 // Multi-performer credits can over-constrain a catalog search. Retry once with
 // one credited performer, while retaining exact title and artist validation.
 const primaryCredit=credits(song.artist).find(c=>c!==song.artist.trim())||song.artist;
 const queries=[...new Set([song.artist+' '+song.title,primaryCredit+' '+song.title])];
 for(let i=0;i<queries.length;i++){
  const attempt={provider:'Deezer',queryMode:i?'primary_credit':'full_credits'};diagnostics.attempts.push(attempt);
  try{
   const response=await fetchCatalog('https://api.deezer.com/search?'+new URLSearchParams({q:queries[i],limit:'25'}),{timeoutMs:3500});
   attempt.status=response.status;if(!response.ok){attempt.outcome='http_error';return null;}
   const cc=response.headers.get('cache-control')||'';if(/no-store|no-cache/i.test(cc))diagnostics.noStore=true;const age=cc.match(/max-age=(\d+)/i);if(age)diagnostics.maxAgeMs=Math.min(diagnostics.maxAgeMs??Infinity,Number(age[1])*1000);
   const data=await response.json();if(!Array.isArray(data.data)){attempt.outcome='invalid_response';return null;}
   const matches=data.data.filter(t=>Number.isSafeInteger(t.id)&&t.id>0&&norm(t.title)===norm(song.title)&&artistMatch(song.artist,t.artist?.name||''));
   attempt.rows=data.data.length;attempt.identityMatches=matches.length;
   const t=matches.find(t=>safePreviewUrl(t.preview));attempt.outcome=t?'found':matches.length?'no_playable_preview':'no_matching_song';
   if(t){diagnostics.selectedProvider='Deezer';resource.deezer={id:t.id,link:'https://www.deezer.com/track/'+t.id};
    return {url:safePreviewUrl(t.preview),source:'Deezer',duration:30,link:'https://www.deezer.com/track/'+t.id};}
  }catch(error){attempt.outcome=['TimeoutError','AbortError'].includes(error?.name)?'timeout':'request_failed';return null;}
 }
 return null;
}
