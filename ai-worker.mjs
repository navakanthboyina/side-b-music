import { CreateMLCEngine } from 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js';
import { MODEL, messagesFor, parseSongs } from './ai-core.mjs';
let engine;
self.onmessage = async ({data}) => {
  try {
    if(!engine) engine=await CreateMLCEngine(MODEL, {
      initProgressCallback: p=>self.postMessage({type:'progress',text:p.text})
    });
    self.postMessage({type:'progress',text:'AI is finding songs for your taste…'});
    const response=await engine.chat.completions.create({
      messages:messagesFor(data.profile), temperature:0.85, max_tokens:1200,
      response_format:{type:'json_object'}
    });
    self.postMessage({type:'result',songs:parseSongs(response.choices?.[0]?.message?.content,data.profile)});
  } catch(error) { self.postMessage({type:'error',text:error.message || 'Local AI failed.'}); }
};
