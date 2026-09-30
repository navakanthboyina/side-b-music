import {songKey} from '../ai-core.mjs';
export function comfortSongs(state,now=Date.now()){
 const day=Math.floor(now/86400000),rotation=Number(state.comfortRotation)||0;
 const pool=[...Object.values(state.songRatings||{}).filter(t=>t.value==='replay'),...(state.seedSongs||[])];
 const seen=new Set(),songs=pool.filter(t=>{const k=songKey(t);if(seen.has(k)||state.songRatings?.[k]?.value==='skip')return false;seen.add(k);return true;});
 const hash=t=>{let n=2166136261;for(const c of songKey(t)+':'+day)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
 const ranked=songs.map(t=>({song:t,key:songKey(t),hash:hash(t)}));
 ranked.sort((a,b)=>a.hash-b.hash||a.key.localeCompare(b.key));
 const start=(rotation*12)%Math.max(1,songs.length);
 return Array.from({length:Math.min(12,songs.length)},(_,i)=>{const {artist,title}=ranked[(start+i)%songs.length].song;return {artist,title};});
}
