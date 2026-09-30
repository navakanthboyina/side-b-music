// One room-wide cooldown per provider. Synthetic throttling is explicitly labeled.
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
const throttled=(source,seconds)=>new Response('',{status:429,headers:{'retry-after':String(Math.max(1,Math.ceil(seconds))),'x-munna-limit-source':source}});
export function catalogFetcher(env,now=Date.now){
 return async(url,options)=>{
  const host=new URL(url).hostname,at=now(),key='provider-cooldown:'+host;
  const paused=await q(env.DB,'SELECT count,expires FROM limits WHERE key=?',key).first();
  if(paused?.expires>at){
   const cause=await q(env.DB,'SELECT count,expires FROM limits WHERE key=?','provider-failure:'+host).first();
   const r=throttled('provider_cooldown',(paused.expires-at)/1000);
   if(cause){r.headers.set('x-munna-original-status',String(cause.count));r.headers.set('x-munna-failure-at',String(cause.expires-7*86400000));}
   return r;
  }
  // A rolling room window prevents double bursts across wall-clock minute boundaries.
  const budgetKey='catalog-window:'+host;
  const permit=await q(env.DB,`INSERT INTO limits(key,count,expires) VALUES(?,1,?)
   ON CONFLICT(key) DO UPDATE SET
    count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END
   WHERE expires<=? OR count<? RETURNING count,expires`,
   budgetKey,at+60000,at,at,at,host==='itunes.apple.com'?10:30).first();
  if(!permit){
   const window=await q(env.DB,'SELECT expires FROM limits WHERE key=?',budgetKey).first();
   return throttled('room_budget',((window?.expires||at+60000)-at)/1000);
  }
  const response=await (env.CATALOG_FETCH||fetch)(url,options);
  if(response.status===429||response.status===503){
   const retry=response.headers.get('retry-after'),seconds=Number(retry);
   const until=retry?(Number.isFinite(seconds)?at+seconds*1000:Date.parse(retry)):0;
   await q(env.DB,`INSERT INTO limits(key,count,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires=excluded.expires`,'provider-failure:'+host,response.status,at+7*86400000).run();
   const failures=Math.min(5,(paused?.count||0)+1);
   const delay=300000*2**(failures-1);
   await q(env.DB,`INSERT INTO limits(key,count,expires) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires=MAX(expires,excluded.expires)`,key,failures,Math.max(at+delay,Number.isFinite(until)?until:0)).run();
  }else if(response.ok&&paused?.count){
   await q(env.DB,'DELETE FROM limits WHERE key=?',key).run();
  }
  return response;
 };
}
