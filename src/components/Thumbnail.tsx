import { useEffect, useRef, useState } from 'react';
export default function Thumbnail({src,alt}:{src?:string;alt:string}){
  const [thumbnail,setThumbnail]=useState<string>();const element=useRef<HTMLImageElement>(null);
  useEffect(()=>{
    if(!src)return;let active=true;let url:string|undefined;
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();
      void(async()=>{
        try{
          const response=await fetch(src);const blob=await response.blob();
          const bitmap=await createImageBitmap(blob);const ratio=Math.min(1,240/bitmap.width,240/bitmap.height);
          const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
          const ctx=canvas.getContext('2d');ctx?.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
          const small=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',0.8));
          if(active&&small){url=URL.createObjectURL(small);setThumbnail(url);}
          else if(active)setThumbnail(src);
        }catch{if(active)setThumbnail(src);}
      })();
    },{rootMargin:'160px'});
    if(element.current)observer.observe(element.current);
    return()=>{active=false;observer.disconnect();if(url)URL.revokeObjectURL(url);};
  },[src]);
  return <img ref={element} src={thumbnail} alt={alt} loading="lazy" decoding="async"/>;
}
