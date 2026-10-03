import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Headphones, BookOpen, Library, Upload, List, Images, Search, Type, Sun, Moon, Monitor, ChevronLeft, ChevronRight, Play, Pause, SkipBack, SkipForward, RotateCcw, X, Check, Volume2, PanelLeftClose, PanelLeftOpen, LoaderCircle, FileText, Info, Maximize2, Settings2, Keyboard, AlertCircle } from 'lucide-react';
import { parseEpub, closeBook } from './core/epub';
import { currentChapter, DEFAULT_SETTINGS, locationAt, resolveLocation } from './core/types';
import type { Book, ReaderLocation, ReadingBlock, Settings } from './core/types';
import { getBooks, saveBook, deleteBook, getProgress, saveProgress, getLastBook, saveLastBook, getSpeechDownloads } from './core/storage';
import type { LibraryBook } from './core/storage';
import { PlaybackController } from './tts/playback';
import type { PlaybackState, VoiceActivity as VoiceActivityDetails } from './tts/playback';
import type { EngineStatus } from './tts/engine';
import { supportsWebGpu } from './tts/capabilities';
import ImageViewer from './components/ImageViewer';
import Thumbnail from './components/Thumbnail';
import LibraryContent from './components/LibraryContent';
import VoiceDownload from './components/VoiceDownload';
import VoiceSettings from './components/VoiceSettings';
import VoiceActivity from './components/VoiceActivity';
import SpeedControl from './components/SpeedControl';
import { useAppRoute } from './core/routing';
const VOICES=[{id:'af_heart',name:'Heart',detail:'American · Warm'},{id:'af_bella',name:'Bella',detail:'American · Soft'},{id:'af_nicole',name:'Nicole',detail:'American · Calm'},{id:'am_michael',name:'Michael',detail:'American · Clear'},{id:'bf_emma',name:'Emma',detail:'British · Gentle'},{id:'bm_george',name:'George',detail:'British · Rich'}];
const FAMILY={serif:'Georgia, "Times New Roman", serif',sans:'Inter, Arial, sans-serif',mono:'"Courier New", monospace'};
function IconButton({label,children,onClick,active=false}:{label:string;children:React.ReactNode;onClick:()=>void;active?:boolean}){return <button className={`icon-button ${active?'active':''}`} onClick={onClick} aria-label={label} title={label}>{children}</button>;}
const ReadBlock = memo(function ReadBlock({block,active,playing,onImage,onSelect}:{block:ReadingBlock;active:boolean;playing:boolean;onImage:()=>void;onSelect:()=>void}){
  const common={id:block.id,'data-block-id':block.id,className:`reading-block ${block.kind} ${active?'current':''} ${active&&playing?'spoken':''}`,onClick:onSelect};
  if(block.kind==='image')return <figure {...common} className={`${common.className} reader-image-page`}>
    {block.src?<button className="image-open" onClick={e=>{e.stopPropagation();onImage();}} aria-label={`Open ${block.caption||block.alt||'illustration'}`}><img src={block.src} alt={block.alt||'Illustration'} loading="lazy" decoding="async"/><span className="image-expand"><Maximize2 size={16}/> View illustration</span></button>:<div className="broken-image"><AlertCircle size={24}/><span>This illustration is missing from the EPUB.</span></div>}
    {block.caption&&<figcaption>{block.caption}</figcaption>}
  </figure>;
  if(block.kind==='separator')return <div {...common} className={`${common.className} scene-break`} aria-hidden="true">{block.semanticValue==='scene-break'?'·  ·  ·':block.semanticValue==='emdash'?'—':''}</div>;
  if(block.kind==='heading'){
    const Tag=(`h${Math.min(4,Math.max(2,block.level||2))}`) as 'h2';
    const text=block.text.replace(/^CHAPTER\s+[\dIVXLCDM]+\.?\s*/i,'');
    return <Tag {...common}>{text}</Tag>;
  }
  if(block.kind==='quote')return <blockquote {...common} dangerouslySetInnerHTML={{__html:block.html}}/>;
  return <p {...common} dangerouslySetInnerHTML={{__html:block.html}}/>;
}, (before, after)=>before.block===after.block&&before.active===after.active&&before.playing===after.playing);
export default function App(){
  const [book,setBook]=useState<Book>();const [location,setLocation]=useState<ReaderLocation>();const [settings,setSettings]=useState<Settings>(DEFAULT_SETTINGS);
  const [gpuAvailability]=useState(()=>supportsWebGpu());const [gpuSupported,setGpuSupported]=useState(false);
  useEffect(()=>{let active=true;void gpuAvailability.then(supported=>{if(active)setGpuSupported(supported);});return()=>{active=false;};},[gpuAvailability]);
  const {route,routeRef,navigate:navigateRoute,setModal,setViewer,setPanel}=useAppRoute();
  const panel=route.panel;const modal=route.modal;const viewer=route.illustration!==null&&book&&route.illustration<book.images.length?route.illustration:null;
  const [sidebar,setSidebar]=useState(true);const [mobileMenu,setMobileMenu]=useState(false);
  const [initialized,setInitialized]=useState(false);const loadedRouteId=useRef<string|undefined>(undefined);const bookLoadGeneration=useRef(0);
  const [toolbarHidden,setToolbarHidden]=useState(false);const lastScrollTop=useRef(0);
  const importLock=useRef(false);const [importResult,setImportResult]=useState<{done:number;total:number;added:number;failures:string[]}>();
  const playbackCheck=useRef(false);
  const [sidebarWidth,setSidebarWidth]=useState(()=>{try{const stored=Number(localStorage.getItem('listen-sidebar-width'));return Number.isFinite(stored)&&stored>=260?Math.min(480,stored):320;}catch{return 320;}});
  const [viewportWidth,setViewportWidth]=useState(window.innerWidth);const [resizing,setResizing]=useState(false);
  const resizeStart=useRef<{pointerId:number;x:number;width:number}|null>(null);
  const maxSidebarWidth=Math.max(260,Math.min(480,viewportWidth-560));
  const displayedSidebarWidth=Math.min(sidebarWidth,maxSidebarWidth);
  const [query,setQuery]=useState('');const [books,setBooks]=useState<LibraryBook[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [bufferSeconds,setBufferSeconds]=useState<number|null>(null);const [playback,setPlayback]=useState<PlaybackState>('paused');const [engineStatus,setEngineStatus]=useState<EngineStatus>({state:'idle'});const [saved,setSaved]=useState(false);const [mobile,setMobile]=useState(false);
  const [voiceActivity,setVoiceActivity]=useState<VoiceActivityDetails>({current:'',next:'',ready:0,pending:0,seconds:0});
  const bookRef=useRef<Book | undefined>(undefined);const locationRef=useRef<ReaderLocation | undefined>(undefined);const settingsRef=useRef(settings);const controller=useRef<PlaybackController | undefined>(undefined);const inputRef=useRef<HTMLInputElement>(null);const readerRef=useRef<HTMLDivElement>(null);const scrolling=useRef(false);const initRef=useRef(false);const scrollTimer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);const modalRef=useRef<HTMLDivElement>(null);
  const scrollToBlock=useCallback((next:ReaderLocation,behavior:ScrollBehavior='smooth')=>{
    scrolling.current=true;clearTimeout(scrollTimer.current);
    requestAnimationFrame(()=>{
      const area=readerRef.current;const block=document.getElementById(bookRef.current?.blocks[next.blockIndex]?.id||'');
      if(!area||!block)return;
      const inset=parseFloat(getComputedStyle(area).scrollPaddingTop)||0;
      const margin=parseFloat(getComputedStyle(block).scrollMarginTop)||0;
      area.scrollTo({top:area.scrollTop+block.getBoundingClientRect().top-area.getBoundingClientRect().top-inset-margin,behavior});
    });
    scrollTimer.current=setTimeout(()=>{scrolling.current=false;},behavior==='smooth'?800:120);
  },[]);
  useEffect(()=>{
    const media=window.matchMedia('(max-width: 900px)');
    const resize=()=>{setViewportWidth(window.innerWidth);setMobile(media.matches);if(!media.matches)setMobileMenu(false);};resize();window.addEventListener('resize',resize);
    return()=>window.removeEventListener('resize',resize);
  },[]);
  useEffect(()=>{try{localStorage.setItem('listen-sidebar-width',String(sidebarWidth));}catch{/* Resizing works when storage is unavailable. */}},[sidebarWidth]);
  useEffect(()=>{
    const instance=new PlaybackController({onState:setPlayback,onStatus:setEngineStatus,onBuffer:setBufferSeconds,onActivity:setVoiceActivity,onError:message=>{setError(`Local voice: ${message}. Try again from voice settings.`);},onLocation:next=>{const moved=locationRef.current?.blockIndex!==next.blockIndex;locationRef.current=next;setLocation(next);if(moved)scrollToBlock(next);}});
    controller.current=instance;
    if(bookRef.current&&locationRef.current)instance.setBook(bookRef.current,locationRef.current,settingsRef.current);
    return()=>{void instance.dispose();};
  },[scrollToBlock]);
  useEffect(()=>{
    const element=readerRef.current;if(!element)return;
    const measure=()=>document.documentElement.style.setProperty('--reader-height',element.clientHeight+'px');
    const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect();
  },[]);
  const refreshLibrary=useCallback(async()=>{try{setBooks(await getBooks());}catch{setError('Device storage is unavailable. Enable browser storage to save books and progress.');}},[]);
  const openData=useCallback(async(blob:Blob,store=true,historyMode:'push'|'replace'|'none'='push',routeId?:string)=>{
    const generation=++bookLoadGeneration.current;
    setBusy(true);setError('');controller.current?.stop();
    try{
      if(bookRef.current&&locationRef.current)await saveProgress(bookRef.current.id,{location:locationRef.current,chapter:currentChapter(bookRef.current,locationRef.current.blockIndex)?.label||'',settings:settingsRef.current}).catch(()=>{});
      const next=await parseEpub(await blob.arrayBuffer());
      const state=await getProgress(next.id).catch(()=>undefined);
      if(generation!==bookLoadGeneration.current){closeBook(next);return;}
      const position=locationAt(next,state?.location.blockIndex??(next.blocks[0]?.kind==='heading'?1:0),state?.location.segmentIndex);
      const supported=await gpuAvailability;
      const prefs={...(state?.settings?{...DEFAULT_SETTINGS,...state.settings}:settingsRef.current),...(!supported?{voiceMode:'standard' as const}:{})};
      if(store){
        try{
          const existing=(await getBooks()).find(item=>item.id===next.id);
          const cover=next.cover?await fetch(next.cover).then(response=>response.blob()).catch(()=>existing?.cover):existing?.cover;
          await saveBook({id:next.id,title:next.title,author:next.author,blob,added:existing?.added||Date.now(),lastOpened:Date.now(),cover,blockCount:next.blocks.length});
          if(generation===bookLoadGeneration.current)await saveLastBook(next.id);
          await refreshLibrary();
        }catch{setNotice('Your book is open, but this browser could not save it to the library.');}
      }
      if(generation!==bookLoadGeneration.current){closeBook(next);return;}
      const previous=bookRef.current;
      loadedRouteId.current=routeId||next.id;
      bookRef.current=next;locationRef.current=position;settingsRef.current=prefs;
      setBook(next);setLocation(position);setSettings(prefs);setMobileMenu(false);setSaved(false);
      controller.current?.setBook(next,position,prefs);
      if(historyMode!=='none')navigateRoute({...routeRef.current,bookId:loadedRouteId.current,...(historyMode==='push'?{modal:null,illustration:null,panel:'chapters' as const}:{})},{replace:historyMode==='replace'});
      if(previous)closeBook(previous);
      requestAnimationFrame(()=>requestAnimationFrame(()=>scrollToBlock(state?position:locationAt(next,0),'instant')));
      if(next.warnings.length)setNotice(`${next.warnings.length} book resource${next.warnings.length===1?'':'s'} could not be loaded. The rest of your book is ready.`);
    }catch(e){if(generation===bookLoadGeneration.current)setError(e instanceof Error?e.message:'Unable to open this EPUB.');}
    finally{if(generation===bookLoadGeneration.current)setBusy(false);}
  },[refreshLibrary,scrollToBlock,navigateRoute,routeRef,gpuAvailability]);
  useEffect(()=>{
    if(initRef.current)return;initRef.current=true;
    void(async()=>{
      try{
        const library=await getBooks().catch(()=>[]);setBooks(library);
        const wanted=routeRef.current.bookId;
        const last=await getLastBook().catch(()=>undefined);
        const selected=library.find(item=>item.id===(wanted||last));
        if(selected){await openData(selected.blob,true,'replace',selected.id);return;}
        if(wanted&&wanted!=='sample'){navigateRoute({...routeRef.current,bookId:undefined,modal:'library',illustration:null},{replace:true});setNotice('This book is not saved in this browser. Choose a book from your library.');}
        const response=await fetch(`${import.meta.env.BASE_URL}demo/alice.epub`);if(!response.ok)throw new Error('Sample book could not load. Open an EPUB to begin.');
        await openData(await response.blob(),false,'replace','sample');
      }catch(e){setError(e instanceof Error?e.message:'Open an EPUB to begin.');}
      finally{setInitialized(true);}
    })();
  },[openData,navigateRoute,routeRef]);
  useEffect(()=>{
    const id=route.bookId;if(!initialized||!id||id===loadedRouteId.current)return;
    let active=true;let started=false;
    void(async()=>{
      try{
        if(id==='sample'){
          const response=await fetch(`${import.meta.env.BASE_URL}demo/alice.epub`);if(!response.ok)throw new Error('The sample book could not load.');const blob=await response.blob();
          if(active){started=true;await openData(blob,false,'none','sample');}
        }else{
          const library=await getBooks();const selected=library.find(item=>item.id===id);
          if(!active)return;
          if(!selected)throw new Error('This book is not saved in this browser. Choose one from your library.');
          started=true;await openData(selected.blob,true,'none',id);
        }
      }catch(e){if(active){setError(e instanceof Error?e.message:'Unable to load this book.');navigateRoute({...routeRef.current,bookId:loadedRouteId.current,modal:'library',illustration:null},{replace:true});}}
    })();
    return()=>{active=false;if(started){bookLoadGeneration.current++;setBusy(false);}};
  },[route.bookId,initialized,openData,navigateRoute,routeRef]);
  useEffect(()=>{if(book&&route.illustration!==null&&route.illustration>=book.images.length){setNotice('That illustration is not available in this book.');setViewer(null);}},[book,route.illustration,setViewer]);
  useEffect(()=>{
    if(!book||!location)return;setSaved(false);
    const state={location,chapter:currentChapter(book,location.blockIndex)?.label||'',settings};
    const timer=setTimeout(()=>{saveProgress(book.id,state).then(()=>setSaved(true)).catch(()=>setError('Your browser could not save progress. Free device storage and try again.'));},350);
    const flush=()=>{void saveProgress(book.id,state);};window.addEventListener('pagehide',flush);
    return()=>{clearTimeout(timer);window.removeEventListener('pagehide',flush);};
  },[book,location,settings]);
  useEffect(()=>{settingsRef.current=settings;controller.current?.updateSettings(settings);document.documentElement.dataset.theme=settings.theme;
    const accent=/^#[0-9a-f]{6}$/i.test(settings.accentColor)?settings.accentColor:DEFAULT_SETTINGS.accentColor;
    const root=document.documentElement;
    root.style.setProperty('--accent',accent);
    root.style.setProperty('--accent-hover',`color-mix(in srgb, ${accent} 88%, black)`);
    root.style.setProperty('--active',`color-mix(in srgb, ${accent} ${settings.theme==='light'?'14':'18'}%, var(--surface))`);
    root.style.setProperty('--accent-text',settings.theme==='light'?`color-mix(in srgb, ${accent} 45%, black)`:accent);
    const channels=[1,3,5].map(offset=>{const value=parseInt(accent.slice(offset,offset+2),16)/255;return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4;});
    const luminance=channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
    root.style.setProperty('--accent-contrast',luminance>0.179?'#111111':'#ffffff');},[settings]);
  useEffect(()=>{
    if(playback==='playing')setToolbarHidden(true);
    else if(playback==='paused')setToolbarHidden(false);
  },[playback]);
  const navigate=useCallback((index:number,resume?:boolean)=>{
    if(!bookRef.current)return;const next=locationAt(bookRef.current,index);
    if(controller.current)controller.current.navigate(next,resume);else{locationRef.current=next;setLocation(next);scrollToBlock(next);}
  },[scrollToBlock]);
  const togglePlay=useCallback(()=>{
    if(playbackCheck.current)return;
    if(engineStatus.state==='idle'&&playback==='paused'){
      const instance=controller.current;if(!instance)return;
      const requested=settingsRef.current;const bookGeneration=bookLoadGeneration.current;
      // Unlock during the click, before the storage check, so cached playback works on Safari too.
      const unlocked=instance.prepareAudioOutput().catch(()=>{});
      playbackCheck.current=true;
      void (async()=>{
        try{
          const files=await getSpeechDownloads(requested.voice).catch(()=>undefined);
          await unlocked;
          if(controller.current!==instance||bookGeneration!==bookLoadGeneration.current||requested.voice!==settingsRef.current.voice||requested.voiceMode!==settingsRef.current.voiceMode)return;
          if(files?.voice&&files.runtime&&files[requested.voiceMode])instance.toggle();
          else setModal('model');
        }finally{playbackCheck.current=false;}
      })();
      return;
    }
    controller.current?.toggle();
  },[engineStatus.state,playback]);
  const openPanel=useCallback((type:'chapters'|'illustrations')=>{setPanel(type);setSidebar(true);if(window.innerWidth<900)setMobileMenu(true);},[]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(viewer!==null)return;
      if(e.key==='Escape'){setModal(null);setMobileMenu(false);return;}
      if(modal||['INPUT','SELECT','TEXTAREA','BUTTON'].includes((e.target as HTMLElement).tagName)||(e.target as HTMLElement).isContentEditable)return;
      if(e.code==='Space'){e.preventDefault();togglePlay();}
      else if(e.key==='ArrowLeft'){e.preventDefault();navigate((locationRef.current?.blockIndex||0)-1);}
      else if(e.key==='ArrowRight'){e.preventDefault();navigate((locationRef.current?.blockIndex||0)+1);}
      else if(e.key.toLowerCase()==='c')openPanel('chapters');
      else if(e.key.toLowerCase()==='i')openPanel('illustrations');
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[togglePlay,navigate,openPanel,modal,viewer]);
  useEffect(()=>{
    if(!('mediaSession'in navigator)||!book)return;
    navigator.mediaSession.metadata=new MediaMetadata({title:book.title,artist:book.author,album:'Listen al Gaib'});
    const handlers:{[key:string]:()=>void}={play:()=>void controller.current?.play(),pause:()=>controller.current?.pause(),previoustrack:()=>navigate((locationRef.current?.blockIndex||0)-1),nexttrack:()=>navigate((locationRef.current?.blockIndex||0)+1),seekbackward:()=>navigate((locationRef.current?.blockIndex||0)-1),seekforward:()=>navigate((locationRef.current?.blockIndex||0)+1)};
    for(const[action,handler]of Object.entries(handlers))try{navigator.mediaSession.setActionHandler(action as MediaSessionAction,handler);}catch{}
    return()=>{for(const action of Object.keys(handlers))try{navigator.mediaSession.setActionHandler(action as MediaSessionAction,null);}catch{}};
  },[book,navigate]);
  useEffect(()=>{
    if(!modal)return;const previous=document.activeElement as HTMLElement;
    requestAnimationFrame(()=>{const element=modalRef.current;const preferred=modal==='library'?element?.querySelector<HTMLElement>('input'):undefined;(preferred||element?.querySelector<HTMLElement>('input,button,select'))?.focus();});
    const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const items=Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,a[href]')||[]);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
    window.addEventListener('keydown',trap);return()=>{window.removeEventListener('keydown',trap);previous?.focus();};
  },[modal]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice]);
  const blockIndexes=useMemo(()=>new Map(book?.blocks.map((block,index)=>[block.id,index])),[book]);
  const chapter=book&&location?currentChapter(book,location.blockIndex):undefined;
  const chapterNumber=book?Math.max(1,book.toc.findIndex(t=>t.id===chapter?.id)+1):1;
  const readingMinutes=useMemo(()=>Math.max(1,Math.round((book?.blocks.filter(block=>block.spineIndex===location?.spineIndex).reduce((words,block)=>words+block.text.split(/\s+/).length,0)||0)/220)),[book,location?.spineIndex]);
  const progress=book&&location?Math.round(location.blockIndex/Math.max(1,book.blocks.length-1)*100):0;
  const results=useMemo(()=>{if(!book||query.trim().length<2)return[];const q=query.trim().toLocaleLowerCase();return book.blocks.map((b,index)=>({block:b,index})).filter(({block})=>block.kind!=='image'&&block.text.toLocaleLowerCase().includes(q)).slice(0,100);},[query,book]);
  const voice=VOICES.find(v=>v.id===settings.voice)||VOICES[0];
  const updateSetting=<K extends keyof Settings>(key:K,value:Settings[K])=>setSettings(s=>({...s,[key]:value}));
  const changeTheme=()=>updateSetting('theme',settings.theme==='light'?'dark':settings.theme==='dark'?'amoled':'light');
  const beginUserScroll=(direction?:number)=>{scrolling.current=false;clearTimeout(scrollTimer.current);const area=readerRef.current;if(area)area.scrollTo({top:area.scrollTop,behavior:"instant"});if(direction!==undefined&&Math.abs(direction)>=4)setToolbarHidden(direction>0);};
  const onScroll=()=>{
    const area=readerRef.current;if(!area)return;
    const top=Math.max(0,area.scrollTop);const delta=top-lastScrollTop.current;lastScrollTop.current=top;
    if(scrolling.current){
      // A long smooth jump may outlast the initial timeout. Wait until its scroll events settle.
      clearTimeout(scrollTimer.current);scrollTimer.current=setTimeout(()=>{scrolling.current=false;},160);return;
    }
    if(viewer!==null)return;
    if(Math.abs(delta)>=4)setToolbarHidden(delta>0);

  };
  const goImage=useCallback((index:number)=>{const current=bookRef.current;if(!current)return;const block=current.images[index];navigate(current.blocks.indexOf(block),false);setViewer(index);},[navigate]);
  const visibleBlocks=useMemo(()=>{
    if(!book||!location)return[];
    // Keep three neighboring spine documents mounted, retaining source blocks and the shared location.
    if(book.blocks.length<5000)return book.blocks;
    const center=location.spineIndex;return book.blocks.filter(b=>Math.abs(b.spineIndex-center)<=1);
  },[book,location?.spineIndex]);
  const loadFiles=async(files:File[])=>{
    if(!files.length||busy||importLock.current)return;
    setImportResult(undefined);
    if(files.length===1){if(!/\.epub$/i.test(files[0].name)){setError('Choose a DRM-free .epub file.');return;}await openData(files[0]);return;}
    importLock.current=true;setBusy(true);setError('');setMobileMenu(false);setModal('library');
    const result={done:0,total:files.length,added:0,failures:[] as string[]};setImportResult({...result});
    try{
      for(const file of files){
        let imported:Book|undefined;
        try{
          if(!/\.epub$/i.test(file.name))throw new Error('Choose an EPUB file.');
          imported=await parseEpub(await file.arrayBuffer());
          const existing=(await getBooks()).find(item=>item.id===imported!.id);
          const cover=imported.cover?await fetch(imported.cover).then(response=>response.blob()).catch(()=>existing?.cover):existing?.cover;
          await saveBook({id:imported.id,title:imported.title,author:imported.author,blob:file,added:existing?.added||Date.now(),lastOpened:existing?.lastOpened||Date.now(),cover,blockCount:imported.blocks.length});
          result.added++;
        }catch(e){result.failures.push(`${file.name}: ${e instanceof Error?e.message:'Unable to import this EPUB.'}`);}
        finally{if(imported)closeBook(imported);result.done++;setImportResult({...result,failures:[...result.failures]});}
      }
      await refreshLibrary();
    }finally{importLock.current=false;setBusy(false);}
  };
  return <div className={`app ${sidebar?'':'sidebar-hidden'} ${resizing?'is-resizing':''}`} style={{'--sidebar-width':displayedSidebarWidth+'px'} as CSSProperties} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void loadFiles(Array.from(e.dataTransfer.files));}}>
    <input ref={inputRef} className="sr-only" type="file" multiple accept=".epub,application/epub+zip" onChange={e=>{void loadFiles(Array.from(e.target.files||[]));e.target.value='';}}/>
    {(mobileMenu)&&<div className="drawer-scrim" onClick={()=>setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu?'mobile-open':''}`} aria-label="Book navigation" inert={(mobile&&!mobileMenu)||(!mobile&&!sidebar)}>
      <div className="sidebar-header"><a href={import.meta.env.BASE_URL} className="brand" aria-label="Listen al Gaib home" onClick={e=>e.preventDefault()}><span className="brand-icon"><Headphones size={20} strokeWidth={2.4}/></span><span>listen al gaib<span className="brand-dot">.</span></span></a><div className="sidebar-actions"><IconButton label="My library" onClick={()=>{void refreshLibrary();setModal('library');setMobileMenu(false);}}><Library size={18}/></IconButton><button className="icon-button sidebar-upload" aria-label="Open EPUB" title="Open EPUB" onClick={()=>inputRef.current?.click()} disabled={busy}>{busy?<LoaderCircle size={18} className="spin"/>:<Upload size={18}/>}</button></div></div>
      <div className="sidebar-tabs"><button className={panel==='chapters'?'selected':''} onClick={()=>setPanel('chapters')}><List size={16}/>Contents</button><button className={panel==='illustrations'?'selected':''} onClick={()=>setPanel('illustrations')}><Images size={16}/>Illustrations</button></div>
      {panel==='illustrations'&&<div className="nav-caption"><span>All illustrations</span><span>{book?.images.length||0}</span></div>}
      <div className={`sidebar-content ${panel==='illustrations'?'gallery':''}`}>
        {panel==='chapters'?book?.toc.map((entry,index)=><button key={entry.id} className={`chapter-link ${entry.id===chapter?.id?'selected':''}`} style={{paddingLeft:16+entry.depth*16}} onClick={()=>{navigate(entry.blockIndex);setMobileMenu(false);readerRef.current?.focus({preventScroll:true});}}><span className="chapter-number">{String(index+1).padStart(2,'0')}</span><span>{entry.label}</span>{entry.id===chapter?.id&&<Volume2 size={14}/>}</button>):book?.images.map((image,index)=>{
          const blockIndex=blockIndexes.get(image.id)!;
          const label=image.caption||(!/^image$/i.test(image.alt||'')&&image.alt)||`Illustration ${index+1}`;
          const selected=location?.blockIndex===blockIndex;
          const chapterLabel=currentChapter(book,blockIndex)?.label||'Front matter';
          return <div key={image.id} className={`gallery-item ${selected?'selected':''}`}>
            <button className="gallery-preview" aria-label={`View ${label}`} title="Open full illustration" onClick={()=>setViewer(index)}><Thumbnail src={image.src} alt={label}/><span className="gallery-expand"><Maximize2 size={14}/></span></button>
            <button className="gallery-label" aria-label={`Go to ${label} in book`} onClick={()=>{navigate(blockIndex);setMobileMenu(false);readerRef.current?.focus({preventScroll:true});}}><span className="gallery-number">ILLUSTRATION {String(index+1).padStart(2,'0')}</span><strong className="gallery-title">{label}</strong><span className="gallery-context">{chapterLabel}</span><span className="gallery-location"><BookOpen size={14}/>{selected?'Current location':'Go to passage'}</span></button>
          </div>;
        })}
        {panel==='illustrations'&&book&&!book.images.length&&<div className="empty-panel"><Images size={32}/><p>This book has no illustrations.</p></div>}
      </div>
      <div className="sidebar-book"><BookOpen size={18}/><div><strong title={book?.title}>{book?.title||'Your reading space'}</strong><span>{book?.author||'Open a book to begin'}</span></div><button className="icon-button mobile-close" onClick={()=>setMobileMenu(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <div className="sidebar-resize" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={maxSidebarWidth} aria-valuenow={displayedSidebarWidth} tabIndex={0} title="Drag to resize. Double-click to reset." onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();resizeStart.current={pointerId:e.pointerId,x:e.clientX,width:displayedSidebarWidth};e.currentTarget.setPointerCapture(e.pointerId);setResizing(true);}} onPointerMove={e=>{const start=resizeStart.current;if(!start||start.pointerId!==e.pointerId)return;setSidebarWidth(Math.max(260,Math.min(maxSidebarWidth,Math.round((start.width+e.clientX-start.x)/2)*2)));}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onLostPointerCapture={()=>{resizeStart.current=null;setResizing(false);}} onDoubleClick={()=>setSidebarWidth(Math.min(320,maxSidebarWidth))} onKeyDown={e=>{const next=e.key==='ArrowLeft'?displayedSidebarWidth-16:e.key==='ArrowRight'?displayedSidebarWidth+16:e.key==='Home'?260:e.key==='End'?maxSidebarWidth:undefined;if(next!==undefined){e.preventDefault();e.stopPropagation();setSidebarWidth(Math.max(260,Math.min(maxSidebarWidth,next)));}}}/>
    </aside>
    <main className="main">
      <div className={`reading-toolbar-shell ${toolbarHidden?'is-hidden':''}`} aria-hidden={toolbarHidden} inert={toolbarHidden}><div className="reading-toolbar-region"><div className="reading-toolbar"><div className="toolbar-left"><span className="chapter-kicker">{chapter?<>CHAPTER {String(chapterNumber).padStart(2,'0')} <span>OF {String(book?.toc.length||0).padStart(2,'0')}</span></>:'FRONT MATTER'}</span>{book&&<span className="reading-estimate">{readingMinutes} min read</span>}</div><div className="toolbar-actions"><IconButton label="Search book" onClick={()=>setModal('search')}><Search size={20}/></IconButton><IconButton label="Reading appearance" onClick={()=>setModal('appearance')}><Type size={20}/></IconButton><IconButton label={`Theme: ${settings.theme}. Change theme`} onClick={changeTheme}>{settings.theme==='light'?<Sun size={20}/>:settings.theme==='dark'?<Moon size={20}/>:<Monitor size={20}/>}</IconButton><IconButton label="Keyboard shortcuts" onClick={()=>setModal('help')}><Keyboard size={20}/></IconButton></div></div></div></div>
      <div className="reader-scroll" tabIndex={-1} ref={readerRef} onScroll={onScroll} onWheel={event=>beginUserScroll(event.deltaY)} onTouchMove={()=>beginUserScroll()} data-progress-saved={saved}>
        {!book?<div className="loading-reader">{busy?<LoaderCircle size={36} className="spin"/>:<BookOpen size={40}/>}<h2>{busy?'Opening your book…':'A little space for a good book.'}</h2><p>Open a DRM-free EPUB. Your book stays on your device.</p><button className="primary-button" onClick={()=>inputRef.current?.click()}><Upload size={18}/>Open EPUB</button></div>:<article className="reader-content" lang={book.language} style={{'--reader-font-size':settings.fontSize+'px','--reader-line-height':settings.lineHeight,'--reader-width':settings.width+'px','--paragraph-spacing':settings.paragraphSpacing+'px',fontFamily:FAMILY[settings.fontFamily],textAlign:settings.alignment} as CSSProperties} onClick={e=>{
          const link=(e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-reader-href]');if(link){e.preventDefault();const index=resolveLocation(book,link.dataset.readerHref||'');if(index>=0)navigate(index);}
        }}>
          <div className="chapter-intro"><span className="chapter-badge">{chapter?'CHAPTER '+String(chapterNumber).padStart(2,'0'):'FRONT MATTER'}</span></div>
          {visibleBlocks.map(block=><ReadBlock key={block.id} block={block} active={blockIndexes.get(block.id)===location?.blockIndex} playing={playback==='playing'} onSelect={()=>navigate(blockIndexes.get(block.id)!,false)} onImage={()=>goImage(book.images.indexOf(block))}/>)}
          <div className="chapter-end"><div><button disabled={chapterNumber===1} onClick={()=>navigate(book.toc[chapterNumber-2]?.blockIndex||0)}><ChevronLeft size={18}/>Previous chapter</button><button disabled={chapterNumber>=book.toc.length} onClick={()=>navigate(book.toc[chapterNumber]?.blockIndex||0)}>Next chapter<ChevronRight size={18}/></button></div></div>
        </article>}
      </div>
      <footer className={`player ${playback==='playing'&&bufferSeconds===null?'is-playing':''}`}>
        <div className="seek-fill" style={{width:progress+'%'}}/><input className="book-seek" aria-label="Reading position" type="range" min="0" max={Math.max(0,(book?.blocks.length||1)-1)} value={location?.blockIndex||0} onChange={e=>navigate(Number(e.target.value))} style={{'--progress':progress+'%'} as CSSProperties}/>
        <div className="player-inner"><div className="player-leading"><div className="player-sidebar-toggle"><IconButton label={mobile?'Open navigation':sidebar?'Hide contents':'Show contents'} onClick={()=>{if(mobile)setMobileMenu(true);else setSidebar(s=>!s);}}>{mobile||!sidebar?<PanelLeftOpen size={20}/>:<PanelLeftClose size={20}/>}</IconButton></div><VoiceActivity engine={engineStatus} playback={playback} activity={voiceActivity} buffer={bufferSeconds} voice={voice.name} hasBook={!!book}/></div>
          <div className="playback-controls"><IconButton label="Replay current block" onClick={()=>{if(locationRef.current)controller.current?.navigate(locationRef.current,true);}}><RotateCcw size={18}/></IconButton><button className="icon-button" aria-label="Previous reading block" disabled={!book||location?.blockIndex===0} onClick={()=>navigate((location?.blockIndex||0)-1)}><SkipBack size={20}/></button><div className="play-toggle">{bufferSeconds!==null&&<span className="sr-only" role="status">Buffering speech: {Math.floor(bufferSeconds)} seconds ready.</span>}<button className="play-button" title={bufferSeconds!==null?`Buffering speech · ${Math.floor(bufferSeconds)} seconds ready`:undefined} aria-label={playback==='paused'?'Play narration':'Pause narration'} disabled={!book||busy} onClick={togglePlay}>{playback==='loading'?<LoaderCircle size={24} className="spin"/>:playback==='playing'?<Pause size={24} fill="currentColor"/>:<Play size={24} fill="currentColor"/>}</button></div><button className="icon-button" aria-label="Next reading block" disabled={!book||location?.blockIndex===(book?.blocks.length||0)-1} onClick={()=>navigate((location?.blockIndex||0)+1)}><SkipForward size={20}/></button><SpeedControl speed={settings.speed} onChange={speed=>updateSetting('speed',speed)}/></div>
          <div className="voice-controls"><button className="voice-button" aria-label={`Voice: ${voice.name}. Change voice`} onClick={()=>setModal('voice')}><img className="player-voice-portrait" src={`${import.meta.env.BASE_URL}voices/${voice.id}.svg`} alt="" width={28} height={28}/><span>{voice.name}</span><Settings2 size={14}/></button></div>
        </div>

      </footer>
    </main>
    {(error||notice)&&<div className={`toast ${error?'error':''}`} role={error?'alert':'status'}>{error?<AlertCircle size={20}/>:<Info size={20}/>}<span>{error||notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={()=>{setError('');setNotice('');}}><X size={18}/></button></div>}
    {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null);}}><div className={`modal modal-${modal}`} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div>{modal!=='model'&&modal!=='voice'&&<span className="modal-eyebrow">LISTEN AL GAIB</span>}<h2 id="modal-title">{{library:'Your library',search:'Find in your book',appearance:'Make yourself comfortable',voice:'Find your voice',help:'A few handy shortcuts',model:'Download voice files'}[modal]}</h2></div><IconButton label="Close dialog" onClick={()=>setModal(null)}><X size={22}/></IconButton></div>
      {modal==='library'&&importResult&&<div className="library-import-result"><div role="status" aria-live="polite">{importResult.done<importResult.total?<><LoaderCircle size={16} className="spin"/>Importing {importResult.done} of {importResult.total} EPUBs…</>:<><Check size={16}/>{importResult.added} of {importResult.total} files added to your library.</>}</div>{importResult.failures.length>0&&<ul>{importResult.failures.map((failure,index)=><li key={index}>{failure}</li>)}</ul>}</div>}
      {modal==='library'&&<LibraryContent books={books} currentId={book?.id} busy={busy} onImport={()=>inputRef.current?.click()} onOpen={item=>void openData(item.blob)} onRemove={async id=>{await deleteBook(id);await refreshLibrary();}} onSample={()=>{void fetch(`${import.meta.env.BASE_URL}demo/alice.epub`).then(response=>{if(!response.ok)throw new Error('The sample book could not load.');return response.blob();}).then(blob=>openData(blob,false,'push','sample')).catch(()=>setError('The sample book could not load. Try again.'));}}/>}
      {modal==='search'&&<><label className="search-field"><Search size={20}/><input placeholder="Search for a word or a passage…" value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search book text"/></label><div className="search-results">{query.trim().length<2?<div className="empty-panel"><FileText size={32}/><p>Enter at least two characters to search your book.</p></div>:results.length?results.map(({block,index})=>{const start=Math.max(0,block.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())-48);return <button key={block.id} onClick={()=>{navigate(index);setModal(null);}}><span>{book&&currentChapter(book,index)?.label}</span><p>{start?'…':''}{block.text.slice(start,start+200)}{start+200<block.text.length?'…':''}</p></button>}):<div className="empty-panel"><Search size={32}/><p>No matches for “{query}”.</p></div>}</div>{results.length>0&&<p className="modal-note">{results.length===100?'First 100':results.length} matching passages</p>}</>}
      {modal==='appearance'&&<><div className="setting-group"><span>Theme</span><div className="theme-options">{(['light','dark','amoled']as const).map(theme=><button className={`theme-option ${theme} ${settings.theme===theme?'selected':''}`} onClick={()=>updateSetting('theme',theme)} aria-label={theme==='amoled'?'AMOLED':theme[0].toUpperCase()+theme.slice(1)} key={theme}><span>Aa</span><span>{theme==='amoled'?'AMOLED':theme[0].toUpperCase()+theme.slice(1)}</span>{settings.theme===theme&&<Check size={16}/>}</button>)}</div></div><div className="setting-row"><label htmlFor="accent-color">Accent color</label><div className="accent-control"><span>{settings.accentColor.toUpperCase()}</span><input id="accent-color" type="color" value={settings.accentColor} onChange={event=>updateSetting('accentColor',event.target.value)}/></div></div><div className="setting-group"><span>Typeface</span><div className="segmented-control">{(['serif','sans','mono']as const).map(font=><button style={{fontFamily:FAMILY[font]}} key={font} className={settings.fontFamily===font?'selected':''} onClick={()=>updateSetting('fontFamily',font)}>{font==='serif'?'Literary':font==='sans'?'Modern':'Mono'}</button>)}</div></div>
        <div className="setting-row"><label htmlFor="font-size">Font size</label><div className="step-control"><button aria-label="Decrease font size" disabled={settings.fontSize<=14} onClick={()=>updateSetting('fontSize',settings.fontSize-2)}>−</button><span>{settings.fontSize}px</span><button aria-label="Increase font size" disabled={settings.fontSize>=40} onClick={()=>updateSetting('fontSize',settings.fontSize+2)}>+</button></div></div>
        <div className="setting-row"><label htmlFor="line-height">Line height</label><select id="line-height" value={settings.lineHeight} onChange={e=>updateSetting('lineHeight',Number(e.target.value))}>{[1.4,1.6,1.8,2].map(n=><option key={n}>{n}</option>)}</select></div>
        <div className="setting-row"><label htmlFor="content-width">Content width</label><select id="content-width" value={settings.width} onChange={e=>updateSetting('width',Number(e.target.value))}>{[560,640,720,800,880].map(n=><option key={n} value={n}>{n}px</option>)}</select></div>
        <div className="setting-row"><label htmlFor="paragraph-spacing">Paragraph spacing</label><select id="paragraph-spacing" value={settings.paragraphSpacing} onChange={e=>updateSetting('paragraphSpacing',Number(e.target.value))}>{[12,16,20,24,28,32,36,40,48].map(n=><option key={n} value={n}>{n}px</option>)}</select></div>
        <div className="setting-row"><span>Text alignment</span><div className="segmented-control small"><button className={settings.alignment==='left'?'selected':''} onClick={()=>updateSetting('alignment','left')}>Left</button><button className={settings.alignment==='justify'?'selected':''} onClick={()=>updateSetting('alignment','justify')}>Justified</button></div></div><div className="setting-row"><label htmlFor="image-cue">Illustration narration</label><select id="image-cue" value={settings.imageCue} onChange={e=>updateSetting('imageCue',e.target.value as Settings['imageCue'])}><option value="descriptive">Alt text or caption</option><option value="simple">Say “Image here”</option><option value="off">Off</option></select></div><button className="text-button" onClick={()=>setSettings(s=>({...DEFAULT_SETTINGS,voice:s.voice,voiceMode:s.voiceMode,speed:s.speed,theme:s.theme,accentColor:s.accentColor,imageCue:s.imageCue}))}>Reset reading appearance</button></>}
      {modal==='voice'&&<VoiceSettings key={`${book?.id}|${settings.voice}|${settings.voiceMode}`} voices={VOICES} voice={settings.voice} mode={settings.voiceMode} gpuSupported={gpuSupported} onDone={(voice,voiceMode)=>{setSettings(current=>({...current,voice,voiceMode}));setModal(null);}}/> }
      {modal==='help'&&<><div className="shortcut-list">{[['Space','Play / pause narration'],['←','Previous reading block'],['→','Next reading block'],['C','Open contents'],['I','Open illustrations'],['Esc','Close a panel or viewer']].map(([key,label])=><div key={key}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p className="modal-note">Click a passage to make it your current reading position. Your next play starts right there.</p></>}
      {modal==='model'&&<VoiceDownload voice={voice} mode={settings.voiceMode} onStart={()=>{setModal(null);void controller.current?.play();}}/>}

    </div></div>}
    {viewer!==null&&book&&<ImageViewer images={book.images} index={viewer} onChange={setViewer} onClose={()=>setViewer(null)}/>}
  </div>;
}
