import {songKey} from '../ai-core.mjs';
import {identities,selectDiverse} from './ranking.mjs';
import {selectedLanguages,LANGUAGES} from './languages.mjs';

// Only previously verified server metadata qualifies; a rating alone proves no language.
export function verifiedSongLanguages(song,state,now=Date.now()){
 const key=songKey(song),cached=state.songDiscovery?.languages?.[key];
 const previous=(state.batch?.items||[]).find(t=>songKey(t)===key);
 const saved=state.songRatings?.[key];
 const labels=cached?.until>now&&cached.labels?.length?cached.labels: saved?.verifiedLanguages?.length?saved.verifiedLanguages:
  previous?.languageBasis==='MusicBrainz work lyrics language'?[previous.language]:[];
 return [...new Set((Array.isArray(labels)?labels:[]).filter(l=>LANGUAGES.includes(l)&&l!=='Mixed'))];
}
export function fillWithRatedSongs(picks,state,language='Mixed',stats={},now=Date.now(),allowUnverifiedFamiliar=false){
 const report=stats.ratedFallback={eligible:0,added:0,blocked:0,language:0,unknownLanguage:0,otherLanguage:0,unverifiedAdded:0,allowUnverifiedFamiliar};
 if(picks.length>=12)return picks;
 const ratings=Object.values(state.songRatings||{}),blocked=new Set(ratings.filter(t=>t.value==='skip').flatMap(t=>identities(t,state)));
 const candidates=[];
 for(const t of ratings){
  if(!['replay','known'].includes(t.value))continue;
  if(identities(t,state).some(id=>blocked.has(id))){report.blocked++;continue;}
  const labels=verifiedSongLanguages(t,state,now);
  if(language!=='Mixed'&&!labels.some(l=>selectedLanguages(language).includes(l))){
   if(labels.length){report.language++;report.otherLanguage++;continue;}
   if(!allowUnverifiedFamiliar){report.language++;report.unknownLanguage++;continue;}
  }
  const info=state.songDiscovery?.languages?.[songKey(t)]||state.songDiscovery?.identities?.[songKey(t)];
  const lastShown=state.shown?.[songKey(t)]||0;
  candidates.push({artist:t.artist,title:t.title,recordingId:info?.recordingId||t.recordingId,releaseId:info?.releaseId||t.releaseId,
   language:labels.find(l=>selectedLanguages(language).includes(l))||labels[0]||'Unknown',
   languageBasis:labels.length?'MusicBrainz work lyrics language':'Unverified language · allowed familiar fallback',reusedRating:t.value,unverifiedFamiliar:labels.length===0,
   aiSong:false,rankingMode:'deterministic',
   score:(t.value==='replay'?100:50)+Math.min(20,Math.max(0,(now-lastShown)/86400000)),
   reason:t.value==='replay'?'Returning favorite: this room previously liked this song. Included because fresh discovery did not fill the batch.':
    'Familiar pick: this room previously marked this song “Already know”. Included because fresh discovery did not fill the batch; this is not a new discovery.'});
 }
 report.eligible=candidates.length;
 const result=selectDiverse(candidates,picks,12,language);
 report.added=result.length-picks.length;
 report.unverifiedAdded=result.slice(picks.length).filter(t=>t.unverifiedFamiliar).length;
 // Unselected rows may also exceed the remaining slots; do not mislabel them as rejected.
 report.remaining=candidates.length-report.added;
 return result;
}
