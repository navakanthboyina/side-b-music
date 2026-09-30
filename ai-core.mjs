// Pure helpers shared by the local AI worker and tests.
export const MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const norm=s=>String(s).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export const songKey=t=>'track:'+t.artist.split(/\s*(?:,|&|;)\s*/).map(norm).sort().join('|')+':'+norm(t.title);
export function tasteProfile(state) {
  const ratings=Object.values(state.songRatings||{}).sort((a,b)=>(b.at||0)-(a.at||0));
  return {
    feedback:[...ratings.filter(r=>r.value==='replay').slice(0,10),...ratings.filter(r=>r.value!=='replay').slice(0,10)].map(r=>({artist:r.artist.slice(0,100),title:r.title.slice(0,100),rating:r.value})),
    recentSongs:(state.cache?.items||[]).slice(0,9).map(t=>({artist:t.artist,title:t.title})),
    language:state.filters.language,mood:state.filters.mood,
    provisional:!ratings.some(r=>r.value==='replay'),variation:state.rotation
  };
}
// Compatibility exports for the old local UI: free-form song generation is retired.
const requireCandidates=profile=>{if(!Array.isArray(profile?.candidates)||!profile.candidates.length)throw Error('Verified candidates are required. Free-form song generation is disabled.');};
export function messagesFor(profile){requireCandidates(profile);return candidateMessages(profile);}
export function parseSongs(text,profile){requireCandidates(profile);return parseCandidatePicks(text,profile);}

// Rank existing catalog entries; the model cannot introduce a different song or label.
export function candidateMessages(profile){
 const candidates=profile.candidates.map((t,i)=>({id:i+1,artist:t.artist,title:t.title,genre:t.genre||''}));
 return [{role:'system',content:'Choose 12 distinct songs (or all candidates if fewer than 12) from the provided candidates based on the listener\'s individual song likes and dislikes. Mix languages in one ranked list without language sections. Prefer shared musical qualities and a mix of artists. A liked or disliked song does not rate its whole artist. Output only JSON with candidate IDs, for example {"ids":[2,5,1]}. Use only IDs supplied in candidates. Do not return song names, new songs, explanations, language or mood labels. If there are no likes, choose a varied discovery selection.'},{role:'user',content:JSON.stringify({feedback:profile.feedback,language:profile.language,mood:profile.mood,candidates})}];
}
export function parseCandidatePicks(text,profile){
 let data;
 try{data=JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{data=null;}
 const selections=Array.isArray(data)?data:Array.isArray(data?.ids)?data.ids:Array.isArray(data?.songs)?data.songs:[];
 const seen=new Set(),out=[],rejected={invalidSelection:0,outsidePool:0,alreadyRatedOrRecent:0,duplicate:0};
 const candidateIds=new Map(profile.candidates.map((t,i)=>[songKey(t),i+1]));
 const excluded=new Set([...profile.feedback,...profile.recentSongs].map(songKey));
 for(const raw of selections.slice(0,30)){
  let value=raw;
  if(raw&&typeof raw==='object'){
   if(typeof raw.artist==='string'&&typeof raw.title==='string'){
    const key=songKey(raw);
    if(excluded.has(key)){rejected.alreadyRatedOrRecent++;continue;}
    value=candidateIds.get(key);
    if(value===undefined){rejected.outsidePool++;continue;}
   }else value=raw.id;
  }
  const id=typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value):NaN;
  if(!Number.isInteger(id)||id<1||id>profile.candidates.length){rejected.invalidSelection++;continue;}
  if(seen.has(id)){rejected.duplicate++;continue;}
  const t=profile.candidates[id-1];if(excluded.has(songKey(t))){rejected.alreadyRatedOrRecent++;continue;}
  // Use catalog metadata only. Never apply model-generated ratings or other fields.

  seen.add(id);out.push({...t,name:t.artist,origin:'ai',reason:profile.provisional?'AI selected this song for a provisional discovery mix.':'AI selected this song from unseen catalog tracks using your individual song feedback.'});
 }
 if(!out.length){const error=Error('AI could not select valid candidate IDs. No repeated or invented songs were substituted.');error.diagnostics={version:'mixed-12-1',model:MODEL,candidateCount:profile.candidates.length,rejected,response:String(text).slice(0,12000)};throw error;}
 return out.slice(0,12);
}
