import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const cwd=path.dirname(fileURLToPath(import.meta.url));
const endpoint='https://munnas-grooves-shared.munna-grooves.workers.dev';
const report={startedAt:new Date().toISOString(),snapshots:[],events:[],tailMessages:[]};
const redact=s=>String(s).replace(/(Bearer\s+)[^\s"']+/gi,'$1[redacted]').replace(/((?:api_key|token|secret|authorization)["']?\s*[:=]\s*["']?)[^&\s"',}]+/gi,'$1[redacted]').slice(0,4000);
const tail=spawn(process.execPath,[path.join(cwd,'node_modules/wrangler/bin/wrangler.js'),'tail','munnas-grooves-shared','--format','json'],{cwd,stdio:['ignore','pipe','pipe']});
let finished=false,timer,buffer='',depth=0,inString=false,escaped=false;
function consume(chunk){
 for(const ch of chunk){
  if(!depth){if(ch!=='{')continue;buffer='{';depth=1;inString=false;escaped=false;continue;}
  buffer+=ch;
  if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;}
  else if(ch==='"')inString=true;
  else if(ch==='{')depth++;
  else if(ch==='}')depth--;
  if(buffer.length>1000000){buffer='';depth=0;continue;}
  if(!depth){try{record(JSON.parse(buffer));}catch{}buffer='';}
 }
}
function record(event){
 let requestPath;try{requestPath=new URL(event.event?.request?.url).pathname;}catch{}
 const entry={
  at:event.eventTimestamp?new Date(event.eventTimestamp).toISOString():new Date().toISOString(),
  outcome:event.outcome,
  method:event.event?.request?.method,
  path:requestPath,
  cpuTime:event.cpuTime,
  exceptions:(event.exceptions||[]).map(e=>({name:e.name,message:redact(e.message)})),
  logs:(event.logs||[]).filter(l=>['warn','error'].includes(l.level)).map(l=>({level:l.level,message:redact((l.message||[]).map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '))}))
 };
 report.events.push(entry);report.events=report.events.slice(-120);
 if(entry.path==='/refresh'||entry.outcome!=='ok'||entry.logs.length||entry.exceptions.length)console.log(JSON.stringify(entry,null,2));
}
tail.stdout.on('data',consume);
tail.stderr.on('data',chunk=>{
 const message=redact(chunk.toString());report.tailMessages.push(message);report.tailMessages=report.tailMessages.slice(-20);process.stderr.write(message);
});
tail.on('error',e=>{console.error('Could not start Wrangler:',redact(e.message));void finish();});
tail.on('exit',(code,signal)=>{if(!finished){console.log('Live logging stopped:',code??signal);void finish();}});
async function snapshot(label){
 const item={label,at:new Date().toISOString()};
 try{
  const response=await fetch(endpoint+'/state',{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
  item.httpStatus=response.status;
  const text=await response.text();let r;try{r=JSON.parse(text);}catch{throw Error('State response was not JSON (HTTP '+response.status+').');}
  Object.assign(item,{build:r.recommenderBuild,setup:r.discoverySetup,refreshing:r.refreshing,
   cooldownSeconds:Math.max(0,Math.ceil(((r.nextRefresh||0)-Date.now())/1000)),
   pending:r.pendingSongCount,pendingLanguage:r.pendingLanguage,visibleSongs:r.batch?.items?.length,
   diagnostics:r.lastSelectionStats??r.pendingSelectionStats??null,error:r.error?redact(r.error):undefined});
 }catch(e){item.error=redact(e.message);}
 report.snapshots.push(item);console.log(JSON.stringify(item,null,2));
}
async function finish(){
 if(finished)return;finished=true;clearTimeout(timer);
 tail.kill('SIGTERM');
 const force=setTimeout(()=>tail.kill('SIGKILL'),2000);force.unref();
 await snapshot('after');
 report.finishedAt=new Date().toISOString();
 const findings=[];
 if(report.events.some(e=>/exceeded.?cpu|cpu.*limit/i.test(JSON.stringify(e))))findings.push('Cloudflare CPU limit exceeded. This is not a language-selection failure.');
 if(report.events.some(e=>/invalid_json/.test(JSON.stringify(e))))findings.push('AI returned invalid JSON.');
 if(report.events.some(e=>/canceled|cancelled/i.test(e.outcome||'')))findings.push('A request was canceled; the trace alone does not identify why.');
 if(!report.events.length)findings.push('No Worker events captured. Check the Wrangler login/connection; absence of events is not proof of success.');
 report.findings=findings;
 console.log('\nFindings:\n'+(findings.join('\n')||'No known failure pattern captured. Inspect the before/after diagnostics.'));
 const dir=path.join(cwd,'.diagnostics');await mkdir(dir,{recursive:true});
 const file=path.join(dir,'diagnosis-'+report.startedAt.replace(/[:.]/g,'-')+'.json');
 await writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log('\nSaved report: '+file+'\nShare this report or the terminal output. It excludes request headers, bodies and the full taste profile.');
}
process.on('SIGINT',()=>void finish());
process.on('SIGTERM',()=>void finish());
console.log('Watching this Worker for 3 minutes. Once logging connects and no generation is active, click Refresh ONCE in the dashboard. Also click a song preview to capture iTunes/Deezer outcomes. Do not also run a curl refresh. Ctrl+C saves early. This command does not trigger a refresh.');
await snapshot('before');
if(!finished)timer=setTimeout(()=>void finish(),180000);
