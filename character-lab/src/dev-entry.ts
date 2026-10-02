import './dev.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const overlay = document.createElement('div');
overlay.className = 'mg-dev-overlay';
overlay.innerHTML = '<canvas class="mg-dev-canvas" aria-hidden="true"></canvas><div class="mg-dev-badge">Character engine · feature branch only</div>';
document.body.append(overlay);

const canvas = overlay.querySelector<HTMLCanvasElement>('.mg-dev-canvas')!;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 1.3, 7);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.8));
const key = new THREE.DirectionalLight(0xffe5d0, 2.2); key.position.set(3, 6, 5); scene.add(key);
const rim = new THREE.DirectionalLight(0x66ddff, 1.3); rim.position.set(-4, 3, -2); scene.add(rim);

let munna: THREE.Object3D | null = null;
let mixer: THREE.AnimationMixer | null = null;
let actions = new Map<string, THREE.AnimationAction>();
let currentAction: THREE.AnimationAction | null = null;
let leftEye: THREE.Object3D | null = null;
let rightEye: THREE.Object3D | null = null;
let previewState: 'idle'|'playing'|'paused' = 'idle';
let pointerX = 0, pointerY = 0;
const clock = new THREE.Clock();

function resize(){
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w,h,false);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}
addEventListener('resize',resize); resize();
addEventListener('pointermove',e=>{
  pointerX = (e.clientX / innerWidth) * 2 - 1;
  pointerY = -(e.clientY / innerHeight) * 2 + 1;
});

function findAny(root: THREE.Object3D, names: string[]){
  let found: THREE.Object3D|null = null;
  root.traverse(o=>{ if(!found && names.some(n=>o.name.toLowerCase().includes(n))) found=o; });
  return found;
}
function play(names:string[], fade=.45){
  if(!mixer) return;
  const entry=[...actions.entries()].find(([n])=>names.some(x=>n.toLowerCase().includes(x.toLowerCase())));
  if(!entry) return;
  const next=entry[1];
  if(next===currentAction) return;
  next.reset().fadeIn(fade).play();
  currentAction?.fadeOut(fade);
  currentAction=next;
}

new GLTFLoader().load('/character-lab/public/models/munna.glb', gltf=>{
  munna=gltf.scene;
  munna.position.set(0,-1.45,0);
  munna.scale.setScalar(1.35);
  scene.add(munna);
  mixer=new THREE.AnimationMixer(munna);
  for(const clip of gltf.animations) actions.set(clip.name,mixer.clipAction(clip));
  leftEye=findAny(munna,['eye_l','eye.left','lefteye','eyeleft']);
  rightEye=findAny(munna,['eye_r','eye.right','righteye','eyeright']);
  play(['DJ_Idle','Idle']);
}, undefined, ()=>{
  // Intentionally silent: the original website remains fully usable until a real rig is ready.
});

function bindPreviewPlayer(){
  const audio = document.querySelector<HTMLAudioElement>('.preview-player audio');
  if(!audio) return false;
  audio.addEventListener('playing',()=>{ previewState='playing'; play(['DJ_Listening','Listen','Idle']); });
  audio.addEventListener('pause',()=>{ if(!audio.ended){previewState='paused'; play(['DJ_Idle','Idle']);} });
  audio.addEventListener('ended',()=>{ previewState='idle'; play(['DJ_Idle','Idle']); });
  return true;
}
let tries=0;
const bindTimer=setInterval(()=>{ if(bindPreviewPlayer() || ++tries>80) clearInterval(bindTimer); },250);

document.addEventListener('click',e=>{
  const target=e.target as HTMLElement;
  if(target.closest('[data-shared-rating="replay"], [data-rating="replay"]')) play(['React_Like','Happy','Smile']);
  if(target.closest('[data-shared-rating="skip"], [data-rating="skip"]')) play(['React_Dislike','Wince','Skeptic']);
  if(target.closest('[data-preview]')) play(['DJ_Cue','Cue','Listen']);
});

function frame(){
  requestAnimationFrame(frame);
  const dt=Math.min(clock.getDelta(),.05);
  mixer?.update(dt);
  if(leftEye&&rightEye){
    const yaw=THREE.MathUtils.clamp(pointerX*.16,-.16,.16);
    const pitch=THREE.MathUtils.clamp(pointerY*.11,-.11,.11);
    for(const eye of [leftEye,rightEye]){
      eye.rotation.y += (yaw-eye.rotation.y)*.12;
      eye.rotation.x += (pitch-eye.rotation.x)*.12;
    }
  }
  if(munna){
    const targetX = previewState==='playing' ? .03 : 0;
    munna.rotation.z += (targetX-munna.rotation.z)*.04;
  }
  renderer.render(scene,camera);
}
frame();
