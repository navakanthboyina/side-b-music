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
