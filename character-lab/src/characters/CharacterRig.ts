import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CharacterState='idle'|'listen'|'dj'|'react-like'|'react-dislike'|'react-user'|'run'|'jump'|'land'|'hide'|'peek'|'walk-listening';

export interface RigConfig{
  url:string;
  rootName?:string;
  eyeLeft?:string;
  eyeRight?:string;
  earbudLeft?:string;
  earbudRight?:string;
}

export class CharacterRig{
  readonly root=new THREE.Group();
  private mixer?:THREE.AnimationMixer;
  private actions=new Map<string,THREE.AnimationAction>();
  private active?:THREE.AnimationAction;
  private leftEye?:THREE.Object3D;
  private rightEye?:THREE.Object3D;
  private leftEarbud?:THREE.Object3D;
  private rightEarbud?:THREE.Object3D;
  private readonly gazeTarget=new THREE.Vector3();
  private readonly loader=new GLTFLoader();

  constructor(private config:RigConfig){}

  async load(){
    const gltf=await this.loader.loadAsync(this.config.url);
    this.root.add(gltf.scene);
    this.mixer=new THREE.AnimationMixer(gltf.scene);
    for(const clip of gltf.animations)this.actions.set(clip.name,this.mixer.clipAction(clip));
    this.leftEye=this.find(this.config.eyeLeft);
    this.rightEye=this.find(this.config.eyeRight);
    this.leftEarbud=this.find(this.config.earbudLeft);
    this.rightEarbud=this.find(this.config.earbudRight);
    return this;
  }

  private find(name?:string){return name?this.root.getObjectByName(name):undefined;}

  play(name:string,fade=.35){
    const next=this.actions.get(name);
    if(!next||next===this.active)return;
    next.reset().play();
    if(this.active)this.active.crossFadeTo(next,fade,false);
    this.active=next;
  }

  setTimeScale(value:number){if(this.active)this.active.timeScale=value;}

  lookAt(target:THREE.Vector3,dt:number){
    this.gazeTarget.lerp(target,1-Math.exp(-dt*10));
    for(const eye of [this.leftEye,this.rightEye]){
      if(!eye)continue;
      const local=eye.parent?.worldToLocal(this.gazeTarget.clone())??this.gazeTarget;
      eye.lookAt(local);
    }
  }

  getEarbudWorldPositions(){
    const left=new THREE.Vector3(),right=new THREE.Vector3();
    this.leftEarbud?.getWorldPosition(left);
    this.rightEarbud?.getWorldPosition(right);
    return {left,right};
  }

  update(dt:number){this.mixer?.update(dt);}
}
