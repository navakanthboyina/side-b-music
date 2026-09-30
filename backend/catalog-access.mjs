// One room-wide cooldown per provider. Synthetic throttling is explicitly labeled.
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
const throttled=(source,seconds)=>new Response('',{status:429,headers:{'retry-after':String(Math.max(1,Math.ceil(seconds))),'x-munna-limit-source':source}});
export function catalogFetcher(env,now=Date.now){
 return async(url,options)=>{
  const host=new URL(url).hostname,at=now(),key='provider-cooldown:'+host;
  const paused=await q(env.DB,'SELECT expires FROM limits WHERE key=?',key).first();
  if(paused?.expires>at)return throttled('provider_cooldown',(paused.expires-at)/1000);
  const minute=Math.floor(at/60000);
  const permit=await q(env.DB,`INSERT INTO limits(key,count,expires) VALUES(?,1,?)
   ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`,
   'catalog:'+host+':'+minute,at+120000,host==='itunes.apple.com'?18:30).first();
  if(!permit)return throttled('room_budget',60-at%60000/1000);
  const response=await (env.CATALOG_FETCH||fetch)(url,options);
  if(response.status===429||response.status===503){
   const retry=response.headers.get('retry-after'),seconds=Number(retry);
   const until=retry?(Number.isFinite(seconds)?at+seconds*1000:Date.parse(retry)):0;
   await q(env.DB,`INSERT INTO limits(key,count,expires) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET expires=MAX(expires,excluded.expires)`,key,Math.max(at+300000,Number.isFinite(until)?until:0)).run();
  }
  return response;
 };
}
