export type PreviewStatus='idle'|'playing'|'paused'|'buffering'|'ended';

export interface PreviewSnapshot{
  status:PreviewStatus;
  currentTime:number;
  duration:number;
}

export class PreviewState extends EventTarget{
  private snapshot:PreviewSnapshot={status:'idle',currentTime:0,duration:30};

  get value(){return {...this.snapshot};}

  set(next:Partial<PreviewSnapshot>){
    this.snapshot={...this.snapshot,...next};
    this.dispatchEvent(new CustomEvent<PreviewSnapshot>('change',{detail:this.value}));
  }

  reset(){this.set({status:'idle',currentTime:0,duration:30});}
}
