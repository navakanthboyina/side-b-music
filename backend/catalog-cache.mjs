// Small private D1-backed response cache. Never stores provider errors or non-JSON bodies.
export function cachedCatalogFetch(fetcher,cache,stats,now=()=>Date.now()){
 const DAY=86400000;
 const trim=()=>{let bytes=0;for(const [k,v] of Object.entries(cache).sort((a,b)=>b[1].at-a[1].at)){bytes+=v.body?.length||0;if(!v.body||now()-v.at>7*DAY||bytes>700000)delete cache[k];}};trim();
 return async(input,options)=>{
  const key=String(input),entry=cache[key];
  if(entry&&now()-entry.at<DAY){stats.catalogCacheHits=(stats.catalogCacheHits||0)+1;return new Response(entry.body,{headers:{'content-type':'application/json'}});}
  try{
   const r=await fetcher(input,options);if(!r.ok)throw Object.assign(Error('Catalog HTTP '+r.status),{response:r});
   const body=await r.clone().text();let data;try{data=JSON.parse(body);}catch{throw Error('Catalog response was not JSON');}
   if(data.error)throw Error('Catalog API error');
   if(body.length<=100000&&(Array.isArray(data.results)||Array.isArray(data.data)||Number.isSafeInteger(data.id))){cache[key]={at:now(),body};trim();}
   return r;
  }catch(e){
   if(entry&&now()-entry.at<=7*DAY){stats.catalogStaleHits=(stats.catalogStaleHits||0)+1;return new Response(entry.body,{headers:{'content-type':'application/json'}});}
   if(e.response)return e.response;throw e;
  }
 };
}
