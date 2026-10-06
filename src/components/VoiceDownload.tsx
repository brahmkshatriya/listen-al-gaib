import { useEffect, useState } from 'react';
import { Check, Download, Play } from 'lucide-react';
import { getSpeechDownloads } from '../core/storage';

export default function VoiceDownload({voice,onStart}:{voice:{id:string;name:string};onStart:()=>void}) {
  const [saved,setSaved]=useState<Awaited<ReturnType<typeof getSpeechDownloads>>>();
  useEffect(()=>{
    let active=true;setSaved(undefined);
    const refresh=()=>{void getSpeechDownloads(voice.id).then(result=>{if(active)setSaved(result);}).catch(()=>{});};
    refresh();window.addEventListener('focus',refresh);
    return()=>{active=false;window.removeEventListener('focus',refresh);};
  },[voice.id]);
  const common=(saved?.voice?0:0.5)+(saved?.runtime?0:22);
  const estimate=(model:number)=>common+model<=1?common+model:Math.ceil((common+model)/10)*10;
  const remaining=estimate(saved?.standard?0:92.4);
  const ready=saved?.voice&&saved?.runtime&&saved.standard;
  const status=(downloaded:boolean|undefined,size:string)=><dd>{downloaded?<span className="download-saved"><Check size={16} aria-hidden="true"/>Downloaded</span>:size}</dd>;
  return <>
    <dl className="download-details">
      <div><dt>Voice model · WASM</dt>{status(saved?.standard,'92 MB')}</div>
      <div><dt>{voice.name} · English voice</dt>{status(saved?.voice,'~0.5 MB')}</div>
      <div><dt>Speech runtime</dt>{status(saved?.runtime,'Up to 22 MB')}</div>
    </dl>
    <div className="download-total"><strong>{saved?'Remaining download':'Estimated download'}</strong><span>{saved?`${remaining===0?'0':`~${remaining}`} MB`:'Checking saved files…'}</span></div>
    <button className="primary-button full-width" onClick={onStart}>{ready?<Play size={18}/>:<Download size={18}/>} {ready?'Listen':'Download & listen'}</button>
  </>;
}
