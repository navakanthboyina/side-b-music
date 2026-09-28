import {catalogLanguage,selectedLanguages} from './languages.mjs';
import {songKey} from '../ai-core.mjs';
import {matchesArtist,tasteAnchors} from './relevance.mjs';
const text=s=>typeof s==='string'&&s.trim().length>0&&s.length<=300;
const id=n=>Number.isSafeInteger(n)&&n>0;
const norm=s=>String(s).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const exact=(t,a)=>text(t.artist)&&text(t.title)&&norm(t.title)===norm(a.title)&&matchesArtist(a.artist,t.artist);
const error=(status,message)=>Object.assign(Error(message),{status});
export async function collectEvidenceCandidates(state,fetchCatalog,options={}) {
 const anchors=options.anchors||tasteAnchors(state),used=options.usedSources||new Set();
 const selected=anchors.filter(a=>!used.has(songKey(a))).slice(0,options.sourceLimit||6);
 const excluded=new Set([...(options.excluded||[]),...Object.keys(state.familiar),...Object.keys(state.songRatings)]);
 const json=async url=>{const r=await fetchCatalog(url);if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(data.error)throw Error('Catalog error');return data;};
 let failures=0;const reasons=new Set(),seen=new Set(),out=[];
 for(let offset=0;offset<selected.length;offset+=3){
  const results=await Promise.allSettled(selected.slice(offset,offset+3).map(async a=>{
   used.add(songKey(a));let succeeded=false;const errors=[];
   for(const provider of (options.language&&options.language!=='Mixed'?['Apple','Deezer']:['Deezer','Apple']))try{
    let reference,album,tracks;
    if(provider==='Deezer') {
     const data=await json('https://api.deezer.com/search?'+new URLSearchParams({q:a.artist+' '+a.title,limit:'25'}));
     if(!Array.isArray(data.data))throw Error('Invalid search response');succeeded=true;
     reference=data.data.map(t=>({artist:t.artist?.name,title:t.title,id:t.id,albumId:t.album?.id})).find(t=>id(t.id)&&id(t.albumId)&&exact(t,a));
     if(!reference)continue;
     const details=await json('https://api.deezer.com/album/'+reference.albumId);
     if(details.id!==reference.albumId||!text(details.title)||!Array.isArray(details.tracks?.data))throw Error('Invalid album response');
     // Reject unrelated compilations: they establish co-listing, not a useful song relationship.
     if(['compilation','compile'].includes(details.record_type))continue;
     album={id:details.id,title:details.title,genre:(details.genres?.data||[]).map(g=>g.name).filter(text).slice(0,4).join(', '),releaseDate:text(details.release_date)?details.release_date:''};
     if(!details.tracks.data.some(t=>t.id===reference.id&&exact({artist:t.artist?.name,title:t.title},a)))continue;
     tracks=details.tracks.data.map(t=>({id:t.id,artist:t.artist?.name,title:t.title}));
    } else {
     const data=await json('https://itunes.apple.com/search?'+new URLSearchParams({term:a.artist+' '+a.title,entity:'song',media:'music',country:'IN',limit:'25'}));
     if(!Array.isArray(data.results))throw Error('Invalid search response');succeeded=true;
     reference=data.results.map(t=>({artist:t.artistName,title:t.trackName,id:t.trackId,albumId:t.collectionId})).find(t=>id(t.id)&&id(t.albumId)&&exact(t,a));
     if(!reference)continue;
     const details=await json('https://itunes.apple.com/lookup?'+new URLSearchParams({id:String(reference.albumId),entity:'song',country:'IN',limit:'200'}));
     if(!Array.isArray(details.results))throw Error('Invalid album response');
     const ref=details.results.find(t=>t.trackId===reference.id&&t.collectionId===reference.albumId&&exact({artist:t.artistName,title:t.trackName},a));
     if(!ref||!text(ref.collectionName))continue;
     album={id:reference.albumId,title:ref.collectionName,genre:text(ref.primaryGenreName)?ref.primaryGenreName:'',releaseDate:text(ref.releaseDate)?ref.releaseDate:''};
     tracks=details.results.filter(t=>t.collectionId===album.id).map(t=>({id:t.trackId,artist:t.artistName,title:t.trackName,genre:t.primaryGenreName}));
    }
    const candidates=tracks.filter(t=>id(t.id)&&text(t.artist)&&text(t.title)&&t.id!==reference.id&&!excluded.has(songKey(t))).slice(0,8).map(t=>({...t,anchorIds:[a.id],genre:album.genre,evidence:{type:'same_release',provider,album,reference:{id:reference.id,artist:a.artist,title:a.title},candidateId:t.id,trackGenre:t.genre||''}})).filter(t=>!options.language||options.language==='Mixed'||!catalogLanguage(t)||selectedLanguages(options.language).includes(catalogLanguage(t)));
    if(candidates.length)return candidates;
   }catch(e){errors.push(provider+' '+e.message);}
   if(!succeeded)throw Error(errors.join('; '));return [];
  }));
  for(const r of results){if(r.status==='rejected'){failures++;reasons.add(r.reason.message);continue;}for(const t of r.value){if(!seen.has(songKey(t))){seen.add(songKey(t));out.push(t);}}}
 }
 if(!out.length)throw error(failures?503:422,failures?'Catalog requests failed: '+[...reasons].slice(0,2).join(' | '):'No unseen songs with a verified reference-song release connection in this pool.');
 // Round-robin by reference prevents one long album from consuming the pool.
 const groups=selected.map(a=>out.filter(t=>t.anchorIds[0]===a.id));const mixed=[];
 for(let i=0;i<8&&mixed.length<24;i++)for(const group of groups)if(group[i]&&mixed.length<24)mixed.push(group[i]);
 return mixed;
}

export function memoizedCatalogFetch(fetcher) {
 const requests=new Map();
 return async(url,options)=>{
  const key=String(url);
  if(!requests.has(key))requests.set(key,fetcher(url,options).then(r=>{if(!r.ok)requests.delete(key);return r;}).catch(e=>{requests.delete(key);throw e;}));
  return (await requests.get(key)).clone();
 };
}
