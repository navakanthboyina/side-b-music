import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {budgetedCatalogFetch} from './worker.mjs';

// Execute the actual request wrapper in workerd, not Node's more permissive Fetch API.
// No network traffic: the fixture constructs a real workerd Request before replying.
const script=`${budgetedCatalogFetch.toString()}
export default {async fetch(){
 const stats={catalogRequests:0};let calls=0;
 const request=budgetedCatalogFetch(async(url,options)=>{
   new Request(url,options);
   if(++calls===1)return new Response(null,{status:302,headers:{location:'/next'}});
   return Response.json({results:[]});
 },stats,Date.now()+10000);
 const response=await request('https://itunes.apple.com/search');
 return Response.json({status:response.status,requests:stats.catalogRequests});
}}`;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-09-23',script}));
try {
 const response=await mf.dispatchFetch('http://localhost');
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{status:200,requests:2});
 console.log('PASS: real Cloudflare runtime accepts catalog options and follows a bounded redirect.');
} finally {await mf.dispose();}

// Bundle the actual discovery module: Node's Request accepts redirect:error; workerd does not.
const {build}=await import('esbuild');
const bundled=await build({stdin:{resolveDir:new URL('.',import.meta.url).pathname,contents:`
import {discoverSongs} from './song-discovery.mjs';
export default {async fetch(){
 const reference={id:1,artist:'Reference Artist',title:'Reference Song',source:'playlist song'};
 const state={seedSongs:[reference],songRatings:{},familiar:{}};
 const stats={};let calls=0;
 const env={LISTENBRAINZ_ENABLED:'false',LASTFM_API_KEY:'fixture-key',LASTFM_PUBLIC_APPROVED:'true',DISCOVERY_FETCH:async(url,options)=>{
  new Request(url,options);calls++;
  return Response.json({similartracks:{track:[]}});
 }};
 await discoverSongs(state,env,{anchors:[reference],stats});
 return Response.json({calls,errors:stats.discovery.errors});
}}`},bundle:true,write:false,format:'esm',platform:'neutral'});
const discoveryRuntime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-09-23',script:bundled.outputFiles[0].text}));
try{
 const response=await discoveryRuntime.dispatchFetch('http://localhost');
 assert.deepEqual(await response.json(),{calls:1,errors:[]});
 console.log('PASS: actual Last.fm discovery request runs in Cloudflare workerd.');
}finally{await discoveryRuntime.dispose();}

// Credential-bearing fallback requests must use workerd-supported manual redirects.
const {rankingProviders,GROQ_MODEL,GEMINI_MODEL}=await import('./ai-providers.mjs');
const fallbackScript=`const GROQ_MODEL=${JSON.stringify(GROQ_MODEL)},GEMINI_MODEL=${JSON.stringify(GEMINI_MODEL)};
${rankingProviders.toString()}
export default {async fetch(){
 let calls=0;
 const providers=rankingProviders({EXTERNAL_AI_FREE_TIER_CONFIRMED:'true',GROQ_API_KEY:'fixture',GEMINI_API_KEY:'fixture',RANKING_FETCH:async(url,options)=>{
  const request=new Request(url,options);calls++;
  if(request.redirect!=='manual')throw Error('Unsafe redirect');
  return Response.json(url.includes('groq.com')?{choices:[{message:{content:'{"ids":[1]}'}}]}:{candidates:[{content:{parts:[{text:'{"ids":[1]}'}]}}]});
 }},'fixture',[{content:'IDs only'},{content:'Candidates'}]);
 for(const provider of providers)await provider.run(new AbortController().signal);
 return Response.json({calls});
}}`;
const aiRuntime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-09-23',script:fallbackScript}));
try{assert.deepEqual(await (await aiRuntime.dispatchFetch('http://localhost')).json(),{calls:2});console.log('PASS: optional AI fallback requests run in workerd with manual redirects.');}
finally{await aiRuntime.dispose();}
