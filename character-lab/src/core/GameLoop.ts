export type FrameStage='input'|'behavior'|'physics'|'animation'|'audio'|'camera'|'render';
export type FrameCallback=(dt:number,elapsed:number)=>void;

export class GameLoop{
  private callbacks=new Map<FrameStage,Set<FrameCallback>>();
  private raf=0;
  private last=performance.now();
  private elapsed=0;
  private readonly order:FrameStage[]=['input','behavior','physics','animation','audio','camera','render'];

  constructor(){for(const stage of this.order)this.callbacks.set(stage,new Set());}

  on(stage:FrameStage,callback:FrameCallback){
    this.callbacks.get(stage)!.add(callback);
    return()=>this.callbacks.get(stage)!.delete(callback);
  }

  start(){
    if(this.raf)return;
    this.last=performance.now();
    const tick=(now:number)=>{
      const dt=Math.min((now-this.last)/1000,1/20);
      this.last=now;
      this.elapsed+=dt;
      for(const stage of this.order)for(const callback of this.callbacks.get(stage)!)callback(dt,this.elapsed);
      this.raf=requestAnimationFrame(tick);
    };
    this.raf=requestAnimationFrame(tick);
  }

  stop(){if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;}
}
