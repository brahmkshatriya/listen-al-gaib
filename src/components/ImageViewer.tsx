import { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw, RotateCcw, Maximize, Move, ChevronLeft, ChevronRight, Scan, Undo2 } from 'lucide-react';
import type { ReadingBlock } from '../core/types';
export default function ImageViewer({images,index,onChange,onClose}:{images:ReadingBlock[];index:number;onChange:(index:number)=>void;onClose:()=>void}){
  const [zoom,setZoom]=useState(1);const [rotation,setRotation]=useState(0);const [pan,setPan]=useState({x:0,y:0});
  const stage=useRef<HTMLDivElement>(null);const imageRef=useRef<HTMLImageElement>(null);const closeRef=useRef<HTMLButtonElement>(null);
  const pointers=useRef(new Map<number,{x:number;y:number}>());const gesture=useRef({distance:0,zoom:1});
  const image=images[index];
  const reset=()=>{setZoom(1);setRotation(0);setPan({x:0,y:0});};
  useEffect(()=>{reset();},[index]);
  useEffect(()=>{
    const focused=document.activeElement as HTMLElement;closeRef.current?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();if(event.key==='ArrowLeft'){event.preventDefault();onChange(Math.max(0,index-1));}if(event.key==='ArrowRight'){event.preventDefault();onChange(Math.min(images.length-1,index+1));}
      if(event.key==='Tab'){const focusable=Array.from(stage.current?.parentElement?.querySelectorAll<HTMLElement>('button:not(:disabled)')||[]);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    };
    window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);focused?.focus({preventScroll:true});};
  },[index,onClose,onChange,images.length]);
  function fitToScreen(){
    const container=stage.current;const rendered=imageRef.current;
    if(container&&rendered&&rendered.clientWidth&&rendered.clientHeight){
      const style=getComputedStyle(container);
      const availableWidth=container.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
      const availableHeight=container.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
      const turned=Math.abs(rotation%180)===90;
      setZoom(Math.min(1,availableWidth/(turned?rendered.clientHeight:rendered.clientWidth),availableHeight/(turned?rendered.clientWidth:rendered.clientHeight)));
    }else setZoom(1);
    setPan({x:0,y:0});
  }
  function actualSize(){const el=imageRef.current;if(el){setZoom(el.naturalWidth/el.clientWidth);setPan({x:0,y:0});}}
  return <div className="viewer" role="dialog" aria-modal="true" aria-label="Illustration viewer">
    <div className="viewer-bar"><div><strong>{image.caption||(!/^image$/i.test(image.alt||'')&&image.alt)||`Illustration ${index+1}`}</strong><span>{index+1} / {images.length}</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close image viewer"><X size={22}/></button></div>
    <div className="viewer-stage" ref={stage}
      onWheel={e=>{setZoom(z=>Math.max(0.2,Math.min(12,z*(e.deltaY>0?0.9:1.1))));}}
      onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.current.size===2){const [a,b]=[...pointers.current.values()];gesture.current={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom};}}}
      onPointerMove={e=>{const previous=pointers.current.get(e.pointerId);if(!previous)return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.current.size===2){const[a,b]=[...pointers.current.values()];setZoom(Math.max(0.2,Math.min(12,gesture.current.zoom*Math.hypot(a.x-b.x,a.y-b.y)/gesture.current.distance)));}else setPan(p=>({x:p.x+e.clientX-previous.x,y:p.y+e.clientY-previous.y}));}}
      onPointerUp={e=>pointers.current.delete(e.pointerId)} onPointerCancel={e=>pointers.current.delete(e.pointerId)}>
      <img ref={imageRef} src={image.src} alt={image.caption||image.alt||'Illustration'} draggable={false} style={{transform:`translate(${pan.x}px,${pan.y}px) rotate(${rotation}deg) scale(${zoom})`}}/>
    </div>
    <div className="viewer-controls">
      <button className="icon-button" disabled={index===0} onClick={()=>onChange(index-1)} aria-label="Previous illustration"><ChevronLeft size={20}/></button>
      <button onClick={fitToScreen}><Maximize size={18}/><span>Fit</span></button>
      <button onClick={actualSize}><Scan size={18}/><span>100%</span></button>
      <button className="icon-button" onClick={()=>setZoom(z=>Math.max(0.2,z/1.2))} aria-label="Zoom out"><ZoomOut size={20}/></button><span className="zoom-value">{Math.round(zoom*100)}%</span><button className="icon-button" onClick={()=>setZoom(z=>Math.min(12,z*1.2))} aria-label="Zoom in"><ZoomIn size={20}/></button>
      <button className="icon-button" onClick={()=>setRotation(r=>r-90)} aria-label="Rotate counterclockwise"><RotateCcw size={20}/></button><button className="icon-button" onClick={()=>setRotation(r=>r+90)} aria-label="Rotate clockwise"><RotateCw size={20}/></button>
      <button className="icon-button" onClick={reset} aria-label="Reset image"><Undo2 size={20}/></button>
      <button className="icon-button" disabled={index===images.length-1} onClick={()=>onChange(index+1)} aria-label="Next illustration"><ChevronRight size={20}/></button>
    </div><p className="viewer-hint"><Move size={14}/> Drag to pan · Scroll or pinch to zoom</p>
  </div>;
}
