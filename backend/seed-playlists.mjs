// Owner-only import. CSV rows stay local until sent to the configured Worker.
// Usage: MUNNA_ADMIN_TOKEN=... node seed-playlists.mjs https://WORKER.workers.dev playlist.csv [other.csv...]
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function parsePlaylist(text) {
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(field);field='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}
  else field+=c;
 }
 if(quoted)throw Error('CSV has an unclosed quote.');row.push(field);if(row.some(x=>x.trim()))rows.push(row);
 const headers=(rows.shift()||[]).map(x=>x.replace(/^\uFEFF/,'').trim());
 const artist=headers.findIndex(x=>['Artist Name(s)','Artist'].includes(x)),title=headers.findIndex(x=>['Track Name','Title'].includes(x));
 if(artist<0||title<0)throw Error('CSV requires Artist Name(s) and Track Name, or Artist and Title.');
 return rows.filter(r=>r[artist]?.trim()&&r[title]?.trim()).map(r=>({artist:r[artist].trim(),title:r[title].trim()}));
}
async function main(){
 const [url,...files]=process.argv.slice(2),token=process.env.MUNNA_ADMIN_TOKEN;
 if(!url?.startsWith('https://')||!files.length||!token)throw Error('Provide the HTTPS Worker URL, CSV file paths, and MUNNA_ADMIN_TOKEN environment variable.');
 const endpoint=new URL(url);if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('Use only the Worker base URL.');
 const songs=[];for(const file of files){const bytes=await fs.readFile(file);if(bytes.length>2*1024*1024)throw Error('Each CSV must be below 2 MB.');songs.push(...parsePlaylist(bytes.toString('utf8')));}
 if(!songs.length)throw Error('No songs found.');
 const response=await fetch(endpoint.origin+'/admin/seed',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({songs}),redirect:'error',signal:AbortSignal.timeout(30000)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Import failed');
 console.log(`Saved ${result.seedSongCount} unique starting songs to the shared room. Existing shared feedback was preserved.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
