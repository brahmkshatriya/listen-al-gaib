/// <reference lib="webworker" />
import { modelCache } from '../core/storage';
import type { KokoroTTS as KokoroType } from 'kokoro-js';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: KokoroType | undefined;
let loading: Promise<string> | undefined;
let epoch = 0;
let running = false;
const originalFetch=scope.fetch.bind(scope);
// Cache voice files as well as weights in IndexedDB, including Kokoro's direct voice fetches.
scope.fetch=async (input:RequestInfo|URL, init?:RequestInit) => {
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const parsed=new URL(url,scope.location.href);
  const speechRuntime=/\/ort-wasm[^/]*\.wasm$/.test(parsed.pathname)&&(parsed.origin===scope.location.origin||parsed.hostname==='cdn.jsdelivr.net');
  if((parsed.hostname==='huggingface.co'||speechRuntime)&&(!init?.method||init.method==='GET')) {
    const requestEpoch=epoch;
    const file=decodeURIComponent(parsed.pathname.split('/').pop()||'Voice files');
    const savedVoice=/\/voices\/[^/]+\.bin$/.test(parsed.pathname)&&typeof caches!=='undefined'
      ? await caches.open('kokoro-voices').then(cache=>cache.match(url)).catch(()=>undefined) : undefined;
    const cached=await modelCache.match(url).catch(()=>undefined)||savedVoice;
    if(cached){scope.postMessage({type:'asset',file,cached:true,complete:true,epoch:requestEpoch});return cached;}
    scope.postMessage({type:'asset',file,cached:false,complete:false,epoch:requestEpoch});
    const response=await originalFetch(input,init);
    if(response.ok)await modelCache.put(url,response.clone()).catch(()=>{});
    if(response.ok)scope.postMessage({type:'asset',file,cached:false,complete:true,epoch:requestEpoch});
    return response;
  }
  return originalFetch(input,init);
};
type Job = { id:number; epoch:number; text:string; voice:string };
const jobs: Job[] = [];
async function initialize() {
  const { env } = await import('@huggingface/transformers');
  env.useBrowserCache = false; env.useCustomCache = true; env.customCache = modelCache as unknown as Cache;
  if(env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = scope.crossOriginIsolated ? Math.min(4,Math.ceil((navigator.hardwareConcurrency||2)/2)) : 1;
  const { KokoroTTS } = await import('kokoro-js');
  const progress_callback = (data: {status:string;progress?:number;file?:string}) => scope.postMessage({type:'progress',...data});
  engine=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{device:'wasm',dtype:'q8',progress_callback});
  return 'WASM';
}
async function drain() {
  if(running)return;running=true;
  try {
    while(jobs.length) {
      const job=jobs.shift()!;if(job.epoch!==epoch)continue;
      try {
        loading??=initialize().catch(error=>{loading=undefined;throw error;});
        await loading;
        if(job.epoch!==epoch)continue;
        scope.postMessage({type:'generating',epoch:job.epoch,text:job.text});
        const audio=await engine!.generate(job.text,{voice:job.voice as 'af_heart'});
        if(job.epoch!==epoch)continue;
        // One short source segment per inference; transfer its buffer without concatenation or a full extra copy.
        const samples=audio.audio.buffer instanceof ArrayBuffer ? audio.audio : new Float32Array(audio.audio);
        scope.postMessage({type:'audio',id:job.id,epoch:job.epoch,data:samples,sampleRate:audio.sampling_rate},[samples.buffer]);
      }catch(error){scope.postMessage({type:'error',id:job.id,epoch:job.epoch,message:error instanceof Error?error.message:'Local speech failed.'});}
    }
  }finally{running=false;}
}
scope.onmessage=({data})=>{
  if(data.type==='cancel'){epoch=data.epoch;jobs.length=0;}
  else if(data.type==='load') {
    const requestEpoch=data.epoch??epoch;const voice=data.voice||'af_heart';
    loading??=initialize().catch(error=>{loading=undefined;throw error;});
    void loading.then(async device=>{
      if(requestEpoch!==epoch)return;
      const response=await scope.fetch(`https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voice}.bin`);
      if(!response.ok)throw new Error(`The selected voice could not download (${response.status}). Try again.`);
      await response.arrayBuffer();
      if(requestEpoch===epoch)scope.postMessage({type:'ready',device,voice,epoch:requestEpoch});
    }).catch(error=>{if(requestEpoch===epoch)scope.postMessage({type:'error',epoch:requestEpoch,message:error.message});});
  }
  else if(data.type==='synthesize'){jobs.push(data);void drain();}
};
