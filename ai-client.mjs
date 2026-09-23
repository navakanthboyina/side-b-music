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
        worker ||= new Worker(new URL('./ai-worker.mjs',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{
          if(data.type==='progress')progress(data.text);
          else if(data.type==='result')finish(null,data.songs);
          else if(data.type==='error')finish(Error('AI could not finish. Try again, or choose Catalog picks. '+String(data.text).slice(0,180)));
        };
        worker.onerror=()=>finish(Error('AI could not load. Check your connection and available device memory, or choose Catalog picks.'));
        worker.postMessage({profile});
      } catch(err) { finish(err); }
    });
  } finally { active=false; }
}
