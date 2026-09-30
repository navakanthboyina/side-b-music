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
export async function findPreview(song,fetchCatalog,diagnostics={}){
 diagnostics.attempts ||= [];
 for(const country of PREVIEW_COUNTRIES){
  const attempt={provider:'iTunes',country};diagnostics.attempts.push(attempt);
  try{
   const response=await fetchCatalog('https://itunes.apple.com/search?'+new URLSearchParams({term:song.artist+' '+song.title,entity:'song',media:'music',country,limit:'15'}),{timeoutMs:3500});
   attempt.status=response.status;
   if(!response.ok){attempt.outcome='http_error';break;}
   const data=await response.json();if(!Array.isArray(data.results)){attempt.outcome='invalid_response';break;}
   const matches=data.results.filter(t=>norm(t.trackName)===norm(song.title)&&artistMatch(song.artist,t.artistName||''));
   attempt.rows=data.results.length;attempt.identityMatches=matches.length;
   const t=matches.find(applePreview);
   attempt.outcome=t?'found':matches.length?'no_playable_preview':'no_matching_song';
   if(t){diagnostics.selectedProvider='iTunes';return {...applePreview(t),country};}
  }catch(error){attempt.outcome=['TimeoutError','AbortError'].includes(error?.name)?'timeout':'request_failed';break;}
 }
 const attempt={provider:'Deezer'};diagnostics.attempts.push(attempt);
 try{
  const response=await fetchCatalog('https://api.deezer.com/search?'+new URLSearchParams({q:song.artist+' '+song.title,limit:'25'}),{timeoutMs:3500});
  attempt.status=response.status;if(!response.ok){attempt.outcome='http_error';return null;}
  const data=await response.json();if(!Array.isArray(data.data)){attempt.outcome='invalid_response';return null;}
  const matches=data.data.filter(t=>Number.isSafeInteger(t.id)&&t.id>0&&norm(t.title)===norm(song.title)&&artistMatch(song.artist,t.artist?.name||''));
  attempt.rows=data.data.length;attempt.identityMatches=matches.length;
  const t=matches.find(t=>safePreviewUrl(t.preview));attempt.outcome=t?'found':matches.length?'no_playable_preview':'no_matching_song';
  if(t)diagnostics.selectedProvider='Deezer';
  return t?{url:safePreviewUrl(t.preview),source:'Deezer',duration:30,link:'https://www.deezer.com/track/'+t.id}:null;
 }catch(error){attempt.outcome=['TimeoutError','AbortError'].includes(error?.name)?'timeout':'request_failed';return null;}
}
