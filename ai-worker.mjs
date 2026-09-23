import { CreateMLCEngine, prebuiltAppConfig } from 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js';
import { MODEL, messagesFor, parseSongs } from './ai-core.mjs?v=grammar-fix-1';
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
    const response=await engine.chat.completions.create({
      // Request JSON through the prompt; validate it below without the WebLLM grammar matcher.
      messages:messagesFor(data.profile), temperature:0.7, max_tokens:1200
    });
    self.postMessage({type:'result',songs:parseSongs(response.choices?.[0]?.message?.content,data.profile)});
  } catch(error) { self.postMessage({type:'error',text:isQuotaError(error)?QUOTA_MESSAGE:(error.message || 'Local AI failed.'),code:isQuotaError(error)?'storage-quota':'ai-error'}); }
};
