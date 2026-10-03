import type { VoiceMode } from '../core/types';
export interface TtsAudio { data:Float32Array; sampleRate:number }
export interface TtsEngine { readonly status?:EngineStatus; setMode?(mode:VoiceMode):void; loadVoice(voiceId:string,mode?:VoiceMode):Promise<void>; synthesize(text:string):Promise<TtsAudio>; cancel():void; dispose():Promise<void> }
export interface EngineStatus { state:'idle'|'loading'|'ready'|'error'; progress?:number; device?:string; message?:string; file?:string; generating?:string; asset?:{file:string;cached:boolean;complete:boolean} }
export class LocalTtsEngine implements TtsEngine {
  private worker?:Worker; private voice='af_heart'; private epoch=0; private id=0;
  private mode:VoiceMode='standard';
  private loadedVoice?:string;
  private loadingVoice?:string;
  private pending=new Map<number,{resolve:(audio:TtsAudio)=>void;reject:(error:Error)=>void}>();
  private waiters:Array<{resolve:()=>void;reject:(error:Error)=>void}>=[];
  status:EngineStatus={state:'idle'};
  constructor(private onStatus:(status:EngineStatus)=>void){}
  private setStatus(status:EngineStatus){this.status=status;this.onStatus(status);}
  private ensureWorker(){
    if(this.worker)return;
    this.worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
    const worker=this.worker;
    this.worker.onmessage=({data})=>{
      if(this.worker!==worker)return;
      if(data.type==='progress')this.setStatus({...this.status,state:'loading',progress:data.progress,file:data.file,message:data.status==='progress'?'Downloading voice model…':'Loading voice model…'});
      else if(data.type==='asset'&&(data.epoch===undefined||data.epoch===this.epoch))this.setStatus({...this.status,asset:{file:data.file,cached:data.cached,complete:data.complete}});
      else if(data.type==='generating'&&data.epoch===this.epoch)this.setStatus({...this.status,generating:data.text});
      else if(data.type==='fallback')this.setStatus({state:'loading',message:data.message});
      else if(data.type==='ready'&&(data.epoch===undefined||data.epoch===this.epoch)&&(!data.voice||data.voice===this.voice)){this.loadedVoice=this.voice;this.loadingVoice=undefined;this.setStatus({state:'ready',device:data.device,asset:this.status.asset});this.waiters.splice(0).forEach(w=>w.resolve());}
      else if(data.type==='audio'&&data.epoch===this.epoch){this.pending.get(data.id)?.resolve({data:data.data,sampleRate:data.sampleRate});this.pending.delete(data.id);this.setStatus({...this.status,generating:undefined});}
      else if(data.type==='error'){
        const error=new Error(data.message);
        if(data.id){this.pending.get(data.id)?.reject(error);this.pending.delete(data.id);}
        else if(data.epoch===undefined||data.epoch===this.epoch){this.setStatus({state:'error',message:data.message});this.waiters.splice(0).forEach(w=>w.reject(error));}
      }
    };
    this.worker.onerror=(event)=>{if(this.worker!==worker)return;const error=new Error(event.message||'The speech worker could not start.');this.setStatus({state:'error',message:error.message});this.pending.forEach(p=>p.reject(error));this.pending.clear();this.waiters.splice(0).forEach(w=>w.reject(error));this.worker?.terminate();this.worker=undefined;};
    this.worker.postMessage({type:'cancel',epoch:this.epoch});
  }
  setMode(mode:VoiceMode){
    if(mode===this.mode)return;
    this.mode=mode;this.cancel();this.worker?.terminate();this.worker=undefined;this.loadedVoice=undefined;
    this.waiters.splice(0).forEach(w=>w.reject(new DOMException('Voice mode changed','AbortError')));
    this.setStatus({state:'idle'});
  }
  async loadVoice(voiceId:string,mode:VoiceMode=this.mode){
    this.setMode(mode);
    this.voice=voiceId;this.ensureWorker();
    if(this.status.state==='ready'&&this.loadedVoice===voiceId)return;
    if(this.status.state==='loading'&&this.loadingVoice===voiceId)return new Promise<void>((resolve,reject)=>this.waiters.push({resolve,reject}));
    this.loadingVoice=voiceId;
    this.setStatus({state:'loading',message:'Preparing local neural voice…'});
    return new Promise<void>((resolve,reject)=>{this.waiters.push({resolve,reject});this.worker!.postMessage({type:'load',mode:this.mode,voice:voiceId,epoch:this.epoch});});
  }
  synthesize(text:string):Promise<TtsAudio>{this.ensureWorker();const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker!.postMessage({type:'synthesize',id,epoch:this.epoch,text,voice:this.voice});});}
  cancel(){this.epoch++;this.loadingVoice=undefined;this.worker?.postMessage({type:'cancel',epoch:this.epoch});this.pending.forEach(p=>p.reject(new DOMException('Cancelled','AbortError')));this.pending.clear();this.waiters.splice(0).forEach(w=>w.reject(new DOMException('Cancelled','AbortError')));if(this.status.generating)this.setStatus({...this.status,generating:undefined});}
  async dispose(){this.cancel();this.worker?.terminate();this.waiters.splice(0).forEach(w=>w.reject(new DOMException('Disposed','AbortError')));this.worker=undefined;}
}
