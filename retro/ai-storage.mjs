// Only downloadable artifacts for this dashboard's two AI models are removed.
// Ratings, imports, history, localStorage and unrelated caches are never touched.
export const LEGACY_MODEL='Qwen2.5-3B-Instruct-q4f16_1-MLC';
export function isQuotaError(error){return /quota|storage.*(full|space)|disk.*(full|space)/i.test(String(error?.name||'')+' '+String(error?.message||error||''));}
export const QUOTA_MESSAGE='The browser could not store the AI model. Click Clear AI downloads, then retry Lightweight AI. Your song ratings will stay saved. If this continues, free some device storage or try a regular (not private) browser window.';
export async function clearModelDownloads(cacheStorage,records){
 if(!cacheStorage)throw Error('This browser does not allow AI cache access. Try a regular browser window.');
 const prefixes=records.map(r=>r.model.replace(/\/$/,'')+'/');
 const exact=new Set(records.map(r=>r.model_lib));
 let removed=0;
 for(const name of await cacheStorage.keys()){
  const cache=await cacheStorage.open(name);
  for(const request of await cache.keys()){
   if(exact.has(request.url)||prefixes.some(prefix=>request.url.startsWith(prefix))){if(await cache.delete(request))removed++;}
  }
 }
 return removed;
}
