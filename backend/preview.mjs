import {matchesArtist} from './relevance.mjs';
const norm=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function safePreviewUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^(?:[a-z0-9-]+\.)*(?:dzcdn\.net|deezer\.com)$/.test(u.hostname)?u.href:null;}catch{return null;}
}
export async function findPreview(song,fetchCatalog){
 const response=await fetchCatalog('https://api.deezer.com/search?'+new URLSearchParams({q:song.artist+' '+song.title,limit:'25'}));
 if(!response.ok)throw Error('Deezer unavailable');const data=await response.json();
 if(!Array.isArray(data.data))throw Error('Invalid Deezer response');
 const t=data.data.find(t=>Number.isSafeInteger(t.id)&&t.id>0&&norm(t.title)===norm(song.title)&&matchesArtist(song.artist,t.artist?.name||'')&&safePreviewUrl(t.preview));
 return t?{url:safePreviewUrl(t.preview),source:'Deezer',duration:30,link:'https://www.deezer.com/track/'+t.id}:null;
}
