import {matchesArtist} from './relevance.mjs';
const norm=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export const PREVIEW_COUNTRIES=['IN','US'];
export function safePreviewUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^(?:[a-z0-9-]+\.)*(?:dzcdn\.net|deezer\.com|itunes\.apple\.com|mzstatic\.com)$/.test(u.hostname)?u.href:null;}catch{return null;}
}
export function applePreview(track){
 const url=safePreviewUrl(track?.previewUrl);let link;try{link=new URL(track?.trackViewUrl);}catch{return null;}
 if(!url||!/\.(?:itunes\.apple\.com|mzstatic\.com)$/.test(new URL(url).hostname)||!Number.isSafeInteger(track.trackId)||track.trackId<=0||link.protocol!=='https:'||!['music.apple.com','itunes.apple.com'].includes(link.hostname)||link.username||link.password||link.port)return null;
 return {url,source:'iTunes',duration:30,link:link.href,attribution:'Preview provided courtesy of iTunes'};
}
export async function findPreview(song,fetchCatalog){
 for(const country of PREVIEW_COUNTRIES){
  try{
   const response=await fetchCatalog('https://itunes.apple.com/search?'+new URLSearchParams({term:song.artist+' '+song.title,entity:'song',media:'music',country,limit:'15'}),{timeoutMs:2500});
   if(!response.ok)break; // A provider outage/rate limit is not a reason to try more storefronts.
   const data=await response.json();if(!Array.isArray(data.results))break;
   const t=data.results.find(t=>norm(t.trackName)===norm(song.title)&&matchesArtist(song.artist,t.artistName||'')&&applePreview(t));
   if(t)return {...applePreview(t),country};
  }catch{break;}
 }
 try{
  const response=await fetchCatalog('https://api.deezer.com/search?'+new URLSearchParams({q:song.artist+' '+song.title,limit:'25'}),{timeoutMs:2500});
  if(!response.ok)return null;const data=await response.json();
  const t=Array.isArray(data.data)?data.data.find(t=>Number.isSafeInteger(t.id)&&t.id>0&&norm(t.title)===norm(song.title)&&matchesArtist(song.artist,t.artist?.name||'')&&safePreviewUrl(t.preview)):null;
  return t?{url:safePreviewUrl(t.preview),source:'Deezer',duration:30,link:'https://www.deezer.com/track/'+t.id}:null;
 }catch{return null;}
}
