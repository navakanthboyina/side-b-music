let worker, active=false;
export function stop() { worker?.terminate(); worker=null; }
export async function recommend(profile, progress, signal) {
  if(active) throw Error('AI is already working.');
  if(!navigator.gpu) throw Error('This browser does not support local AI. Try an updated browser with WebGPU, or choose Catalog picks.');
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter || !adapter.features.has('shader-f16')) throw Error('This device cannot run this AI model. Try a compatible computer, or choose Catalog picks.');
  if(signal.aborted) throw Error('AI stopped.');
  active=true;
  try {
    return await new Promise((resolve,reject)=>{
      const finish=(err,result)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);if(err)stop();err?reject(err):resolve(result);};
      const abort=()=>finish(Error('AI stopped. No new picks were saved.'));
      const timer=setTimeout(()=>finish(Error('AI took too long. Try again on a faster connection or device.')),10*60*1000);
      signal.addEventListener('abort',abort,{once:true});
      try {
        worker ||= new Worker(new URL('./ai-worker.mjs?v=candidates-1',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{
          if(data.type==='progress')progress(data.text);
          else if(data.type==='result')finish(null,data.songs);
          else if(data.type==='error'){const error=Error(data.code==='storage-quota'?data.text:'AI could not finish. '+String(data.text).slice(0,500));error.diagnostics=data.diagnostics;finish(error);}
        };
        worker.onerror=()=>finish(Error('AI could not load. Check your connection and available device memory, or choose Catalog picks.'));
        worker.postMessage({profile});
      } catch(err) { finish(err); }
    });
  } finally { active=false; }
}

export async function clearDownloads(){
 if(active)throw Error('Stop AI before clearing its downloads.');
 stop();active=true;
 try{
  await new Promise((resolve,reject)=>{
   let cleanupWorker;
   const finish=error=>{clearTimeout(timer);cleanupWorker?.terminate();error?reject(error):resolve();};
   const timer=setTimeout(()=>finish(Error('AI download cleanup timed out. Reload the page and try again.')),60000);
   try{
    cleanupWorker=new Worker(new URL('./ai-worker.mjs?v=candidates-1',import.meta.url),{type:'module'});
    cleanupWorker.onmessage=({data})=>{if(data.type==='cleared')finish();else if(data.type==='error')finish(Error(data.text));};
    cleanupWorker.onerror=()=>finish(Error('Could not load AI cleanup. Check your connection and retry.'));
    cleanupWorker.postMessage({type:'clear'});
   }catch(error){finish(error);}
  });
 }finally{active=false;}
}
