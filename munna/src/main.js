import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const API=window.MUNNA_SHARED.apiBase;
const asset=path=>new URL('../assets/'+path,import.meta.url).href;
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const clamp=THREE.MathUtils.clamp;


const CLIPS={
  relaxed:{url:asset('animations/relaxed.fbx'),label:'Standing Idle'},
  look:{url:asset('animations/look.fbx'),label:'Look Around'},
  listening:{url:asset('animations/listening.fbx'),label:'Listening To Music'},
  listeningUpper:{url:asset('animations/listening.fbx'),label:'Listening Upper',upperMode:'music'},
  walk:{url:asset('animations/walk.fbx'),label:'Walking With A Swagger'},
  turnLeft:{url:asset('animations/turn-left.fbx'),label:'Turn Left'},
  turnRight:{url:asset('animations/turn-right.fbx'),label:'Turn Right'},
  greeting:{url:asset('animations/greeting.fbx'),label:'Greeting',upperMode:'upper'},
  wave:{url:asset('animations/wave.fbx'),label:'Wave',upperMode:'upper'},
  talkFunny:{url:asset('animations/talk-funny.fbx'),label:'Funny Talk',upperMode:'upper'},
  conversation:{url:asset('animations/conversation.fbx'),label:'Conversation',upperMode:'upper'},
  ask:{url:asset('animations/ask.fbx'),label:'Ask',upperMode:'upper'},
  secret:{url:asset('animations/secret.fbx'),label:'Secret',upperMode:'upper'},
  happy:{url:asset('animations/happy-gesture.fbx'),label:'Happy Gesture',upperMode:'upper'},
  sarcastic:{url:asset('animations/sarcastic.fbx'),label:'Sarcastic',upperMode:'upper'},
  point:{url:asset('animations/point.fbx'),label:'Point',upperMode:'upper'},
  think:{url:asset('animations/think.fbx'),label:'Think',upperMode:'upper'},
  clap:{url:asset('animations/clap.fbx'),label:'Clap',upperMode:'upper'},
  celebrate:{url:asset('animations/celebrate.fbx'),label:'Celebrate',upperMode:'upper'},
  cheer:{url:asset('animations/cheer.fbx'),label:'Cheer',upperMode:'upper'},
  laugh:{url:asset('animations/laugh.fbx'),label:'Laugh',upperMode:'upper'},
  shrug:{url:asset('animations/shrug.fbx'),label:'Shrug',upperMode:'upper'},
  surprised:{url:asset('animations/surprised.fbx'),label:'Surprised',upperMode:'upper'},
  pokeBlock:{url:asset('animations/poke-block.fbx'),label:'Block Reaction',upperMode:'upper'},
  reachDown:{url:asset('animations/reach-down.fbx'),label:'DJ Reach',upperMode:'upper'},
  reachRummage:{url:asset('animations/reach-rummage.fbx'),label:'DJ Rummage',upperMode:'upper'},
  button:{url:asset('animations/button.fbx'),label:'Push Button',upperMode:'upper'},
  danceA:{url:asset('animations/dance-wave.fbx'),label:'Wave Hip Hop'},
  danceB:{url:asset('animations/dance-tut.fbx'),label:'Tut Hip Hop'},
  danceC:{url:asset('animations/dance-arms.fbx'),label:'Hip Hop Arms'},
  danceD:{url:asset('animations/dance-house.fbx'),label:'House Dance'},
  danceStep:{url:asset('animations/dance-step.fbx'),label:'Step Hip Hop'},
  danceSnake:{url:asset('animations/dance-snake.fbx'),label:'Snake Hip Hop'},
  danceTwist:{url:asset('animations/dance-twist.fbx'),label:'Twist Dance'},
  danceRunning:{url:asset('animations/dance-runningman.fbx'),label:'Runningman'},
  danceHouse3:{url:asset('animations/dance-house3.fbx'),label:'House Dance 3'},
  danceSalsa:{url:asset('animations/dance-salsa.fbx'),label:'Salsa Side To Side'},
  gestureForward:{url:asset('animations/gesture-forward.fbx'),label:'Two Handed Forward Gesture',upperMode:'upper'},
  fistPump:{url:asset('animations/fist-pump.fbx'),label:'Fist Pump',upperMode:'upper'},
  headbang:{url:asset('animations/headbang.fbx'),label:'Head Bang',upperMode:'upper'}
,
  pausedSit:{url:asset('animations/paused-sit.fbx'),label:'Paused sitting'}
};
const UPPER=['Spine1','Spine2','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand'];
const MUSIC_UPPER=['Spine1','Spine2','Neck','Head'];
const matches=(name,list)=>list.some(p=>name===p||name.startsWith(p));

// ---------- Website state ----------
let sharedSongs=[],localRatings=new Map(),searchTerm='',moodFilter='all',planDay=1,sourceMode='offline';
let hoveredSongKey='',hoverSayAt=0;
const BANTER={
 idle:["You pick. I’ll pretend it was my idea.","I have twelve songs and unreasonable confidence.","No algorithm spiral. We’re adults here.","I’m not judging your taste. My eyebrows are independent."],
 search:["Searching… emotionally and technically.","Hold on. I’m consulting the imaginary record shelf.","Typing detected. I’m pretending to help.","I found three answers and one unnecessary opinion."],
 like:["Yep. Keeping that one.","Okay, your taste survived that round.","Approved by the extremely official booth committee.","That one stays. No arguments."],
 skip:["Cold. Next track.","Not for us. I won’t tell the artist.","Removed from my imaginary set list.","Fair. My headphones also looked disappointed."],
 known:["Of course you know it. Show-off.","Fine, professor. I’ll dig deeper.","Already know it? My mystery is ruined."],
 poke:["Hey—I'm working here.","One more poke and you’re on aux.","I felt that in all 73 bones.","Personal space. DJ edition."],
 preview:["Headphones on. Judgment mode.","Thirty seconds. Impress me.","Okay, tiny listening session."],
 dj:["Tiny EQ surgery.","Cueing the next imaginary masterpiece.","Do not touch the suspiciously shiny knob."],
 hover:["Hmm. This one has potential.","You hovering means commitment now.","I see you reading the reason. Very responsible."]
};
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function songKey(s){return `${s.artist}|${s.title}`;}
function toast(msg){const el=$('#toast');el.textContent=msg;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2300);}
function navigate(){const view=['discover','plan','comfort','profile'].includes(location.hash.slice(1))?location.hash.slice(1):'discover';$$('.view').forEach(v=>v.hidden=v.id!==`view-${view}`);$$('.nav-link').forEach(a=>a.classList.toggle('active',a.dataset.view===view));window.scrollTo({top:0,behavior:'instant'});}
window.addEventListener('hashchange',navigate);navigate();
$('#today').textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date());

async function request(path,body){const r=await fetch(API+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(path==='/refresh'?190000:15000)});const j=await r.json();if(!r.ok)throw Error(j.error||'Shared service unavailable');return j;}
function inferMood(song){const t=`${song.title} ${song.artist} ${song.reason||''}`.toLowerCase();if(/dance|energy|beat|percussion|club|electronic|rhythm|lift/.test(t))return'energy';if(/dream|night|soft|intimate|restrained|headphone|slow|emotional/.test(t))return'late-night';return'warm';}
function normalizeSongs(items){return items.map(s=>({...s,mood:s.mood||inferMood(s),language:s.language||'Unknown'}));}
function filteredSongs(){const q=searchTerm.trim().toLowerCase();return sharedSongs.filter(s=>(!q||`${s.artist} ${s.title}`.toLowerCase().includes(q))&&(moodFilter==='all'||s.mood===moodFilter));}
function artClass(song){let n=0;for(const c of `${song.artist}${song.title}`)n=(n+c.charCodeAt(0))%5;return`art-${n}`;}
function card(song,i){const rating=localRatings.get(songKey(song));const artwork=typeof song.artwork==='string'&&/^https:\/\//.test(song.artwork)?`<img src="${esc(song.artwork)}" alt="" loading="lazy">`:'';return `<article class="music-card ${artClass(song)}" data-card data-artist="${esc(song.artist)}" data-title="${esc(song.title)}"><div class="track-art">${artwork}<span class="art-caption">MUNNA’S / ${String(i+1).padStart(2,'0')}</span></div><div class="card-content"><div class="tag-row"><span class="tag">${esc(song.language||'Mixed')}</span><span class="tag">${esc((song.mood||'warm').replace('-', ' '))}</span></div><h3>${esc(song.title)}</h3><div class="track-title">${esc(song.artist)}</div><p class="reason">${esc(song.reason||'A pick from the current listening room.')}</p><button class="preview-button" data-preview data-artist="${esc(song.artist)}" data-title="${esc(song.title)}">▶ Play 30 sec here</button><div class="card-feedback"><button class="rate" data-rate="like" aria-pressed="${rating==='like'}">Like</button><button class="rate" data-rate="skip" aria-pressed="${rating==='skip'}">Not for us</button><button class="rate" data-rate="known" aria-pressed="${rating==='known'}">Know it</button></div></div></article>`;}
function renderDiscover(){const songs=filteredSongs();$('#feed').innerHTML=songs.length?songs.map(card).join(''):'<p class="empty">No songs match that search + mood combination.</p>';$('#feedStatus').textContent=`${sharedSongs.length} tracks · ${sourceMode==='live'?'current shared room':'last loaded picks'} · shared song feedback`;const hc=$('#heroSongCount');if(hc)hc.textContent=sharedSongs.length;const sb=$('#sourceBadge');if(sb)sb.textContent=sourceMode==='live'?'LIVE ROOM':'OFFLINE';}
function renderPlan(){const half=Math.ceil(sharedSongs.length/2),songs=planDay===1?sharedSongs.slice(0,half):sharedSongs.slice(half);$('#planCards').innerHTML=songs.map(card).join('')||'<p class="empty">No songs available for this day.</p>';$$('.day-tab').forEach(b=>b.classList.toggle('active',Number(b.dataset.day)===planDay));}
function renderComfort(){const songs=roomState?.comfortSongs||[];$('#comfortMixes').innerHTML=[0,1].map(n=>`<article class="comfort-card"><h2>${n?'Another familiar turn':'Back to our favorites'}</h2><p class="muted">From our shared playlists and likes.</p><ol class="comfort-list">${songs.slice(n*6,n*6+6).map(t=>`<li><strong>${esc(t.title)}</strong><span>${esc(t.artist)}</span><button data-preview data-artist="${esc(t.artist)}" data-title="${esc(t.title)}">▶ Preview</button></li>`).join('')}</ol></article>`).join('');}
function renderProfile(){const vals=[...localRatings.values()];const liked=vals.filter(v=>v==='like').length,skipped=vals.filter(v=>v==='skip').length,known=vals.filter(v=>v==='known').length;$('#profileStats').innerHTML=`<div class="stat-card"><strong>${liked}</strong><span>shared likes</span></div><div class="stat-card"><strong>${skipped}</strong><span>skipped songs</span></div><div class="stat-card"><strong>${known}</strong><span>already known</span></div>`;const rows=[...localRatings.entries()].map(([k,v])=>{const[a,t]=k.split('|');return`<div class="rating-row"><div><strong>${esc(t)}</strong><span>${esc(a)}</span></div><span>${v==='like'?'More like this':v==='skip'?'Not for us':'Already know'}</span></div>`;}).join('');$('#ratingsList').innerHTML=rows||'<p class="muted">No shared feedback yet. Like or skip a few songs in Discover.</p>';}
function renderAll(){renderDiscover();renderPlan();renderComfort();renderProfile();}
let roomState=null,roomBusy=false;
function acceptRoom(state){if(!state||!Number.isInteger(state.revision)||!state.songRatings)throw Error('Invalid room response');if(roomState&&state.revision<roomState.revision)return;roomState=state;sharedSongs=normalizeSongs(state.batch?.relevanceVersion===2?state.batch.items:[]);localRatings=new Map(Object.values(state.songRatings).map(t=>[songKey(t),t.value==='replay'?'like':t.value]));sourceMode='live';renderAll();refreshControls();}
function refreshControls(){const b=$('#reloadMix'),seconds=Math.max(0,Math.ceil(((roomState?.nextRefresh||0)-Date.now())/1000));b.disabled=roomBusy||!roomState||roomState.refreshing||seconds>0||roomState.needsTasteImport;b.textContent=roomBusy||roomState?.refreshing?'Generating…':seconds?`Refresh in ${seconds}s`:'Refresh picks';}
async function loadShared(){try{acceptRoom(await request('/state'));$('#roomStatus').textContent=roomState.pendingSongCount?`${roomState.pendingSongCount}/12 next picks saved in the shared draft. Current songs remain available.`:`Connected · ${sharedSongs.length} shared picks. Feedback affects everyone.`;}catch(e){$('#roomStatus').textContent='Shared room unavailable. '+e.message;} }
$('#reloadMix').addEventListener('click',async()=>{if(roomBusy||$('#reloadMix').disabled)return;roomBusy=true;refreshControls();$('#roomStatus').textContent='Generating the next shared mix…';try{const r=await request('/refresh',{language:roomState.batch?.language||'Mixed'});acceptRoom(r);$('#roomStatus').textContent=r.message||'Shared mix updated.';}catch(e){$('#roomStatus').textContent=e.message;}finally{roomBusy=false;refreshControls();}});
setInterval(refreshControls,1000);setInterval(()=>{if(!roomBusy&&!document.hidden)loadShared();},60000);
$('#mixSearch').addEventListener('input',e=>{searchTerm=e.target.value;renderDiscover();clearTimeout(window.__searchMunna);window.__searchMunna=setTimeout(()=>Munna.react('search'),260);});
$$('.mood-pill').forEach(b=>b.addEventListener('click',()=>{moodFilter=b.dataset.mood;$$('.mood-pill').forEach(x=>x.classList.toggle('active',x===b));renderDiscover();Munna.react('search');}));
$$('.day-tab').forEach(b=>b.addEventListener('click',()=>{planDay=Number(b.dataset.day);renderPlan();}));
document.addEventListener('click',async e=>{const r=e.target.closest('[data-rate]');if(!r||roomBusy)return;const c=r.closest('[data-card]'),song={artist:c.dataset.artist,title:c.dataset.title};const selected=r.dataset.rate;const rating=localRatings.get(songKey(song))===selected?'clear':selected==='like'?'replay':selected;roomBusy=true;r.disabled=true;try{acceptRoom(await request('/feedback',{...song,rating}));Munna.react(selected);toast('Song feedback saved for everyone');}catch(error){toast('Feedback not saved: '+error.message);}finally{roomBusy=false;r.disabled=false;refreshControls();}});
$$('[data-test-event]').forEach(b=>b.addEventListener('click',()=>Munna.react(b.dataset.testEvent)));
document.addEventListener('pointerover',e=>{const c=e.target.closest('[data-card]');if(!c)return;const k=`${c.dataset.artist}|${c.dataset.title}`;const now=performance.now();if(k===hoveredSongKey||now-hoverSayAt<6500)return;hoveredSongKey=k;hoverSayAt=now;setTimeout(()=>{if(c.matches(':hover'))Munna.react('hover',{title:c.dataset.title,artist:c.dataset.artist});},360);});
document.addEventListener('pointerout',e=>{const c=e.target.closest('[data-card]');if(c&&!c.matches(':hover'))hoveredSongKey='';});
document.addEventListener('pointermove',e=>{if(!matchMedia('(pointer:fine)').matches)return;const c=e.target.closest('[data-card]');if(!c)return;const r=c.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;c.style.setProperty('--ry',`${(x*3.2).toFixed(2)}deg`);c.style.setProperty('--rx',`${(-y*2.5).toFixed(2)}deg`);});document.addEventListener('pointerout',e=>{const c=e.target.closest('[data-card]');if(c){c.style.setProperty('--ry','0deg');c.style.setProperty('--rx','0deg');}});

// ---------- Main 3D character ----------

// ---------- Main 3D character / v24 production runtime ----------
const canvas=$('#munnaStage');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.08;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(33,1,.01,60);
const cameraHome=new THREE.Vector3(1.10,1.46,3.36);
const cameraTargetHome=new THREE.Vector3(0,.96,.02);
const cameraTargetNow=cameraTargetHome.clone();
camera.position.copy(cameraHome);camera.lookAt(cameraTargetHome);

// brighter but soft / no harsh character shadows
scene.add(new THREE.AmbientLight(0xffffff,1.36));
scene.add(new THREE.HemisphereLight(0xf5f8ff,0x5a5366,1.22));
const key=new THREE.DirectionalLight(0xfff2e8,.22);key.position.set(2.6,4.0,4.8);scene.add(key);
const fill=new THREE.DirectionalLight(0xdceaff,.72);fill.position.set(-3.0,3.0,4.1);scene.add(fill);
const rim=new THREE.DirectionalLight(0xa89cff,.016);rim.position.set(1.8,3.0,-3.4);scene.add(rim);
const boothFaceFill=new THREE.PointLight(0xffffff,.24,4.8,2);boothFaceFill.position.set(0,1.35,1.95);scene.add(boothFaceFill);
const boothLowFill=new THREE.PointLight(0xb7dbff,.14,3.4,2);boothLowFill.position.set(0,.92,1.2);scene.add(boothLowFill);
const softFront=new THREE.PointLight(0xffeee7,.30,7.5,2);softFront.position.set(0,1.72,3.6);scene.add(softFront);
const boothFillL=new THREE.PointLight(0xe7f1ff,.24,4.5,2);boothFillL.position.set(-1.15,1.02,1.65);scene.add(boothFillL);
const boothFillR=new THREE.PointLight(0xffeee7,.20,4.5,2);boothFillR.position.set(1.15,1.00,1.55);scene.add(boothFillR);

const grid=new THREE.GridHelper(5.6,22,0x335f83,0x172335);
grid.material.transparent=true;grid.material.opacity=.18;grid.position.y=.002;scene.add(grid);
const floor=new THREE.Mesh(new THREE.CircleGeometry(3.8,72),new THREE.MeshStandardMaterial({color:0x111720,roughness:.98,metalness:0,transparent:true,opacity:.72}));
floor.rotation.x=-Math.PI/2;floor.position.y=0;scene.add(floor);

const gltfLoader=new GLTFLoader(),fbxLoader=new FBXLoader(),clock=new THREE.Clock(),raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2();
let avatar=null,shoes=null,mixer=null,headBone=null,headMesh=null,originalGlasses=null,spine2=null;
let leftArm=null,leftFore=null,leftHand=null,rightArm=null,rightFore=null,rightHand=null;
let morphMeshes=[],rest=new Map(),clips=new Map(),clipPromises=new Map(),baseAction=null,overlayAction=null;
let state='loading',zone='booth',locomotion=null,lastSide='right',avatarHeight=1.82,avatarDepth=.34,grounder=null,groundedRootY=0,stageAspect=1;
const danceGroundY=new Map();
let boothRoot=null,boothBox=new THREE.Box3(),boothSize=new THREE.Vector3(),boothRearZ=0,boothFrontZ=0,boothHalfX=0,boothDeckY=.92,boothDeckZ=0;
let djLeftObject=null,djMixerObject=null,djRightObject=null,deskObject=null,consoleObject=null;
const zones={},followers=[];
let headphones=null,sunglasses=null,showHeadphones=false,showSunglasses=false;
let faceEvent=null,expr=null,headFx=null,bodyFx=null,nextBlink=performance.now()+2200;
let nextDJ=0,djReach=null,previewPlaying=false,djSequenceIndex=0,autoDanceTimer=0,autoReturnTimer=0;
let bubbleTimer=0,nextIdleBanter=performance.now()+12000,nextPerformanceAccent=0,stagePointer={x:0,y:0,active:false,last:0},gazeFollow={x:0,y:0};
let decorEmissives=[];

BANTER.idle.push("I reorganized the set by vibe. Scientifically.","The booth has more buttons than my confidence.","If this mix gets weird, we call it experimental.");
BANTER.search.push("Searching the crates… digitally, unfortunately.","I’m looking too. Mostly for snacks.","Give me a second—pretending this is vinyl.");
BANTER.like.push("Correct answer. No notes.","That deserves a tiny victory lap.","I knew you had range.");
BANTER.skip.push("Gone. We never speak of it again.","Brutal. Efficient. I respect it.","Next. My face said it before you clicked.");
BANTER.known.push("Okay, encyclopedia. Your turn to surprise me.","Already know it? Fine, deeper cut incoming.","Show-off mode detected.");
BANTER.poke.push("That is not a touch screen.","Careful. Premium DJ. Questionable warranty.","My union rep is a loading spinner.");
BANTER.dj.push("Crossfader diplomacy.","Tiny knob. Huge responsibility.","Cue point found. Confidence restored.");
BANTER.hover.push("You keep hovering. Commit to the bit.","That card is getting nervous.","Preview it. I dare you.");
BANTER.head=["Hair check? I charge by the tap.","Easy. The hairstyle is structural.","That was my head, not the play button."];
BANTER.glasses=["Fingerprints. Very cinematic.","These are calibrated for maximum judgment.","Touch the glasses again and I invoice you."];
BANTER.headphones=["Hey—those are working headphones.","Cue monitor. Not a fidget toy.","One ear off and the beat gets suspicious."];
BANTER.arm=["That arm is currently on payroll.","Careful. Precision DJ limb.","I need that hand for the mixer."];
BANTER.torso=["Personal space has entered the chat.","That button was not on my hoodie.","Okay, that one registered."];
BANTER.legs=["The legs are busy maintaining credibility.","Please do not trip the DJ.","Grounding test accepted. Barely."];

function pick(arr){return arr[Math.floor(Math.random()*arr.length)];}
function say(text,duration=2800,tone='talk'){const b=$('#munnaBubble'),t=$('#munnaBubbleText');if(!b||!t||!text)return;clearTimeout(bubbleTimer);t.textContent=text;b.dataset.tone=tone;b.classList.add('show');positionMainBubble();bubbleTimer=setTimeout(()=>b.classList.remove('show'),duration);}
function sayFrom(kind,duration=2800){say(pick(BANTER[kind]||BANTER.idle),duration,kind);}
$('#randomBanter')?.addEventListener('click',async()=>{sayFrom('idle',3400);if(Math.random()<.55)await overlayOnce(pick(['conversation','talkFunny','ask']),.46);});

function setState(s){state=s;const label=s==='dj'?'DJing':s==='dance'?'Dancing':s==='walk'?'Walking':s==='listening'?'Listening':s==='look'?'Looking around':'Relaxed';$('#munnaStateLabel').textContent=label;const sig=$('#nowSignal');if(sig)sig.textContent=label.toLowerCase();}
function setZone(z){zone=z;$('#munnaZoneLabel').textContent=z.startsWith('dance')?'DANCE FLOOR':'BOOTH';}
function indexRest(root){rest.clear();root.traverse(o=>{if(o.name)rest.set(o.name,{q:o.quaternion.clone(),p:o.position.clone()});});}
function trackInfo(name){const dot=name.lastIndexOf('.');return dot<0?null:{node:name.slice(0,dot),prop:name.slice(dot+1)};}
function retarget(srcRoot,clip,def){
  const tracks=[];
  for(const t of clip.tracks){
    const info=trackInfo(t.name);if(!info)continue;
    if(def.upperMode==='upper'&&!matches(info.node,UPPER))continue;
    if(def.upperMode==='music'&&!matches(info.node,MUSIC_UPPER))continue;
    const target=rest.get(info.node),source=srcRoot.getObjectByName(info.node);if(!target||!source)continue;
    if(info.prop==='quaternion'){
      const vals=new Float32Array(t.values.length),inv=source.quaternion.clone().invert(),q=new THREE.Quaternion(),d=new THREE.Quaternion(),out=new THREE.Quaternion();
      for(let i=0;i<t.values.length;i+=4){q.fromArray(t.values,i);d.copy(inv).multiply(q).normalize();out.copy(target.q).multiply(d).normalize();out.toArray(vals,i);}
      tracks.push(new THREE.QuaternionKeyframeTrack(t.name,t.times,vals,t.getInterpolation()));
    }else if(info.prop==='position'&&!def.upperMode){
      const vals=new Float32Array(t.values.length),p=new THREE.Vector3(),d=new THREE.Vector3(),out=new THREE.Vector3();
      for(let i=0;i<t.values.length;i+=3){p.fromArray(t.values,i);d.copy(p).sub(source.position);if(info.node==='Hips'||info.node==='AvatarRoot'){d.set(0,0,0);}out.copy(target.p).add(d);out.toArray(vals,i);}
      tracks.push(new THREE.VectorKeyframeTrack(t.name,t.times,vals,t.getInterpolation()));
    }
  }
  return new THREE.AnimationClip(def.label,clip.duration,tracks);
}
async function loadClip(keyName){
  if(clips.has(keyName))return clips.get(keyName);
  if(clipPromises.has(keyName))return clipPromises.get(keyName);
  const p=(async()=>{const def=CLIPS[keyName],src=await fbxLoader.loadAsync(def.url);const clip=retarget(src,src.animations[0],def);clips.set(keyName,clip);clipPromises.delete(keyName);return clip;})();
  clipPromises.set(keyName,p);return p;
}
function action(keyName,which=mixer){const c=clips.get(keyName);return c?which.clipAction(c):null;}
async function ensureAction(keyName,which=mixer){if(!clips.has(keyName))await loadClip(keyName);return action(keyName,which);}
function playBase(keyName,fade=.14,time=1){const a=action(keyName);if(!a)return;const old=baseAction;a.enabled=true;a.reset().setLoop(THREE.LoopRepeat,Infinity).setEffectiveWeight(1).setEffectiveTimeScale(time).play();if(old&&old!==a)a.crossFadeFrom(old,fade,true);else a.fadeIn(fade);baseAction=a;}
function stopOverlay(fade=.08){if(!overlayAction)return;const old=overlayAction;old.fadeOut(fade);setTimeout(()=>old.stop(),180);overlayAction=null;}
async function overlayOnce(keyName,weight=.62){
  const a=await ensureAction(keyName);if(!a)return;
  return new Promise(resolve=>{a.enabled=true;a.reset().setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.setEffectiveWeight(weight).play().fadeIn(.06);overlayAction=a;const done=e=>{if(e.action!==a)return;mixer.removeEventListener('finished',done);a.fadeOut(.07);setTimeout(()=>a.stop(),150);if(overlayAction===a)overlayAction=null;resolve();};mixer.addEventListener('finished',done);});
}

// Grounding strategy v25:
// Standing/listening/walking share one calibrated root Y, eliminating per-frame vertical jitter.
// Dances keep authored jumps and only get upward correction when footwear penetrates the floor.
function currentSoleY(root,shoeObject){
  if(!root||!shoeObject)return Infinity;
  root.updateMatrixWorld(true);
  let sole=Infinity;
  if(shoeObject.isSkinnedMesh&&typeof shoeObject.computeBoundingBox==='function'){
    shoeObject.computeBoundingBox();
    if(shoeObject.boundingBox){shoeObject.updateMatrixWorld(true);sole=shoeObject.boundingBox.clone().applyMatrix4(shoeObject.matrixWorld).min.y;}
  }
  if(!Number.isFinite(sole)){const b=new THREE.Box3().setFromObject(shoeObject);sole=b.min.y;}
  return sole;
}
function createGrounder(root,shoeObject,groundY=0){
  const left=[root.getObjectByName('LeftFoot'),root.getObjectByName('LeftToeBase')].filter(Boolean);
  const right=[root.getObjectByName('RightFoot'),root.getObjectByName('RightToeBase')].filter(Boolean);
  let leftOffset=0,rightOffset=0,ready=false;
  const minBoneY=list=>Math.min(...list.map(o=>o.getWorldPosition(new THREE.Vector3()).y));
  const calibrate=()=>{
    root.updateMatrixWorld(true);const sole=currentSoleY(root,shoeObject);if(!Number.isFinite(sole)||!left.length||!right.length)return;
    leftOffset=minBoneY(left)-sole;rightOffset=minBoneY(right)-sole;ready=true;
  };
  return{
    calibrate,
    snap(){
      const sole=currentSoleY(root,shoeObject);if(!Number.isFinite(sole))return;
      root.position.y+=clamp(groundY-sole,-.20,.20);root.updateMatrixWorld(true);calibrate();
    },
    followFeet(dt,maxStep=.010){
      if(!ready)calibrate();if(!ready)return;
      root.updateMatrixWorld(true);
      const soleL=minBoneY(left)-leftOffset,soleR=minBoneY(right)-rightOffset;
      const support=Math.min(soleL,soleR),error=groundY-support;
      if(!Number.isFinite(error))return;
      const correction=clamp(error*(1-Math.exp(-13*dt)),-maxStep,maxStep);
      root.position.y+=correction;root.updateMatrixWorld(true);
    },
    clampDance(){
      const sole=currentSoleY(root,shoeObject);if(!Number.isFinite(sole))return;
      const penetration=groundY-sole;if(penetration>.0005){root.position.y+=Math.min(penetration,.050);root.updateMatrixWorld(true);}
    }
  };
}
function sampleGroundRequirement(root,mix,shoeObject,clip,groundY=0,samples=36){
  if(!root||!mix||!shoeObject||!clip)return 0;
  const pos=root.position.clone(),quat=root.quaternion.clone(),scale=root.scale.clone();
  mix.stopAllAction();root.position.y=0;root.updateMatrixWorld(true);
  const a=mix.clipAction(clip);a.reset().setLoop(THREE.LoopOnce,1).play();
  let minRel=Infinity;
  for(let i=0;i<samples;i++){a.time=clip.duration*(i/(samples-1));mix.update(0);root.updateMatrixWorld(true);const sole=currentSoleY(root,shoeObject);if(Number.isFinite(sole))minRel=Math.min(minRel,sole-root.position.y);}
  a.stop();mix.stopAllAction();root.position.copy(pos);root.quaternion.copy(quat);root.scale.copy(scale);root.updateMatrixWorld(true);
  return Number.isFinite(minRel)?groundY-minRel+.006:0;
}
function normalizeAngle(a){while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a;}
function dampAngle(a,b,l,dt){return a+normalizeAngle(b-a)*(1-Math.exp(-l*dt));}
function dampVec(v,target,l,dt){v.lerp(target,1-Math.exp(-l*dt));}

async function loadAvatar(){
  const g=await gltfLoader.loadAsync(asset('model.gltf'));avatar=g.scene;
  avatar.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}if(o.morphTargetDictionary)morphMeshes.push(o);});
  scene.add(avatar);shoes=avatar.getObjectByName('outfit_shoes');headBone=avatar.getObjectByName('Head');headMesh=avatar.getObjectByName('AvatarHead');originalGlasses=avatar.getObjectByName('glasses');spine2=avatar.getObjectByName('Spine2');
  leftArm=avatar.getObjectByName('LeftArm');leftFore=avatar.getObjectByName('LeftForeArm');leftHand=avatar.getObjectByName('LeftHand');rightArm=avatar.getObjectByName('RightArm');rightFore=avatar.getObjectByName('RightForeArm');rightHand=avatar.getObjectByName('RightHand');
  indexRest(avatar);mixer=new THREE.AnimationMixer(avatar);avatar.updateMatrixWorld(true);
  const ab=new THREE.Box3().setFromObject(avatar),as=ab.getSize(new THREE.Vector3());avatarHeight=as.y;avatarDepth=as.z;
  grounder=createGrounder(avatar,shoes,0);grounder.snap();
}

function setSoftMaterials(root,{glass=false}={}){
  root.traverse(o=>{if(!o.isMesh)return;o.castShadow=false;o.receiveShadow=false;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats.filter(Boolean)){if(m.map){m.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());}if('envMapIntensity'in m)m.envMapIntensity=.32;if('roughness'in m)m.roughness=Math.max(glass?.18:.34,m.roughness??.4);if('metalness'in m)m.metalness=Math.min(.72,m.metalness??.35);if('emissiveIntensity'in m&&m.emissive)m.emissiveIntensity=Math.min(Math.max(m.emissiveIntensity||0,.05),.5);m.needsUpdate=true;}});}
function centerObject(obj){obj.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(obj),c=b.getCenter(new THREE.Vector3());obj.position.sub(c);obj.updateMatrixWorld(true);return b.getSize(new THREE.Vector3());}
function topCenter(obj){const b=new THREE.Box3().setFromObject(obj),c=b.getCenter(new THREE.Vector3());return new THREE.Vector3(c.x,b.max.y,c.z);}

async function loadBooth(){
  boothRoot=new THREE.Group();scene.add(boothRoot);
  const [deskG,consoleG,playG,boomG]=await Promise.all([
    gltfLoader.loadAsync(asset('props/glass_desk.glb')),
    gltfLoader.loadAsync(asset('props/pioneer_cdj_djm.glb')),
    gltfLoader.loadAsync(asset('props/play_neon.glb')),
    gltfLoader.loadAsync(asset('props/neon_boombox.glb'))
  ]);

  // The downloaded glass-desk asset includes a giant decorative floor plane.
  // Remove it, then non-uniformly size the useful desk geometry to a wide, low DJ profile.
  deskObject=deskG.scene;
  const deskJunk=[];deskObject.traverse(o=>{if(/floor/i.test(o.name))deskJunk.push(o);});deskJunk.forEach(o=>o.parent?.remove(o));
  setSoftMaterials(deskObject,{glass:true});boothRoot.add(deskObject);
  // The desk asset was authored facing away from the audience. Flip ONLY the desk; the Pioneer hardware keeps its correct front-facing orientation.
  deskObject.rotation.y=Math.PI;
  deskObject.updateMatrixWorld(true);
  let rawDesk=new THREE.Box3().setFromObject(deskObject),rawDeskSize=rawDesk.getSize(new THREE.Vector3());
  const targetDeskWidth=avatarHeight*1.05;
  const targetDeskHeight=avatarHeight*.52;
  const targetDeskDepth=avatarHeight*.30;
  deskObject.scale.set(
    targetDeskWidth/Math.max(rawDeskSize.x,.001),
    targetDeskHeight/Math.max(rawDeskSize.y,.001),
    targetDeskDepth/Math.max(rawDeskSize.z,.001)
  );
  deskObject.updateMatrixWorld(true);
  let db=new THREE.Box3().setFromObject(deskObject),dc=db.getCenter(new THREE.Vector3());
  deskObject.position.x-=dc.x;deskObject.position.y-=db.min.y;deskObject.position.z-=dc.z;deskObject.updateMatrixWorld(true);
  db=new THREE.Box3().setFromObject(deskObject);

  // Pioneer hardware is uniformly scaled and centered over the desk top.
  consoleObject=consoleG.scene;setSoftMaterials(consoleObject);boothRoot.add(consoleObject);
  consoleObject.updateMatrixWorld(true);
  const rawConsole=new THREE.Box3().setFromObject(consoleObject),rawConsoleSize=rawConsole.getSize(new THREE.Vector3());
  const targetConsoleWidth=targetDeskWidth*.84;
  const consoleScale=targetConsoleWidth/Math.max(rawConsoleSize.x,.001);
  consoleObject.scale.setScalar(consoleScale);consoleObject.updateMatrixWorld(true);
  let cb=new THREE.Box3().setFromObject(consoleObject),cc=cb.getCenter(new THREE.Vector3());
  consoleObject.position.x-=cc.x;consoleObject.position.z-=cc.z;consoleObject.position.y+=db.max.y-cb.min.y+.012;consoleObject.updateMatrixWorld(true);

  djLeftObject=consoleObject.getObjectByName('Pioneer CDJ 3000 NXS 1_Textures_0')||consoleObject;
  djMixerObject=consoleObject.getObjectByName('Pioneer DJM A9_Pioneer DJM A9 Texture_0')||consoleObject;
  djRightObject=consoleObject.getObjectByName('Pioneer CDJ 3000 NXS 2_Textures_0')||consoleObject;

  // A shallow opaque front fascia makes the glass desk read as a coherent booth without making it tall/heavy.
  const fasciaMat=new THREE.MeshStandardMaterial({color:0x111722,roughness:.74,metalness:.28});
  const fascia=new THREE.Mesh(new THREE.BoxGeometry(targetDeskWidth*.92,targetDeskHeight*.36,.042),fasciaMat);
  fascia.position.set(0,targetDeskHeight*.27,targetDeskDepth*.50+.006);boothRoot.add(fascia);

  // Lightweight dystopian accents: centered PLAY sign behind the DJ, boombox facing the audience.
  const play=playG.scene;
  const playRaw=centerObject(play);setSoftMaterials(play);
  const playTargetWidth=targetDeskWidth*.52;
  play.scale.setScalar(playTargetWidth/Math.max(playRaw.x,.001));
  play.rotation.set(0,0,0);
  play.position.set(0,avatarHeight*1.19,-.62);
  scene.add(play);
  play.traverse(o=>{const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats.filter(Boolean)){if('emissiveIntensity'in m){m.emissiveIntensity=1.25;decorEmissives.push(m);}}});
  const playGlow=new THREE.PointLight(0xff4fc3,.10,2.8,2);playGlow.position.set(0,avatarHeight*1.15,-.36);scene.add(playGlow);
  const playFill=new THREE.PointLight(0x49d9ff,.10,2.5,2);playFill.position.set(-.48,avatarHeight*1.03,-.28);scene.add(playFill);

  const boom=boomG.scene;
  const boomRaw=centerObject(boom);setSoftMaterials(boom);
  const boomTargetWidth=avatarHeight*.38;
  boom.scale.setScalar(boomTargetWidth/Math.max(boomRaw.z,boomRaw.x,.001));
  // This model's face is authored on its side axis; quarter-turn it toward the audience/camera.
  boom.rotation.y=Math.PI/2;
  boom.position.set(targetDeskWidth*.56,.24,-.22);
  scene.add(boom);
  boom.traverse(o=>{const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats.filter(Boolean)){if('emissiveIntensity'in m&&m.emissive){m.emissiveIntensity=.58;decorEmissives.push(m);}}});

  boothRoot.updateMatrixWorld(true);boothBox.setFromObject(boothRoot);boothSize=boothBox.getSize(new THREE.Vector3());
  boothRearZ=boothBox.min.z;boothFrontZ=boothBox.max.z;boothHalfX=boothSize.x*.5+avatarDepth*.72;
  boothDeckY=Math.max(topCenter(djMixerObject).y-.02,db.max.y+.035);
  boothDeckZ=topCenter(djMixerObject).z;
  zones.booth=new THREE.Vector3(0,groundedRootY,boothRearZ-avatarDepth*.72);
  zones.leftRear=new THREE.Vector3(-boothHalfX,groundedRootY,zones.booth.z);zones.rightRear=new THREE.Vector3(boothHalfX,groundedRootY,zones.booth.z);
  zones.leftDance=new THREE.Vector3(-boothHalfX-.18,groundedRootY,boothFrontZ+avatarDepth*.84);zones.rightDance=new THREE.Vector3(boothHalfX+.18,groundedRootY,boothFrontZ+avatarDepth*.84);
  avatar.position.copy(zones.booth);setZone('booth');

  // Camera homes are derived from the final booth width, avoiding a stretched-looking stage.
  cameraTargetHome.set(0,avatarHeight*.54,0);
  cameraHome.set(.34,avatarHeight*.72,Math.max(2.70,targetDeskWidth*1.26));
  camera.position.copy(cameraHome);cameraTargetNow.copy(cameraTargetHome);camera.lookAt(cameraTargetHome);
}

function fitFollower(obj,targetCenter,targetWidth,extraRotation=null){
  const wrap=new THREE.Group();scene.add(wrap);wrap.add(obj);obj.updateMatrixWorld(true);
  const raw=new THREE.Box3().setFromObject(obj),rs=raw.getSize(new THREE.Vector3()),rc=raw.getCenter(new THREE.Vector3());
  obj.position.sub(rc);if(extraRotation)obj.rotation.copy(extraRotation);
  wrap.scale.setScalar(targetWidth/Math.max(rs.x,.0001));wrap.updateMatrixWorld(true);
  const nb=new THREE.Box3().setFromObject(wrap),nc=nb.getCenter(new THREE.Vector3());wrap.position.add(targetCenter.clone().sub(nc));wrap.updateMatrixWorld(true);
  headBone.updateMatrixWorld(true);const offset=new THREE.Matrix4().copy(headBone.matrixWorld).invert().multiply(wrap.matrixWorld);followers.push({wrap,offset});return wrap;
}
function pruneAccessoryOutliers(root){
  const candidates=[];
  root.updateMatrixWorld(true);
  root.traverse(o=>{
    if(!o.isMesh)return;
    const b=new THREE.Box3().setFromObject(o),sz=b.getSize(new THREE.Vector3()),m=Math.max(sz.x,sz.y,sz.z);
    if(Number.isFinite(m))candidates.push({o,m});
  });
  if(candidates.length<2)return;
  const vals=candidates.map(x=>x.m).sort((a,b)=>a-b),median=vals[Math.floor(vals.length/2)]||1;
  for(const x of candidates){if(x.m>Math.max(.6,median*8))x.o.parent?.remove(x.o);}
}
async function loadProps(){
  avatar.updateMatrixWorld(true);
  const hb=new THREE.Box3().setFromObject(headMesh),hs=hb.getSize(new THREE.Vector3()),hc=hb.getCenter(new THREE.Vector3());
  const gh=new THREE.Box3().setFromObject(originalGlasses),gs=gh.getSize(new THREE.Vector3()),gc=gh.getCenter(new THREE.Vector3());

  const h=await fbxLoader.loadAsync(asset('props/headphones.fbx'));
  pruneAccessoryOutliers(h);setSoftMaterials(h);
  // Fit earcups around the lateral head width and slightly below the crown.
  headphones=fitFollower(h,hc.clone().add(new THREE.Vector3(0,-hs.y*.035,-hs.z*.025)),hs.x*1.12);

  const g=await gltfLoader.loadAsync(asset('props/sunglasses.glb'));
  setSoftMaterials(g.scene);
  // Original glasses are our most trustworthy face landmark.
  sunglasses=fitFollower(g.scene,gc.clone().add(new THREE.Vector3(0,-gs.y*.015,.006)),gs.x*.965);
  updateProps();
}
function updateFollowers(){if(!headBone)return;headBone.updateMatrixWorld(true);for(const f of followers){const m=new THREE.Matrix4().multiplyMatrices(headBone.matrixWorld,f.offset);m.decompose(f.wrap.position,f.wrap.quaternion,f.wrap.scale);f.wrap.updateMatrixWorld(true);}}
function updateProps(){if(headphones)headphones.visible=showHeadphones;if(sunglasses)sunglasses.visible=showSunglasses;if(originalGlasses)originalGlasses.visible=!showSunglasses;}

function startWalk(points,onDone){
  stopOverlay();playBase('walk',.11,.80);
  // Fixed locomotion plane: X/Z move, Y never chases feet frame-by-frame.
  avatar.position.y=groundedRootY;
  locomotion={points:points.map(p=>p.clone()),i:0,speed:.50,onDone};
  setState('walk');
}
function updateWalk(dt){
  if(!locomotion)return;
  avatar.position.y=groundedRootY;
  let target=locomotion.points[locomotion.i],d=target.clone().sub(avatar.position);d.y=0;let len=d.length();
  if(len<.025){
    avatar.position.x=target.x;avatar.position.z=target.z;locomotion.i++;
    if(locomotion.i>=locomotion.points.length){
      const done=locomotion.onDone;locomotion=null;avatar.position.y=groundedRootY;avatar.rotation.y=dampAngle(avatar.rotation.y,0,14,dt);done?.();return;
    }
    target=locomotion.points[locomotion.i];d=target.clone().sub(avatar.position);d.y=0;len=d.length();
  }
  if(len>1e-5){
    d.normalize();
    avatar.rotation.y=dampAngle(avatar.rotation.y,Math.atan2(d.x,d.z),10,dt);
    avatar.position.addScaledVector(d,Math.min(len,locomotion.speed*dt));
  }
}
function chooseDance(){
  const options=['danceA','danceB','danceC','danceD','danceStep','danceSnake','danceTwist','danceRunning','danceHouse3','danceSalsa'].filter(k=>clips.has(k));
  return pick(options.length?options:['danceA']);
}
function danceOut(){
  if(zone!=='booth'||locomotion)return;lastSide=lastSide==='left'?'right':'left';const rear=zones[lastSide+'Rear'],dance=zones[lastSide+'Dance'];
  showSunglasses=true;showHeadphones=true;updateProps();say(pick(["Okay. Booth break.","Fine. Dance floor inspection.","If anyone asks, this is soundcheck."]),2200);
  startWalk([rear,dance],()=>{setZone('dance-'+lastSide);avatar.rotation.y=0;const danceKey=chooseDance();avatar.position.y=groundedRootY-.010;playBase(danceKey,.11,.96);setState('dance');mixer.update(0);});
}
function returnBooth(next='relaxed'){
  if(locomotion)return;if(zone==='booth'){setCore(next);return;}
  const side=zone.includes('left')?'left':'right';say("Back to pretending I know every knob.",2200);
  startWalk([zones[side+'Rear'],zones.booth],()=>{setZone('booth');avatar.rotation.y=0;showSunglasses=false;updateProps();avatar.position.y=groundedRootY;setCore(next);});
}
function setCore(next){
  if(locomotion)return;if(zone!=='booth'){returnBooth(next);return;}stopOverlay();avatar.position.y=groundedRootY;
  if(next==='relaxed'){playBase('relaxed');showHeadphones=false;showSunglasses=false;setState('relaxed');}
  else if(next==='look'){playBase('look',.14,.92);showHeadphones=false;showSunglasses=false;setState('look');}
  else if(next==='listening'){playBase('listening',.13,.98);showHeadphones=true;showSunglasses=false;setState('listening');}
  else if(next==='dj'){playBase('listening',.12,1);showHeadphones=true;showSunglasses=false;setState('dj');nextDJ=0;}
  updateProps();
}
function updateCamera(dt){
  const following=zone!=='booth'||!!locomotion;
  const narrow=stageAspect<.88;
  const focus=following?new THREE.Vector3(avatar.position.x,avatarHeight*.53,avatar.position.z):cameraTargetHome.clone();
  const desired=following
    ?new THREE.Vector3(avatar.position.x+(narrow?.62:.90),avatarHeight*.76,avatar.position.z+(narrow?3.72:3.22))
    :cameraHome.clone().add(new THREE.Vector3(0,0,narrow?.42:0));
  dampVec(camera.position,desired,4.3,dt);dampVec(cameraTargetNow,focus,5.0,dt);camera.lookAt(cameraTargetNow);
}

// ---------- Face / in-place reactions ----------
function morphIndex(m,n){return m.morphTargetDictionary?.[n];}
function morph(n,v){for(const m of morphMeshes){const i=morphIndex(m,n);if(i!==undefined)m.morphTargetInfluences[i]=v;}}
function blink(){const n=performance.now();faceEvent={type:'blink',end:n+140};nextBlink=n+2600+Math.random()*3200;}
function wink(side){const n=performance.now();faceEvent={type:side,end:n+320};nextBlink=n+3000;}
function expression(type,d=850){const n=performance.now();expr={type,start:n,end:n+d};}
function headGesture(type,side=1,d=760){const n=performance.now();headFx={type,side,start:n,end:n+d};}
function bodyGesture(type,side=1,d=620){const n=performance.now();bodyFx={type,side,start:n,end:n+d};}
function updateCursorFollow(dt,now){
  const fresh=stagePointer.active&&now-stagePointer.last<1500&&state!=='walk'&&state!=='dance';
  const tx=fresh?clamp(stagePointer.x,-1,1):0,ty=fresh?clamp(stagePointer.y,-1,1):0;
  const k=1-Math.exp(-8.5*dt);gazeFollow.x=THREE.MathUtils.lerp(gazeFollow.x,tx,k);gazeFollow.y=THREE.MathUtils.lerp(gazeFollow.y,ty,k);
  if(!fresh||!headBone)return;
  const yaw=THREE.MathUtils.degToRad(-gazeFollow.x*11.5),pitch=THREE.MathUtils.degToRad(gazeFollow.y*5.5);
  headBone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ')));
  if(spine2&&!bodyFx){const sy=THREE.MathUtils.degToRad(-gazeFollow.x*2.2);spine2.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,sy,0,'YXZ')));}
}
function positionMainBubble(){
  const b=$('#munnaBubble');if(!b?.classList.contains('show')||!headBone)return;
  const p=headBone.getWorldPosition(new THREE.Vector3()).project(camera),dock=$('#munnaDock').getBoundingClientRect(),cr=canvas.getBoundingClientRect();
  const x=(cr.left-dock.left)+(p.x*.5+.5)*cr.width;
  const y=(cr.top-dock.top)+(-p.y*.5+.5)*cr.height;
  b.style.left=`${clamp(x,92,dock.width-92)}px`;
  b.style.top=`${clamp(y-62,70,dock.height-110)}px`;
}
function updateFace(now){
  if(faceEvent&&now>faceEvent.end)faceEvent=null;if(!faceEvent&&now>nextBlink)blink();
  morph('eyeBlinkLeft',faceEvent?.type==='blink'||faceEvent?.type==='left'?1:0);morph('eyeBlinkRight',faceEvent?.type==='blink'||faceEvent?.type==='right'?1:0);
  for(const n of ['mouthSmileLeft','mouthSmileRight','browInnerUp','browDownLeft','mouthFrownRight','jawOpen'])morph(n,0);
  if(expr&&now>expr.end)expr=null;if(expr){const t=(now-expr.start)/(expr.end-expr.start),e=Math.sin(Math.PI*clamp(t,0,1));if(expr.type==='smile'){morph('mouthSmileLeft',.72*e);morph('mouthSmileRight',.72*e);}if(expr.type==='surprised'){morph('browInnerUp',.58*e);morph('jawOpen',.14*e);}if(expr.type==='skeptical'){morph('browDownLeft',.25*e);morph('mouthFrownRight',.19*e);}}
  const fresh=stagePointer.active&&now-stagePointer.last<1500;const gx=fresh?gazeFollow.x:0,gy=fresh?gazeFollow.y:0,h=Math.abs(gx)*.48,v=Math.abs(gy)*.31;
  for(const n of ['eyeLookInLeft','eyeLookOutLeft','eyeLookUpLeft','eyeLookDownLeft','eyeLookInRight','eyeLookOutRight','eyeLookUpRight','eyeLookDownRight'])morph(n,0);
  if(fresh){morph(gx>0?'eyeLookInLeft':'eyeLookOutLeft',h);morph(gx>0?'eyeLookOutRight':'eyeLookInRight',h);morph(gy>0?'eyeLookUpLeft':'eyeLookDownLeft',v);morph(gy>0?'eyeLookUpRight':'eyeLookDownRight',v);}
}
function updateReactions(now){
  if(headFx&&now>headFx.end)headFx=null;if(bodyFx&&now>bodyFx.end)bodyFx=null;
  if(headFx&&headBone){const t=(now-headFx.start)/(headFx.end-headFx.start),e=Math.sin(Math.PI*clamp(t,0,1));let y=0,x=0,z=0;if(headFx.type==='nod')x=Math.sin(t*Math.PI*4)*THREE.MathUtils.degToRad(6)*e;if(headFx.type==='nope')y=Math.sin(t*Math.PI*5)*THREE.MathUtils.degToRad(9)*e;if(headFx.type==='search')y=Math.sin(t*Math.PI*3)*THREE.MathUtils.degToRad(13)*e;if(headFx.type==='tilt')z=headFx.side*THREE.MathUtils.degToRad(7)*e;headBone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z,'YXZ')));}
  if(bodyFx&&spine2){const t=(now-bodyFx.start)/(bodyFx.end-bodyFx.start),e=Math.sin(Math.PI*clamp(t,0,1)),r=bodyFx.side*THREE.MathUtils.degToRad(bodyFx.type==='recoil'?3.4:2.3)*e;spine2.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,r,-r*.22,'YXZ')));}
}

let searches=0,skips=0,touches=0,likes=0,knowns=0;
const reactionCycles={
  like:['happy','clap','cheer','fistPump'],
  skip:['sarcastic','shrug'],
  known:['point','wave','laugh','gestureForward'],
  search:['think','ask','point','conversation'],
  poke:['surprised','pokeBlock'],
  head:['surprised','laugh'],
  glasses:['point','sarcastic'],
  headphones:['surprised','gestureForward'],
  arm:['pokeBlock','shrug'],
  torso:['surprised','pokeBlock'],
  legs:['shrug','sarcastic']
};
async function reactionClip(type,count,weight=.5){const arr=reactionCycles[type]||[];if(!arr.length)return;await overlayOnce(arr[count%arr.length],weight);}
const Munna={
 async react(type,detail={}){
  if(!avatar||locomotion||state==='dance')return;
  if(type==='search'){searches++;sayFrom('search',3000);expression(searches%3===0?'skeptical':'smile',1000);headGesture('search',searches%2?1:-1,1350);await reactionClip('search',searches,.46);}
  else if(type==='like'){likes++;sayFrom('like',2800);expression('smile',1250);headGesture('nod',1,720);await reactionClip('like',likes,.52);}
  else if(type==='skip'){skips++;sayFrom('skip',3000);expression('skeptical',1050);headGesture('nope',1,920);await reactionClip('skip',skips,.48);}
  else if(type==='known'){knowns++;sayFrom('known',2800);wink(knowns%2?'left':'right');headGesture('nod',1,560);await reactionClip('known',knowns,.44);}
  else if(type==='hover'){say(detail.title?`“${detail.title}”? ${pick(BANTER.hover)}`:pick(BANTER.hover),2300);headGesture('tilt',detail.side||1,520);if(Math.random()<.26)overlayOnce('point',.28);}
  else if(type==='poke'||type==='touch'){
    touches++;
    const region=detail.region||'torso';
    const key=BANTER[region]?region:'poke';
    sayFrom(key,3000);
    if(region==='head'){expression('surprised',720);wink(touches%2?'left':'right');headGesture('tilt',detail.side||1,760);}
    else if(region==='glasses'){expression('skeptical',900);wink(touches%2?'right':'left');headGesture('nope',1,620);}
    else if(region==='headphones'){expression('surprised',680);headGesture('tilt',detail.side||1,640);}
    else if(region==='arm'){expression('skeptical',760);bodyGesture('recoil',-(detail.side||1),620);}
    else if(region==='legs'){headGesture('nope',1,850);bodyGesture('recoil',detail.side||1,560);}
    else{expression(touches%3===0?'skeptical':'surprised',760);headGesture(touches%3===0?'nope':'tilt',detail.side||1,720);bodyGesture('recoil',-(detail.side||1),640);}
    await reactionClip(reactionCycles[region]?region:'poke',touches,.50);
    if(touches%5===0){say("Okay. Interaction test passed. Personal space failed.",3200,'poke');overlayOnce('shrug',.52);}
  }
 },
 dance:danceOut,return:()=>returnBooth('relaxed'),state:()=>({state,zone})
};
window.Munna=Munna;
$('#testDance').addEventListener('click',danceOut);$('#testReturn').addEventListener('click',()=>returnBooth('relaxed'));

// DJ control targets are derived from the actual Pioneer objects, not guessed percentages.
function wpos(o){return o.getWorldPosition(new THREE.Vector3());}
function rotateToward(bone,eff,target,w){if(!bone||!eff||!bone.parent)return;const bp=wpos(bone),cur=wpos(eff).sub(bp).normalize(),tar=target.clone().sub(bp).normalize();if(cur.lengthSq()<1e-6||tar.lengthSq()<1e-6)return;const d=new THREE.Quaternion().setFromUnitVectors(cur,tar),world=bone.getWorldQuaternion(new THREE.Quaternion()),desired=d.multiply(world),parent=bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();bone.quaternion.slerp(parent.multiply(desired),w);bone.updateMatrixWorld(true);}
function reach(side,target,w=.10){const a=side==='left'?leftArm:rightArm,f=side==='left'?leftFore:rightFore,h=side==='left'?leftHand:rightHand;rotateToward(a,h,target,w*.54);avatar.updateMatrixWorld(true);rotateToward(f,h,target,w);}
function deckTarget(obj,sideOffset=0){const b=new THREE.Box3().setFromObject(obj),c=b.getCenter(new THREE.Vector3());return new THREE.Vector3(c.x+sideOffset,b.max.y+.012,c.z);}
function djTarget(type){
  if(type==='left'||type==='scratchLeft')return deckTarget(djLeftObject);
  if(type==='right'||type==='scratchRight')return deckTarget(djRightObject);
  if(type==='mixer'||type==='crossfade')return deckTarget(djMixerObject,type==='crossfade'?.02:0);
  if(type==='cue'){const hb=new THREE.Box3().setFromObject(headMesh),hc=hb.getCenter(new THREE.Vector3()),hs=hb.getSize(new THREE.Vector3());return new THREE.Vector3(hc.x+hs.x*.55,hc.y+hs.y*.02,hc.z+hs.z*.02);}
  return deckTarget(djMixerObject);
}
const DJ_MOVES=['scratchLeft','button','mixer','scratchRight','crossfade','cue','both','rummage'];
function beginDJMove(now){
  const type=DJ_MOVES[djSequenceIndex++%DJ_MOVES.length];djReach={type,start:now,end:now+(type==='cue'?1700:type==='both'?1800:1450)};nextDJ=djReach.end+THREE.MathUtils.randFloat(520,1150);$('#djActionLabel').textContent=type;
  if(type==='button')overlayOnce('button',.22);else if(type==='rummage')overlayOnce('reachRummage',.19);else if(type==='mixer'||type==='crossfade')overlayOnce('reachDown',.18);
  if(Math.random()<.38)sayFrom('dj',1900);
}
function updateDJ(now){
  if(!previewPlaying||zone!=='booth'||state!=='dj'){djReach=null;$('#djActionLabel').textContent='idle';return;}
  if(!djReach&&now>nextDJ)beginDJMove(now);if(!djReach)return;
  if(now>djReach.end){djReach=null;$('#djActionLabel').textContent='idle';return;}
  const t=(now-djReach.start)/(djReach.end-djReach.start),e=Math.sin(Math.PI*clamp(t,0,1)),wob=Math.sin(t*Math.PI*8);
  if(djReach.type==='scratchLeft'){const target=djTarget('left');target.x+=wob*.018;reach('left',target,.24*e);}
  else if(djReach.type==='scratchRight'){const target=djTarget('right');target.x+=wob*.018;reach('right',target,.24*e);}
  else if(djReach.type==='mixer'||djReach.type==='button'||djReach.type==='rummage'){const target=djTarget('mixer');target.x+=Math.cos(t*Math.PI*6)*.012;reach('right',target,.23*e);}
  else if(djReach.type==='crossfade'){const target=djTarget('crossfade');target.x+=wob*.030;reach('left',target,.23*e);}
  else if(djReach.type==='cue'){reach('right',djTarget('cue'),.24*e);}
  else if(djReach.type==='both'){reach('left',djTarget('left'),.20*e);reach('right',djTarget('mixer'),.19*e);}
}
function updateDecor(now){const pulse=previewPlaying?.78+.22*Math.sin(now*.012):.42+.06*Math.sin(now*.004);for(const m of decorEmissives){if('emissiveIntensity'in m)m.emissiveIntensity=clamp(pulse,.25,1.05);}}

canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();stagePointer.x=((e.clientX-r.left)/r.width)*2-1;stagePointer.y=-(((e.clientY-r.top)/r.height)*2-1);stagePointer.active=true;stagePointer.last=performance.now();});
canvas.addEventListener('pointerleave',()=>stagePointer.active=false);
document.addEventListener('pointermove',e=>{
  if(!matchMedia('(pointer:fine)').matches||!avatar)return;
  const r=canvas.getBoundingClientRect(),cx=r.left+r.width*.5,cy=r.top+r.height*.48;
  stagePointer.x=clamp((e.clientX-cx)/Math.max(r.width*.95,220),-1,1);
  stagePointer.y=clamp((cy-e.clientY)/Math.max(r.height*.92,220),-1,1);
  stagePointer.active=true;stagePointer.last=performance.now();
},{passive:true});
function isInsideObject(obj,root){for(let n=obj;n;n=n.parent)if(n===root)return true;return false;}
canvas.addEventListener('pointerup',e=>{
  if(!avatar)return;
  const r=canvas.getBoundingClientRect();ndc.x=((e.clientX-r.left)/r.width)*2-1;ndc.y=-(((e.clientY-r.top)/r.height)*2-1);raycaster.setFromCamera(ndc,camera);
  const roots=[avatar,headphones,sunglasses].filter(Boolean).filter(o=>o.visible!==false);
  const hits=raycaster.intersectObjects(roots,true);if(!hits.length)return;
  const hit=hits[0],b=new THREE.Box3().setFromObject(avatar),sz=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3());
  const ny=(hit.point.y-b.min.y)/Math.max(.001,sz.y),nx=(hit.point.x-c.x)/Math.max(.001,sz.x*.5);
  let region='torso';
  if(sunglasses&&isInsideObject(hit.object,sunglasses))region='glasses';
  else if(headphones&&isInsideObject(hit.object,headphones))region='headphones';
  else if(ny>.74)region='head';
  else if(ny<.34)region='legs';
  else if(Math.abs(nx)>.58)region='arm';
  Munna.react('touch',{region,side:hit.point.x>=avatar.position.x?1:-1});
});
function resizeMain(){const r=canvas.getBoundingClientRect(),w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));renderer.setSize(w,h,false);stageAspect=w/h;camera.aspect=stageAspect;camera.fov=stageAspect<.88?40:33;camera.updateProjectionMatrix();}
new ResizeObserver(resizeMain).observe($('#munnaDock'));

// ---------- Preview player / mini Munna ----------
const panel=$('#previewPlayer'),audio=panel.querySelector('audio'),pStatus=panel.querySelector('.player-status'),pTitle=panel.querySelector('.player-title'),pArtist=panel.querySelector('.player-artist'),pFallback=panel.querySelector('.player-fallback'),pSource=panel.querySelector('.player-source'),pAttr=panel.querySelector('.player-attribution');
let previewTicket=0,currentSong=null;
const miniCanvas=$('#miniStage'),miniRenderer=new THREE.WebGLRenderer({canvas:miniCanvas,antialias:true,alpha:true,powerPreference:'high-performance'});
miniRenderer.setPixelRatio(Math.min(devicePixelRatio,2));miniRenderer.outputColorSpace=THREE.SRGBColorSpace;miniRenderer.toneMapping=THREE.ACESFilmicToneMapping;miniRenderer.toneMappingExposure=1.03;
const miniScene=new THREE.Scene();miniScene.add(new THREE.AmbientLight(0xffffff,.66));miniScene.add(new THREE.HemisphereLight(0xf2f8ff,0x514963,1.08));const mkey=new THREE.DirectionalLight(0xffeadb,.42);mkey.position.set(2,4,4);miniScene.add(mkey);
const MINI_GROUND=.03;
let miniScreenFloorReady=false;
let miniSoleBoneOffset=.095;
const miniFloorScratch=new THREE.Vector3();

const miniCamera=new THREE.OrthographicCamera(-2,2,2.72,-.06,.01,20);miniCamera.position.set(0,1.30,5);miniCamera.lookAt(0,1.22,0);
let miniPreviewFloorY=.04,miniFloorCalibrated=false;
let mini=null,miniShoes=null,miniHead=null,miniMixer=null,miniBase=null,miniOverlay=null,miniOpen=false,miniDir=1,miniPause=0,miniTurning=false,miniMinX=-2,miniMaxX=2,lastNote=0,miniGroundedY=MINI_GROUND,miniGrounder=null;
let miniCeremony=false;
let miniPausedSeat=false;
let miniSitAction=null;
let miniSeatBase=null;
let miniSeatToken=0;

async function loadMini(){
  const g=await gltfLoader.loadAsync(asset('model.gltf'));
  mini=g.scene;
  mini.scale.setScalar(.92);
  mini.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});
  miniShoes=mini.getObjectByName('outfit_shoes');
  miniHead=mini.getObjectByName('Head');
  miniScene.add(mini);
  miniMixer=new THREE.AnimationMixer(mini);
  mini.visible=false;
  miniGroundedY=0;
  mini.position.y=0;
  mini.updateMatrixWorld(true);

  const feet=['LeftFoot','RightFoot','LeftToeBase','RightToeBase'].map(n=>mini.getObjectByName(n)).filter(Boolean);
  if(feet.length&&miniShoes){
    const footY=Math.min(...feet.map(f=>f.getWorldPosition(new THREE.Vector3()).y));
    const b=new THREE.Box3().setFromObject(miniShoes,true);
    const offset=footY-b.min.y;
    if(Number.isFinite(offset)&&offset>.015&&offset<.32)miniSoleBoneOffset=offset;
  }
  miniScreenFloorReady=true;
}

function calibrateMiniWalkFloor(){
  if(!mini||!miniMixer||miniFloorCalibrated)return;
  const FLOOR_Y=.045;
  const footNames=['LeftFoot','RightFoot','LeftToeBase','RightToeBase'];
  const feet=footNames.map(n=>mini.getObjectByName(n)).filter(Boolean);
  const walk=clips?.get?.('walk');
  const wasVisible=mini.visible;
  mini.visible=true;
  miniMixer.stopAllAction();
  mini.position.y=0;
  mini.updateMatrixWorld(true);

  const worldY=o=>o.getWorldPosition(new THREE.Vector3()).y;
  const restFootY=feet.length?Math.min(...feet.map(worldY)):Infinity;
  let soleOffset=0;
  if(miniShoes){
    const shoeBox=new THREE.Box3().setFromObject(miniShoes,true);
    if(Number.isFinite(shoeBox.min.y)&&Number.isFinite(restFootY))soleOffset=restFootY-shoeBox.min.y;
  }
  // Fallback offset if the shoe mesh has unstable bounds; toe/foot joints sit slightly above the sole.
  if(!Number.isFinite(soleOffset)||soleOffset<0||soleOffset>.35)soleOffset=.095;

  let minRelativeSole=Infinity;
  const sampleSole=()=>{
    mini.updateMatrixWorld(true);
    let sole;
    if(feet.length){
      const jointY=Math.min(...feet.map(worldY));
      sole=jointY-soleOffset;
    }else if(miniShoes){
      const b=new THREE.Box3().setFromObject(miniShoes,true);
      sole=b.min.y;
    }else{
      const b=new THREE.Box3().setFromObject(mini,true);
      sole=b.min.y;
    }
    if(Number.isFinite(sole))minRelativeSole=Math.min(minRelativeSole,sole-mini.position.y);
  };

  if(walk&&walk.duration>0){
    const action=miniMixer.clipAction(walk);
    action.reset().setLoop(THREE.LoopRepeat,Infinity).play();
    const samples=80;
    for(let i=0;i<=samples;i++){
      mini.position.y=0;
      miniMixer.setTime(walk.duration*i/samples);
      sampleSole();
    }
    action.stop();miniMixer.stopAllAction();
  }else sampleSole();

  if(!Number.isFinite(minRelativeSole))minRelativeSole=-.82;
  miniGroundedY=FLOOR_Y-minRelativeSole+.012;
  miniPreviewFloorY=FLOOR_Y;
  mini.position.y=miniGroundedY;
  mini.updateMatrixWorld(true);
  mini.visible=wasVisible;
  miniFloorCalibrated=true;
  console.info('[v35] preview foot floor',{miniGroundedY,soleOffset,minRelativeSole,feet:feet.map(f=>f.name)});
}

function pinMiniFeetToPlayerTop(){
  if(!mini||!miniScreenFloorReady)return;
  const stage=$('#miniWalkway');
  if(!stage)return;
  const h=Math.max(1,stage.clientHeight||stage.getBoundingClientRect().height||1);
  const feet=['LeftFoot','RightFoot','LeftToeBase','RightToeBase'].map(n=>mini.getObjectByName(n)).filter(Boolean);
  if(!feet.length)return;

  mini.updateMatrixWorld(true);
  let support=null,supportY=Infinity;
  for(const f of feet){
    const p=f.getWorldPosition(new THREE.Vector3());
    const soleY=p.y-miniSoleBoneOffset;
    if(soleY<supportY){supportY=soleY;support=p;}
  }
  if(!support)return;
  support.y-=miniSoleBoneOffset;
  support.project(miniCamera);

  // Canvas bottom = NDC -1. Keep soles a couple of pixels ABOVE the border so anti-aliasing
  // never makes them appear embedded in the card.
  const targetPx=h-3;
  const currentPx=(1-support.y)*.5*h;
  const errorPx=targetPx-currentPx;
  const worldPerPixel=(miniCamera.top-miniCamera.bottom)/h;
  // Positive screen error means the foot is too high; lower the avatar. Negative means too low; raise it.
  mini.position.y-=errorPx*worldPerPixel;
  miniGroundedY=mini.position.y;
  mini.updateMatrixWorld(true);
}
function solveMiniGround(){
  if(!mini)return;
  pinMiniFeetToPlayerTop();
}
function miniAction(k){const c=clips.get(k);return c?miniMixer.clipAction(c):null;}
function miniBasePlay(k,fade=.09,time=1){const a=miniAction(k);if(!a)return;const old=miniBase;a.enabled=true;a.reset().setLoop(THREE.LoopRepeat,Infinity).setEffectiveTimeScale(time).play();if(old&&old!==a)a.crossFadeFrom(old,fade,true);miniBase=a;}
function miniOverlayLoop(k,w=.11){if(miniOverlay){const old=miniOverlay;old.fadeOut(.06);setTimeout(()=>old.stop(),150);}const a=miniAction(k);if(!a)return;a.enabled=true;a.reset().setLoop(THREE.LoopRepeat,Infinity).setEffectiveWeight(w).play().fadeIn(.09);miniOverlay=a;}
function miniOverlayOnce(k,w=.70){return new Promise(resolve=>{const a=miniAction(k);if(!a){resolve();return;}a.enabled=true;a.reset().setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.setEffectiveWeight(w).play().fadeIn(.05);let timer;const finish=()=>{clearTimeout(timer);miniMixer.removeEventListener('finished',done);a.fadeOut(.06);setTimeout(()=>a.stop(),130);resolve();};const done=e=>{if(e.action===a)finish();};miniMixer.addEventListener('finished',done);timer=setTimeout(finish,Math.min(6000,Math.max(1000,a.getClip().duration*1000+500)));});}
function bubble(text,on=true){const b=$('#miniBubble');b.textContent=text;b.classList.toggle('show',on);}
function resizeMini(){
  const r=$('#miniWalkway').getBoundingClientRect();
  const w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));
  miniRenderer.setSize(w,h,false);
  // Horizontal orthographic camera: world Y maps directly to screen Y.
  const bottom=-.18,top=2.58,vertical=top-bottom;
  const halfW=(vertical/2)*w/h;
  miniCamera.left=-halfW;miniCamera.right=halfW;miniCamera.top=top;miniCamera.bottom=bottom;
  miniCamera.position.set(0,1.20,5);
  miniCamera.lookAt(0,1.20,0);
  miniCamera.updateProjectionMatrix();
  miniMinX=-halfW+.42;miniMaxX=halfW-.42;
  if(mini){
    mini.position.x=clamp(mini.position.x,miniMinX,miniMaxX);
    pinMiniFeetToPlayerTop();
  }
}
new ResizeObserver(resizeMini).observe($('#miniWalkway'));
function projectMiniHead(){if(!miniHead)return null;const p=miniHead.getWorldPosition(new THREE.Vector3()).project(miniCamera),r=$('#miniWalkway').getBoundingClientRect();return{x:(p.x*.5+.5)*r.width,y:(-.5*p.y+.5)*r.height};}
function emitNote(now){if(!previewPlaying||!miniOpen||now-lastNote<310)return;lastNote=now;const p=projectMiniHead();if(!p)return;const n=document.createElement('span');n.className='music-note';n.textContent=['♪','♫','♩','♬'][Math.floor(Math.random()*4)];n.style.left=`${p.x+8}px`;n.style.top=`${p.y+8}px`;n.style.setProperty('--dx',`${THREE.MathUtils.randFloat(-22,26).toFixed(1)}px`);$('#noteLayer').append(n);n.addEventListener('animationend',()=>n.remove(),{once:true});}
function positionBubble(){if(!miniOpen)return;const p=projectMiniHead();if(!p)return;const b=$('#miniBubble');b.style.left=`${p.x}px`;b.style.top=`${Math.max(0,p.y-28)}px`;}

function miniAngleDelta(from,to){
  let d=(to-from+Math.PI)%(Math.PI*2)-Math.PI;
  if(d<-Math.PI)d+=Math.PI*2;
  return d;
}
function miniPinFloor(){
  if(typeof pinMiniFeetToPlayerTop==='function')pinMiniFeetToPlayerTop();
  else if(mini)mini.position.y=miniGroundedY;
}
async function rotateMiniTo(target,duration=360){
  if(!mini)return;
  const start=mini.rotation.y,delta=miniAngleDelta(start,target),t0=performance.now();
  await new Promise(resolve=>{
    function step(now){
      const t=Math.min(1,(now-t0)/duration),e=t*t*(3-2*t);
      mini.rotation.y=start+delta*e;
      miniPinFloor();
      if(t<1)requestAnimationFrame(step);else{mini.rotation.y=target;miniPinFloor();resolve();}
    }
    requestAnimationFrame(step);
  });
}
function applyMiniDanceWalk(now){
  if(!mini||miniCeremony||miniPause>0)return;
  // Deliberately tiny upper-body groove. No Hips/AvatarRoot edits and no Y translation.
  const t=now*.001,beat=Math.sin(t*4.8),sway=Math.sin(t*2.4);
  const spine=mini.getObjectByName('Spine2')||mini.getObjectByName('Spine1');
  const neck=mini.getObjectByName('Neck')||mini.getObjectByName('Neck1');
  if(spine)spine.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,THREE.MathUtils.degToRad(sway*1.8),THREE.MathUtils.degToRad(beat*.55),'YXZ')));
  if(neck)neck.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(beat*.35),THREE.MathUtils.degToRad(-sway*.8),0,'YXZ')));
}

function setMiniSeatStage(on){
  const stage=$('#miniWalkway');if(!stage)return;
  stage.classList.toggle('mini-paused-seat',!!on);
}
function miniSeatOverlapPx(){
  const stage=$('#miniWalkway');if(!stage)return 72;
  const v=parseFloat(getComputedStyle(stage).getPropertyValue('--mini-seat-overlap'));
  return Number.isFinite(v)?v:72;
}
function pinMiniSeatToPlayerTop(){
  if(!mini)return;
  const stage=$('#miniWalkway'),hips=mini.getObjectByName('Hips');
  if(!stage||!hips)return;
  const h=Math.max(1,stage.clientHeight||stage.getBoundingClientRect().height||1);
  mini.updateMatrixWorld(true);
  const p=hips.getWorldPosition(new THREE.Vector3());
  // Hips bone is around pelvis center. Shift the contact point slightly downward so the seat/butt
  // visually rests on the same line the feet use while walking.
  p.y-=.105;
  p.project(miniCamera);
  const overlap=miniSeatOverlapPx();
  const targetPx=h-overlap-2;
  const currentPx=(1-p.y)*.5*h;
  const errorPx=targetPx-currentPx;
  const worldPerPixel=(miniCamera.top-miniCamera.bottom)/h;
  mini.position.y-=errorPx*worldPerPixel;
  mini.updateMatrixWorld(true);
}
function captureMiniSeatBase(){
  const names=['LeftLeg','RightLeg','LeftFoot','RightFoot','Spine2','Spine1','Neck','Neck1'];
  miniSeatBase={};
  for(const n of names){const b=mini?.getObjectByName(n);if(b&&!miniSeatBase[n])miniSeatBase[n]=b.quaternion.clone();}
}
function updateMiniPausedSeat(now){
  if(!mini||!miniPausedSeat)return;
  // Restore the frozen seated pose first so procedural motion never accumulates frame-to-frame.
  if(miniSeatBase){for(const [n,q] of Object.entries(miniSeatBase)){const b=mini.getObjectByName(n);if(b)b.quaternion.copy(q);}}
  const t=now*.001;
  const swing=Math.sin(t*3.5),counter=Math.sin(t*3.5+Math.PI);
  const qL=new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(swing*9),0,0));
  const qR=new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(counter*9),0,0));
  const qLF=new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-swing*3.5),0,0));
  const qRF=new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-counter*3.5),0,0));
  mini.getObjectByName('LeftLeg')?.quaternion.multiply(qL);
  mini.getObjectByName('RightLeg')?.quaternion.multiply(qR);
  mini.getObjectByName('LeftFoot')?.quaternion.multiply(qLF);
  mini.getObjectByName('RightFoot')?.quaternion.multiply(qRF);
  const spine=mini.getObjectByName('Spine2')||mini.getObjectByName('Spine1');
  if(spine)spine.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,THREE.MathUtils.degToRad(Math.sin(t*1.7)*1.1),THREE.MathUtils.degToRad(Math.sin(t*1.25)*.55),'YXZ')));
  const neck=mini.getObjectByName('Neck')||mini.getObjectByName('Neck1');
  if(neck)neck.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(Math.sin(t*1.9)*.35),0,0,'YXZ')));
  pinMiniSeatToPlayerTop();
}
async function enterMiniPausedSeat(){
  if(!miniOpen||miniCeremony||miniPausedSeat)return;
  const token=++miniSeatToken;
  miniPausedSeat=true;miniCeremony=true;miniPause=999;miniTurning=false;
  if(miniOverlay){miniOverlay.fadeOut(.10);miniOverlay=null;}
  miniBasePlay('relaxed',.14);miniPinFloor();
  await rotateMiniTo(0,360);
  if(token!==miniSeatToken||!miniOpen||!miniPausedSeat)return;
  try{await loadClip('pausedSit');}catch(e){console.warn('Paused sitting clip failed',e);}
  if(token!==miniSeatToken||!miniOpen||!miniPausedSeat)return;
  setMiniSeatStage(true);
  const clip=clips.get('pausedSit');
  if(clip){
    const action=miniMixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopOnce,1).play();
    action.time=Math.max(0,clip.duration*.96);action.paused=true;action.enabled=true;action.setEffectiveWeight(1);
    if(miniBase&&miniBase!==action)miniBase.crossFadeTo(action,.46,true);
    miniBase=action;miniSitAction=action;miniMixer.update(0);
  }
  await new Promise(r=>setTimeout(r,260));
  if(token!==miniSeatToken||!miniOpen||!miniPausedSeat)return;
  mini.rotation.y=0;captureMiniSeatBase();pinMiniSeatToPlayerTop();miniCeremony=false;
}
async function exitMiniPausedSeat(){
  if(!miniPausedSeat||!miniOpen)return;
  const token=++miniSeatToken;
  miniPausedSeat=false;miniCeremony=true;miniPause=999;miniTurning=false;miniSeatBase=null;
  if(miniSitAction){miniSitAction.paused=false;miniSitAction.fadeOut(.42);miniSitAction=null;}
  miniBasePlay('relaxed',.38);
  await new Promise(r=>setTimeout(r,280));
  if(token!==miniSeatToken||!miniOpen)return;
  setMiniSeatStage(false);miniPinFloor();
  await new Promise(r=>setTimeout(r,180));
  const walkYaw=miniDir>0?Math.PI/2:-Math.PI/2;
  await rotateMiniTo(walkYaw,340);
  if(token!==miniSeatToken||!miniOpen)return;
  miniBasePlay('walk',.10,.92);miniPause=0;miniTurning=false;miniCeremony=false;miniPinFloor();
}
function isPreviewAudio(el){return !!(el&&el.tagName==='AUDIO'&&el.closest&&el.closest('#previewPlayer'));}
async function openMini(){
  if(miniOpen)return;
  ++miniSeatToken;miniPausedSeat=false;miniSeatBase=null;setMiniSeatStage(false);
  if(miniSitAction){miniSitAction.stop();miniSitAction=null;}
  miniOpen=true;mini.visible=true;miniCeremony=true;
  miniDir=1;miniPause=999;miniTurning=false;
  mini.position.set(miniMinX,miniGroundedY,0);
  mini.rotation.y=Math.PI/2;
  miniBasePlay('relaxed',.03);miniPinFloor();
  await rotateMiniTo(0,380);
  bubble('HELLO! 👋');
  await miniOverlayOnce(clips.has('greeting')?'greeting':'wave',.76);
  if(!miniOpen)return;
  await new Promise(r=>setTimeout(r,180));bubble('',false);
  await rotateMiniTo(Math.PI/2,340);
  miniBasePlay('walk',.08,.92);miniPause=0;miniTurning=false;miniCeremony=false;miniPinFloor();
}
async function closeMini(){
  if(!miniOpen)return;
  ++miniSeatToken;miniPausedSeat=false;miniSeatBase=null;setMiniSeatStage(false);
  if(miniSitAction){miniSitAction.stop();miniSitAction=null;}
  miniCeremony=true;miniPause=999;miniTurning=false;
  miniBasePlay('relaxed',.07);
  if(miniOverlay){miniOverlay.fadeOut(.05);miniOverlay=null;}
  miniPinFloor();
  await rotateMiniTo(0,380);
  bubble('BYE! 👋');
  await miniOverlayOnce('wave',.80);
  await new Promise(r=>setTimeout(r,220));
  miniOpen=false;mini.visible=false;miniCeremony=false;bubble('',false);$('#noteLayer').innerHTML='';miniPause=0;
}
function updateMini(dt,now){
  if(!miniOpen||!mini)return;
  positionBubble();

  // Paused playback owns the Mini character: stationary seated pose + playful lower-leg swing.
  if(miniPausedSeat){updateMiniPausedSeat(now);return;}

  // HELLO/BYE/stand-up transition owns the character: no horizontal movement.
  if(miniCeremony){miniPinFloor();emitNote(now);return;}
  if(audio.getAttribute('src')&&audio.paused&&!miniPausedSeat){enterMiniPausedSeat();return;}

  const targetYaw=miniDir>0?Math.PI/2:-Math.PI/2;
  mini.rotation.y=dampAngle(mini.rotation.y,targetYaw,14,dt);
  if(miniPause>0){
    miniPause-=dt;
    if(miniPause<=0&&miniTurning){miniTurning=false;miniBasePlay('walk',.08,.92);}
    miniPinFloor();emitNote(now);return;
  }

  mini.position.x+=miniDir*.30*dt;
  const edge=miniDir>0?miniMaxX:miniMinX;
  if((miniDir>0&&mini.position.x>=edge)||(miniDir<0&&mini.position.x<=edge)){
    mini.position.x=edge;miniDir*=-1;miniPause=.48;miniTurning=true;miniBasePlay('relaxed',.06);
  }else applyMiniDanceWalk(now);
  miniPinFloor();emitNote(now);
}

async function openPreview(song){
  const mine=++previewTicket;audio.pause();audio.removeAttribute('src');audio.load();currentSong=song;panel.hidden=false;document.body.classList.add('has-preview');pTitle.textContent=song.title;pArtist.textContent=song.artist;pStatus.textContent='Finding a preview…';pFallback.hidden=true;pSource.hidden=true;pAttr.textContent='';pFallback.href='https://www.youtube.com/results?search_query='+encodeURIComponent(song.artist+' '+song.title+' official');
  resizeMini();openMini();setCore('listening');sayFrom('preview',2800);if(Math.random()<.7)overlayOnce('greeting',.42);
  let preview=null;try{if(sourceMode==='live'){const payload=await request('/preview',song);preview=payload?.preview;if(payload?.artwork)pAttr.textContent='Artwork / preview from current room';}}catch{}
  if(mine!==previewTicket)return;if(preview?.url){try{const u=new URL(preview.url);if(u.protocol!=='https:'||!/(^|\.)(dzcdn\.net|itunes\.apple\.com|mzstatic\.com)$/.test(u.hostname))throw Error('Invalid preview');audio.src=u.href;pStatus.textContent='Ready · press play for a 30-second preview';if(preview.source==='iTunes'&&/^https:\/\/(?:music|itunes)\.apple\.com\//.test(preview.link||'')){pSource.href=preview.link;pSource.textContent='Listen on iTunes ↗';pSource.hidden=false;pAttr.textContent='Preview provided courtesy of iTunes';}}catch{preview=null;}}
  if(!preview){pStatus.textContent='No preview available from the music providers.';pFallback.hidden=false;return;}
  try{await audio.play();}catch{pStatus.textContent+=' · press ▶';}
}
async function closePreview(){const closing=++previewTicket;previewPlaying=false;clearTimeout(autoDanceTimer);clearTimeout(autoReturnTimer);audio.pause();audio.removeAttribute('src');audio.load();panel.classList.remove('is-playing');if(zone!=='booth')returnBooth('relaxed');await closeMini();if(closing!==previewTicket)return;panel.hidden=true;document.body.classList.remove('has-preview');setCore('relaxed');currentSong=null;}
audio.addEventListener('timeupdate',()=>{if(audio.currentTime>=30){audio.pause();pStatus.textContent='Preview finished';}});
audio.addEventListener('error',()=>{if(audio.getAttribute('src')){pStatus.textContent='The preview could not play. Try again or use YouTube.';pFallback.hidden=false;}});
panel.querySelector('.player-close').addEventListener('click',closePreview);
document.addEventListener('click',e=>{const b=e.target.closest('[data-preview]');if(!b)return;openPreview({artist:b.dataset.artist,title:b.dataset.title});});
$('#heroPreview').addEventListener('click',()=>{const s=sharedSongs[0];if(s)openPreview(s);else toast('No shared songs loaded yet');});
audio.addEventListener('playing',()=>{previewPlaying=true;clearTimeout(autoDanceTimer);clearTimeout(autoReturnTimer);panel.classList.add('is-playing');pStatus.textContent='Playing preview · Munna is listening';setCore('dj');nextDJ=0;autoDanceTimer=setTimeout(()=>{if(previewPlaying&&zone==='booth'&&!locomotion){danceOut();autoReturnTimer=setTimeout(()=>{if(previewPlaying&&zone!=='booth')returnBooth('dj');},5200);}},8800);});
audio.addEventListener('pause',()=>{if(!audio.getAttribute('src'))return;previewPlaying=false;clearTimeout(autoDanceTimer);clearTimeout(autoReturnTimer);panel.classList.remove('is-playing');pStatus.textContent='Playback paused';if(zone!=='booth')returnBooth('listening');else setCore('listening');});
audio.addEventListener('ended',()=>{previewPlaying=false;clearTimeout(autoDanceTimer);clearTimeout(autoReturnTimer);panel.classList.remove('is-playing');pStatus.textContent='Preview finished';if(zone!=='booth')returnBooth('relaxed');else setCore('relaxed');});

// ---------- Audio-reactive room signal ----------

const vizCanvas=$('#roomViz'),vizCtx=vizCanvas?.getContext('2d');let vizPointer={x:.5,y:.5};
document.addEventListener('pointermove',e=>{vizPointer.x=clamp(e.clientX/Math.max(innerWidth,1),0,1);vizPointer.y=clamp(e.clientY/Math.max(innerHeight,1),0,1);},{passive:true});
function drawRoomViz(now){if(!vizCtx||!vizCanvas)return;const dpr=Math.min(devicePixelRatio,2),r=vizCanvas.getBoundingClientRect(),w=Math.max(1,Math.floor(r.width*dpr)),h=Math.max(1,Math.floor(r.height*dpr));if(vizCanvas.width!==w||vizCanvas.height!==h){vizCanvas.width=w;vizCanvas.height=h;}vizCtx.setTransform(dpr,0,0,dpr,0,0);vizCtx.clearRect(0,0,r.width,r.height);const cx=r.width*(.5+(vizPointer.x-.5)*.08),cy=r.height*(.48+(vizPointer.y-.5)*.05),base=Math.min(r.width,r.height)*.24,t=previewPlaying?audio.currentTime:now/1000*.22;const energy=previewPlaying?.40:.12;vizCtx.save();vizCtx.translate(cx,cy);for(let ring=0;ring<3;ring++){vizCtx.beginPath();const rr=base*(1+ring*.34)+Math.sin(t*1.4+ring)*3;vizCtx.strokeStyle=ring===0?'rgba(73,217,255,.58)':ring===1?'rgba(134,103,255,.32)':'rgba(255,115,88,.22)';vizCtx.lineWidth=1;vizCtx.arc(0,0,rr,0,Math.PI*2);vizCtx.stroke();}for(let i=0;i<48;i++){const a=(i/48)*Math.PI*2,noise=(Math.sin(t*2.8+i*.73)+Math.sin(t*1.7+i*.21))*0.5,len=10+(noise+1)*9*energy+((i%7===0)?10*energy:0),rr=base*1.33;vizCtx.strokeStyle=i%3===0?'#49d9ff':i%3===1?'#8667ff':'#ff7358';vizCtx.globalAlpha=.22+energy*.52;vizCtx.lineWidth=2;vizCtx.beginPath();vizCtx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);vizCtx.lineTo(Math.cos(a)*(rr+len),Math.sin(a)*(rr+len));vizCtx.stroke();}vizCtx.globalAlpha=1;const g=vizCtx.createRadialGradient(0,0,2,0,0,base*.68);g.addColorStop(0,previewPlaying?'rgba(200,255,90,.34)':'rgba(73,217,255,.20)');g.addColorStop(1,'rgba(10,12,18,0)');vizCtx.fillStyle=g;vizCtx.beginPath();vizCtx.arc(0,0,base*.72,0,Math.PI*2);vizCtx.fill();vizCtx.restore();}
function updateIdleBanter(now){if(now<nextIdleBanter||!avatar)return;nextIdleBanter=now+THREE.MathUtils.randFloat(16000,30000);if(!previewPlaying&&state==='relaxed'&&zone==='booth'){sayFrom('idle',3600);if(Math.random()<.42)overlayOnce(pick(['conversation','talkFunny','ask','secret']),.34);}}
function updatePerformanceAccent(now){
  if(!previewPlaying||state!=='dj'||zone!=='booth'||locomotion)return;
  if(!nextPerformanceAccent)nextPerformanceAccent=now+THREE.MathUtils.randFloat(7000,12000);
  if(now<nextPerformanceAccent||overlayAction||djReach)return;
  nextPerformanceAccent=now+THREE.MathUtils.randFloat(9000,15000);
  const pool=['fistPump','headbang','gestureForward','clap','happy'].filter(k=>clips.has(k));
  if(pool.length){overlayOnce(pick(pool),.26);if(Math.random()<.42)say(pick(["Okay, that drop earned it.","Tiny celebration. Back to work.","I felt that one in the crossfader."]),2200,'dj');}
}

async function init(){
  resizeMain();resizeMini();
  await loadAvatar();
  const core=['relaxed','look','listening','listeningUpper','walk','turnLeft','turnRight','wave','greeting','shrug','pokeBlock','danceA','danceB','danceC','danceD','danceStep','danceSnake','danceTwist','danceRunning','danceHouse3','danceSalsa'];
  await Promise.all(core.map(loadClip));

  // v27: stage Y is calibrated ONCE from Munna's original standing mesh.
  // Walking changes only X/Z. Root Y animation is stripped during retargeting, so no hopping or floating.
  mixer.stopAllAction();
  avatar.position.y=0;avatar.updateMatrixWorld(true);
  const restSole=currentSoleY(avatar,shoes);
  groundedRootY=Number.isFinite(restSole)?(-restSole+.004):0;
  avatar.position.y=groundedRootY;avatar.updateMatrixWorld(true);
  grounder.calibrate();
  danceGroundY.clear();

  await loadBooth();
  await loadProps();
  await loadMini();
  mini.position.y=miniGroundedY;mini.updateMatrixWorld(true);
  playBase('relaxed',.01);avatar.position.y=groundedRootY;setState('relaxed');
  say('Welcome. Hands off the expensive knobs. Mostly.',3600,'talk');
  setTimeout(()=>overlayOnce('greeting',.42),520);
  await loadShared();
  const warm=['happy','sarcastic','point','think','clap','laugh','button','reachDown','reachRummage','gestureForward','fistPump','headbang','danceStep','danceTwist'].filter(k=>!clips.has(k));
  const warmLoad=()=>Promise.allSettled(warm.map(loadClip));
  if('requestIdleCallback'in window)requestIdleCallback(warmLoad,{timeout:3200});else setTimeout(warmLoad,1400);
}
function tick(){
  requestAnimationFrame(tick);
  const dt=Math.min(clock.getDelta(),.05),now=performance.now();
  if(mixer)mixer.update(dt);if(miniMixer)miniMixer.update(dt);
  updateWalk(dt);
  updateCursorFollow(dt,now);
  updateFace(now);
  updateReactions(now);
  updateDJ(now);
  updatePerformanceAccent(now);
  updateIdleBanter(now);
  drawRoomViz(now);updateDecor(now);
  updateFollowers();updateCamera(dt);positionMainBubble();updateMini(dt,now);
  renderer.render(scene,camera);miniRenderer.render(miniScene,miniCamera);
}
function syncMunnaDockScrollMode(){
  const compact=window.innerWidth>900&&window.scrollY>280;
  document.body.classList.toggle('munna-scrolled',compact);
}
window.addEventListener('scroll',syncMunnaDockScrollMode,{passive:true});
window.addEventListener('resize',syncMunnaDockScrollMode);
syncMunnaDockScrollMode();


document.addEventListener('pause',e=>{
  const a=e.target;if(!isPreviewAudio(a)||a.seeking)return;
  setTimeout(()=>{if(miniOpen&&!miniCeremony&&a.paused)enterMiniPausedSeat();},0);
},true);
document.addEventListener('ended',e=>{
  const a=e.target;if(!isPreviewAudio(a))return;
  setTimeout(()=>{if(miniOpen&&!miniCeremony)enterMiniPausedSeat();},0);
},true);
document.addEventListener('play',e=>{
  const a=e.target;if(!isPreviewAudio(a))return;
  if(miniOpen&&miniPausedSeat)exitMiniPausedSeat();
},true);

init().catch(e=>{$('#munnaStateLabel').textContent='Character load failed';console.error(e);loadShared();});tick();
