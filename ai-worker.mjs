import { CreateMLCEngine, prebuiltAppConfig } from 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js';
import { MODEL, messagesFor, parseSongs, candidateMessages, parseCandidatePicks } from './ai-core.mjs?v=mixed-12-1';
import { LEGACY_MODEL, clearModelDownloads, isQuotaError, QUOTA_MESSAGE } from './ai-storage.mjs';
let engine;
const records=ids=>prebuiltAppConfig.model_list.filter(r=>ids.includes(r.model_id));
self.onmessage = async ({data}) => {
  try {
    if(data.type==='clear'){
      if(engine){await engine.unload();engine=null;}
      await clearModelDownloads(self.caches,records([MODEL,LEGACY_MODEL]));
      self.postMessage({type:'cleared'});return;
    }
    if(!engine){
      self.postMessage({type:'progress',text:'Preparing Lightweight AI and removing the old large-model download…'});
      await clearModelDownloads(self.caches,records([LEGACY_MODEL]));
    }
    if(!engine) engine=await CreateMLCEngine(MODEL, {
      initProgressCallback: p=>self.postMessage({type:'progress',text:p.text})
    });
    self.postMessage({type:'progress',text:'AI is finding songs for your taste…'});
    const candidateMode=Array.isArray(data.profile.candidates);
    const messages=candidateMode?candidateMessages(data.profile):messagesFor(data.profile);
    let songs,lastError;
    for(let attempt=0;attempt<(candidateMode?2:1);attempt++){
      const response=await engine.chat.completions.create({messages,temperature:0.5,max_tokens:candidateMode?256:1200});
      const content=response.choices?.[0]?.message?.content;
      try{songs=candidateMode?parseCandidatePicks(content,data.profile):parseSongs(content,data.profile);break;}
      catch(error){lastError=error;if(!candidateMode)throw error;messages.push({role:'assistant',content:String(content||'').slice(0,1500)},{role:'user',content:'That response had no valid IDs. Select only numeric candidate IDs from the provided list. Return {"ids":[...]} with no other fields.'});}
    }
    if(!songs)throw lastError;
    self.postMessage({type:'result',songs});
  } catch(error) { self.postMessage({type:'error',text:isQuotaError(error)?QUOTA_MESSAGE:(error.message || 'Local AI failed.'),code:isQuotaError(error)?'storage-quota':'ai-error',diagnostics:error.diagnostics||null}); }
};
