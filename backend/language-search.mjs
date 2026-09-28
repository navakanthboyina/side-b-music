import {songKey} from '../ai-core.mjs';
import {selectedLanguages,catalogLanguage} from './languages.mjs';
import {matchesArtist} from './relevance.mjs';
const id=n=>Number.isSafeInteger(n)&&n>0;
const text=s=>typeof s==='string'&&s.trim()&&s.length<=300;
// Search the requested language alongside a taste artist. Query words alone are never language evidence.
export async function searchLanguageCandidates(state,get,{anchors,language,excluded=new Set(),usedSources=new Set(),stats={}}){
 const blocked=new Set([...Object.keys(state.familiar),...Object.keys(state.songRatings),...excluded]);
 const selected=anchors.filter(a=>!usedSources.has(songKey(a))).slice(0,6),out=[],seen=new Set();
 const langs=selectedLanguages(language);stats.languageSearch={queries:0,verified:0,wrongArtist:0,unverifiedLanguage:0,failures:0};const report=stats.languageSearch;
 for(let i=0;i<selected.length;i++){
  const a=selected[i],lang=langs[(i+(state.rotation||0))%langs.length];
  for(const provider of ['Apple','Deezer']){
   try{
    report.queries++;
    const url=provider==='Apple'?'https://itunes.apple.com/search?'+new URLSearchParams({term:lang+' '+a.artist,entity:'song',media:'music',country:'IN',limit:'50'}):'https://api.deezer.com/search?'+new URLSearchParams({q:lang+' '+a.artist,limit:'50'});
    const r=await get(url);if(!r.ok)throw Error();const data=await r.json(),rows=provider==='Apple'?data.results:data.data;if(!Array.isArray(rows))throw Error();
    let added=0;
    for(const raw of rows){
     const artist=provider==='Apple'?raw.artistName:raw.artist?.name,title=provider==='Apple'?raw.trackName:raw.title,trackId=provider==='Apple'?raw.trackId:raw.id,albumId=provider==='Apple'?raw.collectionId:raw.album?.id,albumTitle=provider==='Apple'?raw.collectionName:raw.album?.title;
     if(!text(artist)||!text(title)||!id(trackId)||!id(albumId)||!text(albumTitle))continue;
     if(!matchesArtist(a.artist,artist)){report.wrongArtist++;continue;}
     const genre=provider==='Apple'?raw.primaryGenreName:'';
     const t={id:trackId,artist,title,genre:genre||'',anchorIds:[a.id],evidence:{type:'same_artist_language',provider,candidateId:trackId,album:{id:albumId,title:albumTitle,genre:''},trackGenre:genre||'',versionLabel:title,reference:{artist:a.artist,title:a.title}}};
     if(catalogLanguage(t)!==lang){report.unverifiedLanguage++;continue;}
     if(blocked.has(songKey(t))||seen.has(songKey(t)))continue;
     seen.add(songKey(t));out.push(t);added++;if(added===4)break;
    }
    if(added)break;
   }catch{report.failures++;}
  }
  if(out.length>=24)break;
 }
 report.verified=out.length;
 if(out.length)for(const a of selected)usedSources.add(songKey(a));
 // Interleave taste references instead of allowing one artist to monopolize the pool.
 const groups=selected.map(a=>out.filter(t=>t.anchorIds[0]===a.id)),mixed=[];
 for(let n=0;n<4;n++)for(const g of groups)if(g[n])mixed.push(g[n]);
 return mixed.slice(0,24);
}
