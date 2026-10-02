import './styles.css';
import * as THREE from 'three';
import {GameLoop} from './core/GameLoop';
import {PreviewState} from './runtime/PreviewState';
import {CharacterRig} from './characters/CharacterRig';

const canvas=document.querySelector<HTMLCanvasElement>('#experience')!;
const status=document.querySelector<HTMLElement>('#runtime-status')!;
const previewTime=document.querySelector<HTMLElement>('#preview-time')!;
const previewLabel=document.querySelector<HTMLElement>('#preview-state')!;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x090d10);
scene.fog=new THREE.FogExp2(0x090d10,.035);

const camera=new THREE.PerspectiveCamera(42,1,.1,100);
camera.position.set(0,2.3,7.4);

const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.15;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;

scene.add(new THREE.HemisphereLight(0xb8d8ff,0x101512,1.5));
const key=new THREE.DirectionalLight(0xffd7c9,4.5);key.position.set(-3,6,4);key.castShadow=true;scene.add(key);
const rim=new THREE.PointLight(0xff4f9a,45,12,2);rim.position.set(3,2,1);scene.add(rim);
const cyan=new THREE.PointLight(0x4edaff,35,10,2);cyan.position.set(-3,1,2);scene.add(cyan);

const floor=new THREE.Mesh(new THREE.PlaneGeometry(14,10),new THREE.MeshStandardMaterial({color:0x101619,roughness:.82,metalness:.04}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.02;floor.receiveShadow=true;scene.add(floor);

const djPlatform=new THREE.Mesh(new THREE.BoxGeometry(4.8,.18,2.1),new THREE.MeshStandardMaterial({color:0x151d20,roughness:.45,metalness:.22}));
djPlatform.position.set(0,.1,0);djPlatform.receiveShadow=true;scene.add(djPlatform);

const preview=new PreviewState();
const loop=new GameLoop();
let previewTimer=0;

const munna=new CharacterRig({
  url:'/models/munna.glb',
  eyeLeft:'Eye_L',eyeRight:'Eye_R',
  earbudLeft:'Earbud_L',earbudRight:'Earbud_R'
});
munna.root.position.set(0,.2,.15);scene.add(munna.root);

const resize=()=>{
  const rect=canvas.getBoundingClientRect();
  const dpr=Math.min(devicePixelRatio,2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(rect.width,rect.height,false);
  camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();
};
new ResizeObserver(resize).observe(canvas);resize();

const pointer=new THREE.Vector2();
const gazeWorld=new THREE.Vector3();
canvas.addEventListener('pointermove',event=>{
  const r=canvas.getBoundingClientRect();
  pointer.x=((event.clientX-r.left)/r.width)*2-1;
  pointer.y=-((event.clientY-r.top)/r.height)*2+1;
  gazeWorld.set(pointer.x*1.9,2.1+pointer.y*.9,3.2);
});

const setPreview=(statusValue:'playing'|'paused'|'ended'|'idle')=>preview.set({status:statusValue});
document.querySelector('#play')?.addEventListener('click',()=>setPreview('playing'));
document.querySelector('#pause')?.addEventListener('click',()=>setPreview('paused'));
document.querySelector('#skip')?.addEventListener('click',()=>{preview.set({status:'ended',currentTime:30});});
document.querySelector('#like')?.addEventListener('click',()=>munna.play('React_Like'));
document.querySelector('#dislike')?.addEventListener('click',()=>munna.play('React_Dislike'));
document.querySelector('#runner-pass')?.addEventListener('click',()=>munna.play('React_Runner'));
canvas.addEventListener('click',()=>munna.play('React_User'));

preview.addEventListener('change',(event)=>{
  const value=(event as CustomEvent).detail;
  previewLabel.textContent=value.status[0].toUpperCase()+value.status.slice(1);
  if(value.status==='playing')munna.play('DJ_Listening');
  else if(value.status==='paused')munna.play('DJ_Idle');
  else if(value.status==='ended')munna.play('React_Complete');
});

loop.on('input',(dt)=>munna.lookAt(gazeWorld,dt));
loop.on('animation',(dt)=>munna.update(dt));
loop.on('audio',(dt)=>{
  const state=preview.value;
  if(state.status==='playing'){
    previewTimer=Math.min(30,previewTimer+dt);
    preview.set({currentTime:previewTimer});
    if(previewTimer>=30)preview.set({status:'ended'});
  }
  previewTime.textContent=`${previewTimer.toFixed(1)} / 30.0 sec`;
});
loop.on('camera',(_dt,elapsed)=>{
  camera.position.y=2.3+Math.sin(elapsed*.25)*.025;
  camera.lookAt(0,1.15,0);
});
loop.on('render',()=>renderer.render(scene,camera));

try{
  await munna.load();
  munna.play('DJ_Idle',0);
  status.textContent='3D runtime ready · real GLB rig loaded';
}catch(error){
  console.error(error);
  status.textContent='Character asset missing · add /models/munna.glb before visual review';
}

loop.start();
