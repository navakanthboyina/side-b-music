export const GROQ_MODEL='openai/gpt-oss-120b';
export const GEMINI_MODEL='gemini-3.1-flash-lite';
export function rankingProviders(env,primaryModel,messages){
 const providers=[];
 if(env.AI?.run)providers.push({name:'Cloudflare',model:primaryModel,label:'Gemma',run:()=>env.AI.run(primaryModel,{messages,max_completion_tokens:1200,temperature:0,chat_template_kwargs:{enable_thinking:false}})});
 // Keys alone do not enable third-party calls. The owner confirms free-tier account setup.
 if(env.EXTERNAL_AI_FREE_TIER_CONFIRMED!=='true')return providers;
 const request=async(url,headers,body,signal)=>{
  const response=await (env.RANKING_FETCH||fetch)(url,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal});
  if(!response.ok)throw Object.assign(Error('provider_http_error'),{status:response.status});
  return response.json();
 };
 if(env.GROQ_API_KEY)providers.push({name:'Groq',model:GROQ_MODEL,label:'GPT-OSS',run:signal=>request('https://api.groq.com/openai/v1/chat/completions',
  {Authorization:'Bearer '+env.GROQ_API_KEY},{model:GROQ_MODEL,messages,temperature:0,max_completion_tokens:1600,reasoning_effort:'low'},signal)});
 if(env.GEMINI_API_KEY)providers.push({name:'Gemini',model:GEMINI_MODEL,label:'Gemini',run:async signal=>{
  const data=await request('https://generativelanguage.googleapis.com/v1beta/models/'+GEMINI_MODEL+':generateContent',{'x-goog-api-key':env.GEMINI_API_KEY},
   {systemInstruction:{parts:[{text:messages[0].content}]},contents:[{role:'user',parts:[{text:messages[1].content}]}],generationConfig:{temperature:0,maxOutputTokens:1200,responseMimeType:'application/json'}},signal);
  return {response:data.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('')};
 }});
 return providers;
}
export function rankingFailure(error){
 const message=String(error?.message||'');
 return error?.status===429||/quota|neuron|3036/i.test(message)?'quota':/timeout|abort/i.test(message+' '+error?.name)?'timeout':/invalid_ids|JSON/i.test(message)?'invalid_response':'provider_unavailable';
}
