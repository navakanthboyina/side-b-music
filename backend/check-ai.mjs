// Fixed synthetic model check; no playlist or shared feedback is sent.
const endpoint=process.argv[2];
if(!endpoint||!process.env.MUNNA_ADMIN_TOKEN){console.error('Provide the Worker URL and set MUNNA_ADMIN_TOKEN to your saved owner password.');process.exit(1);}
const url=new URL(endpoint);
if(url.protocol!=='https:'||url.username||url.password)throw Error('Use the HTTPS Worker URL.');
url.pathname='/admin/ai-check';url.search='';url.hash='';
try {
 const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.MUNNA_ADMIN_TOKEN},body:'{}',signal:AbortSignal.timeout(50000)});
 const result=await response.json();console.log(JSON.stringify(result,null,2));if(!response.ok)process.exitCode=1;
}catch(error){console.error('AI check failed:',error.message);process.exitCode=1;}
