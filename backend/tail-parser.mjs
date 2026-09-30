// Wrangler emits multiline JSON; startup/connection failures may also use stdout.
export function tailParser(onEvent,onText=()=>{}){
 let buffer='',plain='',depth=0,inString=false,escaped=false;
 return chunk=>{
  for(const ch of String(chunk)){
   if(!depth){
    if(ch!=='{'){plain+=ch;if(ch==='\n'){if(plain.trim())onText(plain.trim());plain='';}continue;}
    if(plain.trim())onText(plain.trim());plain='';buffer='{';depth=1;inString=false;escaped=false;continue;
   }
   buffer+=ch;
   if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;}
   else if(ch==='"')inString=true;
   else if(ch==='{')depth++;
   else if(ch==='}')depth--;
   if(buffer.length>1000000){buffer='';depth=0;onText('Discarded oversized tail message');continue;}
   if(!depth){try{const event=JSON.parse(buffer);if(event.outcome||event.event||event.logs||event.exceptions)onEvent(event);else onText('Wrangler message: '+buffer);}catch{onText('Could not parse Wrangler message');}buffer='';}
  }
 };
}
