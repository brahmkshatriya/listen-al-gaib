import { unzip } from 'fflate';
import DOMPurify from 'dompurify';
import { resolveArchivePath, resolveLocation } from './types';
import type { Book, ReadingBlock, TocEntry } from './types';
const decoder = new TextDecoder();
const localElements = (doc: Document | Element, name: string) => Array.from(doc.getElementsByTagNameNS('*',name));
function xml(text: string, label: string): Document {
  const doc = new DOMParser().parseFromString(text,'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`Malformed ${label}. The book cannot be read safely.`);
  return doc;
}
export function isMeaningfulImage(el: Element, width: number, height: number): boolean {
  if (el.getAttribute('alt') === '' || el.getAttribute('role') === 'presentation' || el.getAttribute('aria-hidden') === 'true') return false;
  if (height > 0 && height <= 8 || width > 0 && height > 0 && width/height >= 20) return false;
  if (/separator|scene[-_]?break|dash|ornament|glyph/i.test(el.getAttribute('class') || '')) return false;
  if (width > 0 && height > 0 && width <= 32 && height <= 32) return false;
  return true;
}
export function imageDimensions(bytes: Uint8Array, mime: string): {width:number;height:number} {
  const v = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (bytes.length >= 24 && bytes[0]===137 && bytes[1]===80) return {width:v.getUint32(16),height:v.getUint32(20)};
  if (bytes.length>=10 && decoder.decode(bytes.slice(0,3))==='GIF') return {width:v.getUint16(6,true),height:v.getUint16(8,true)};
  if (bytes[0]===255 && bytes[1]===216) {
    let i=2;
    while(i+8<bytes.length) {
      if(bytes[i]!==255) {i++;continue;}
      const marker=bytes[i+1]; i+=2;
      if(marker===216 || marker===217) continue;
      const length=v.getUint16(i);
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return {height:v.getUint16(i+3),width:v.getUint16(i+5)};
      if(length<2) break; i+=length;
    }
  }
  if(mime.includes('svg')) {
    const root=xml(decoder.decode(bytes),'SVG').documentElement;
    const view=(root.getAttribute('viewBox')||'').split(/[\s,]+/).map(Number);
    return {width:parseFloat(root.getAttribute('width')||'')||view[2]||0,height:parseFloat(root.getAttribute('height')||'')||view[3]||0};
  }
  if(bytes.length>=30 && decoder.decode(bytes.slice(0,4))==='RIFF') {
    const type=decoder.decode(bytes.slice(12,16));
    if(type==='VP8X') return {width:1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height:1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)};
    if(type==='VP8 ' && bytes.length>=30) return {width:v.getUint16(26,true)&16383,height:v.getUint16(28,true)&16383};
    if(type==='VP8L' && bytes.length>=25) { const bits=v.getUint32(21,true); return {width:(bits&16383)+1,height:((bits>>>14)&16383)+1}; }
  }
  return {width:0,height:0};
}
export async function parseEpub(input: ArrayBuffer): Promise<Book> {
  if(input.byteLength>160*1024*1024) throw new Error('This EPUB exceeds the 160 MB import limit.');
  let files: Record<string,Uint8Array>;
  try { files=await new Promise((resolve,reject)=>unzip(new Uint8Array(input),(error,data)=>error?reject(error):resolve(data))); }
  catch { throw new Error('This is not a valid EPUB ZIP archive.'); }
  if(Object.values(files).reduce((sum,f)=>sum+f.byteLength,0)>512*1024*1024) throw new Error('The expanded EPUB exceeds the device memory limit.');
  const read=(path:string) => {if(!files[path]) throw new Error(`Missing book resource: ${path}`);return decoder.decode(files[path]);};
  if(!files['META-INF/container.xml']) throw new Error('Missing META-INF/container.xml. Choose a complete EPUB file.');
  const container=xml(read('META-INF/container.xml'),'container');
  const opfPath=localElements(container,'rootfile')[0]?.getAttribute('full-path');
  if(!opfPath) throw new Error('The EPUB does not identify its package document.');
  if(files['META-INF/encryption.xml']) {
    const encryption=xml(read('META-INF/encryption.xml'),'encryption metadata');
    if(localElements(encryption,'EncryptedData').length) throw new Error('Encrypted or DRM-protected EPUB files are unsupported. Use a DRM-free copy.');
  }
  const opf=xml(read(opfPath),'package document');
  const manifest=new Map(localElements(opf,'item').map(el=>[el.getAttribute('id')||'',{
    path:resolveArchivePath(opfPath,el.getAttribute('href')||''),mime:el.getAttribute('media-type')||'',properties:el.getAttribute('properties')||''
  }]));
  const spine=localElements(opf,'itemref').filter(el=>el.getAttribute('linear')!=='no').map(el=>{
    const item=manifest.get(el.getAttribute('idref')||'');if(!item) throw new Error('A spine item is missing from the manifest.'); return item.path;
  });
  if(!spine.length) throw new Error('This EPUB has no readable spine documents.');
  const urls:string[]=[]; const resources=new Map<string,string>(); const dimensions=new Map<string,{width:number;height:number}>(); const warnings:string[]=[];
  const blobUrl=(path:string):string => {
    if(resources.has(path)) return resources.get(path)!;
    const entry=[...manifest.values()].find(m=>m.path===path);
    if(!files[path]) {warnings.push(`Missing image: ${path}`);return '';}
    const mime=entry?.mime||'application/octet-stream';
    let bytes=files[path];
    if(mime==='image/svg+xml') bytes=new TextEncoder().encode(DOMPurify.sanitize(decoder.decode(bytes),{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['script','foreignObject','use'],FORBID_ATTR:['href','xlink:href']}));
    const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime})); urls.push(url);resources.set(path,url);return url;
  };
  for(const item of manifest.values()) if(item.mime.startsWith('image/') && files[item.path]) {
    try { dimensions.set(item.path,imageDimensions(files[item.path],item.mime)); } catch { dimensions.set(item.path,{width:0,height:0}); }
  }
  const blocks:ReadingBlock[]=[];
  const sanitize=(html:string) => DOMPurify.sanitize(html,{ALLOWED_TAGS:['span','em','strong','b','i','u','s','sup','sub','br','a','code','ruby','rt','rp'],ALLOWED_ATTR:['href','data-reader-href','lang','dir','target','rel','style'],ALLOW_DATA_ATTR:true});
  try {
    for(let spineIndex=0;spineIndex<spine.length;spineIndex++) {
      const path=spine[spineIndex]; const doc=xml(read(path),`XHTML document ${path}`);
      const body=localElements(doc,'body')[0]||doc.documentElement;
      const embeddedCss=localElements(doc,'style').map(el=>el.textContent||'');
      body.querySelectorAll('script,style,nav,iframe,object,embed,form,input,button').forEach(el=>el.remove());
      // Explicit and publisher-defined hidden prose does not enter the speech model.
      const sheets=[...localElements(doc,'link')].filter(el=>(el.getAttribute('rel')||'').includes('stylesheet')).map(el=>{
        try{return read(resolveArchivePath(path,el.getAttribute('href')||''));}catch{return '';}
      }).concat(embeddedCss);
      for(const css of sheets) for(const rule of css.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
        if(/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(rule[2])) try {
          body.querySelectorAll(rule[1].trim()).forEach(el=>{if(!['img','svg','image'].includes(el.localName)){if(!el.querySelector('img,image,svg'))el.remove();else el.setAttribute('data-reader-hidden','true');}});
        } catch { /* unsupported publisher selector */ }
      }
      const safeStyle=(declarations:string)=>{
        const allowed:Record<string,RegExp>={
          'font-style':/^(normal|italic|oblique)$/i,
          'font-weight':/^(normal|bold|bolder|lighter|[1-9]00)$/i,
          'text-decoration':/^(none|underline|line-through|overline)(\s+(solid|double|dotted|dashed))?$/i,
          'font-variant':/^(normal|small-caps)$/i,
          'vertical-align':/^(baseline|sub|super)$/i,
        };
        return declarations.split(';').map(declaration=>{
          const [property,...parts]=declaration.split(':');const key=property?.trim().toLowerCase(),value=parts.join(':').trim();
          return key&&allowed[key]?.test(value)?key+':'+value:'';
        }).filter(Boolean).join(';');
      };
      const applyStyle=(el:Element,declarations:string)=>{const safe=safeStyle(declarations);if(safe)el.setAttribute('style',[safeStyle(el.getAttribute('style')||''),safe].filter(Boolean).join(';'));};
      for(const css of sheets)for(const rule of css.matchAll(/([^{}]+)\{([^{}]+)\}/g)){
        try{for(const el of Array.from(body.querySelectorAll(rule[1].trim())))applyStyle(el,rule[2]);}catch{}
      }
      for(const el of Array.from(body.querySelectorAll('[style]'))) {
        if(/display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style')||''))el.setAttribute('data-reader-hidden','true');
        const safe=safeStyle(el.getAttribute('style')||'');if(safe)el.setAttribute('style',safe);else el.removeAttribute('style');
      }
      let pendingAnchors:string[]=[];
      const collectAnchors=(el:Element) => {
        const own=el.getAttribute('id');if(own) pendingAnchors.push(own);
      };
      const push=(block:Omit<ReadingBlock,'id'|'spineIndex'|'documentHref'|'anchors'>,anchors:string[]=[]) => {
        blocks.push({...block,id:`b-${spineIndex}-${blocks.length}`,spineIndex,documentHref:path,anchors:[...pendingAnchors,...anchors]});pendingAnchors=[];
      };
      const addImage=(el:Element) => {
        collectAnchors(el);
        const raw=el.getAttribute('src')||el.getAttribute('href')||el.getAttribute('xlink:href')||'';
        let imageHref='';try{imageHref=resolveArchivePath(path,raw);}catch{warnings.push('An external image was blocked.');}
        const size=dimensions.get(imageHref)||{width:parseFloat(el.getAttribute('width')||'')||0,height:parseFloat(el.getAttribute('height')||'')||0};
        const meaningful=isMeaningfulImage(el,size.width,size.height);
        const alt=el.getAttribute('alt')||'';
        const caption=el.closest('figure')?.querySelector('figcaption')?.textContent?.trim()||'';
        if(meaningful) push({kind:'image',text:'',html:'',imageHref,src:imageHref?blobUrl(imageHref):'',alt,caption,meaningful:true,intrinsicWidth:size.width,intrinsicHeight:size.height});
        else if(size.height>0&&size.height<=8 || /dash|separator/i.test(el.getAttribute('class')||'')) push({kind:'separator',text:'',html:'',semanticValue:'emdash',meaningful:false});
      };
      const walk=(el:Element) => {
        if(el.hasAttribute('hidden')||el.getAttribute('aria-hidden')==='true')return;
        if(el.hasAttribute('data-reader-hidden')||/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(el.getAttribute('style')||'')) {
          // Restore meaningful art hidden by publisher layout while excluding its hidden prose.
          if(!['img','image','svg'].includes(el.localName)) {
            const artwork=Array.from(el.querySelectorAll('img,svg')).filter(image=>!image.parentElement?.closest('svg'));
            for(const image of artwork)walk(image);return;
          }
        }
        if(el.getAttribute('epub:type')?.includes('pagebreak')||el.getAttribute('role')==='doc-pagebreak') return;
        collectAnchors(el);
        const tag=el.localName.toLowerCase();
        if(tag==='img'||tag==='image') {addImage(el);return;}
        if(tag==='svg'&&!el.querySelector('image')) {
          const view=(el.getAttribute('viewBox')||'').split(/[\s,]+/).map(Number);
          const content=DOMPurify.sanitize(new XMLSerializer().serializeToString(el),{USE_PROFILES:{svg:true},FORBID_TAGS:['script','foreignObject','use'],FORBID_ATTR:['href','xlink:href']});
          const url=URL.createObjectURL(new Blob([content],{type:'image/svg+xml'}));urls.push(url);
          const size={width:parseFloat(el.getAttribute('width')||'')||view[2]||0,height:parseFloat(el.getAttribute('height')||'')||view[3]||0};
          if(isMeaningfulImage(el,size.width,size.height)) push({kind:'image',html:'',text:'',src:url,imageHref:`${path}#svg-${blocks.length}`,alt:el.querySelector('title')?.textContent||'Image',meaningful:true,intrinsicWidth:size.width,intrinsicHeight:size.height});
          return;
        }
        if(tag==='hr') {push({kind:'separator',html:'',text:'',semanticValue:'scene-break'});return;}
        if(tag==='figcaption') return;
        if(/^(p|h[1-6]|li|blockquote|pre|dt|dd)$/.test(tag)) {
          const kind:ReadingBlock['kind']=tag.startsWith('h')?'heading':tag==='blockquote'?'quote':'paragraph';
          const newSegment=()=>{const element=doc.createElement('span');if(el.getAttribute('style'))element.setAttribute('style',el.getAttribute('style')!);return element;};
          let segment=newSegment();
          const flush=()=>{
            const text=(segment.textContent||'').replace(/\s+/g,' ').trim();
            if(text) push({kind,text,html:sanitize(segment.getAttribute('style')?segment.outerHTML:segment.innerHTML),level:kind==='heading'?Number(tag[1]):undefined},Array.from(segment.querySelectorAll('[id]')).map(a=>a.id));
            segment=newSegment();
          };
          const inline=(node:Node,chain:Element[]=[]) => {
            if(node.nodeType===3) {
              let parent:Element=segment;
              for(const ancestor of chain) {const clone=ancestor.cloneNode(false) as Element;parent.appendChild(clone);parent=clone;}
              parent.appendChild(node.cloneNode());return;
            }
            if(node.nodeType!==1)return;
            const child=node as Element;
            if(child.hasAttribute('hidden')||child.getAttribute('aria-hidden')==='true') return;
            if((child.hasAttribute('data-reader-hidden')||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(child.getAttribute('style')||''))&&!['img','svg','image'].includes(child.localName)) {
              flush();walk(child);return;
            }
            if(child.getAttribute('epub:type')?.includes('pagebreak')||child.getAttribute('role')==='doc-pagebreak') return;
            if(['img','svg','image'].includes(child.localName)) {flush();walk(child);return;}
            if(child.localName==='a') {
              const href=child.getAttribute('href')||'';
              if(href&&!/^(?:https?:|mailto:)/i.test(href)) try {
                const [file,fragment]=href.split('#');child.setAttribute('data-reader-href',`${file?resolveArchivePath(path,file):path}${fragment?'#'+fragment:''}`);child.removeAttribute('href');
              }catch{child.removeAttribute('href');}
              else if(href) {child.setAttribute('target','_blank');child.setAttribute('rel','noopener noreferrer');}
            }
            if(child.localName==='br') {let parent:Element=segment;for(const ancestor of chain){const clone=ancestor.cloneNode(false) as Element;parent.appendChild(clone);parent=clone;}parent.appendChild(child.cloneNode(false));return;}
            if(child.id)pendingAnchors.push(child.id);
            Array.from(child.childNodes).forEach(n=>inline(n,[...chain,child]));
          };
          Array.from(el.childNodes).forEach(n=>inline(n));flush();return;
        }
        for(const node of Array.from(el.childNodes)) {
          if(node.nodeType===1) walk(node as Element);
          else if(node.nodeType===3) {const text=(node.textContent||'').replace(/\s+/g,' ').trim();if(text)push({kind:'paragraph',text,html:sanitize(text)});}
        }
      };
      const start=blocks.length;walk(body);
      if(blocks.length===start) push({kind:'separator',html:'',text:'',semanticValue:'pause'});
    }
    const toc:TocEntry[]=[]; const baseBook={blocks,spine};
    const nav=[...manifest.values()].find(m=>m.properties.split(/\s+/).includes('nav'));
    if(nav&&files[nav.path]) {
      const doc=xml(read(nav.path),'navigation');
      const root=localElements(doc,'nav').find(n=>(n.getAttribute('epub:type')||n.getAttribute('type')||'').includes('toc'))||localElements(doc,'nav')[0];
      if(root) for(const a of Array.from(root.querySelectorAll('a[href]'))) {
        const raw=a.getAttribute('href')||'';
        try{const [href,fragment]=raw.split('#');const target=`${resolveArchivePath(nav.path,href)}${fragment?'#'+fragment:''}`;const index=resolveLocation(baseBook,target);
          if(index>=0)toc.push({id:`toc-${toc.length}`,label:(a.textContent||'Untitled').trim(),href:target,depth:Math.max(0,Array.from(root.querySelectorAll('ol')).filter(list=>list.contains(a)).length-1),blockIndex:index});
        }catch{warnings.push('A navigation link could not be resolved.');}
      }
    }
    if(!toc.length) {
      const ncx=[...manifest.values()].find(m=>m.mime==='application/x-dtbncx+xml');
      if(ncx&&files[ncx.path]) for(const point of localElements(xml(read(ncx.path),'NCX'),'navPoint')) {
        const raw=point.querySelector('content')?.getAttribute('src')||'';
        try {const [href,fragment]=raw.split('#');const target=`${resolveArchivePath(ncx.path,href)}${fragment?'#'+fragment:''}`;const index=resolveLocation(baseBook,target);let depth=0;let parent=point.parentElement;while(parent?.localName==='navPoint'){depth++;parent=parent.parentElement;}
          if(index>=0)toc.push({id:`toc-${toc.length}`,label:point.querySelector('navLabel text')?.textContent?.trim()||'Untitled',href:target,depth,blockIndex:index});
        }catch{warnings.push('An NCX link could not be resolved.');}
      }
    }
    if(!toc.length) for(const path of spine) {
      const index=blocks.findIndex(b=>b.documentHref===path);const heading=blocks.find(b=>b.documentHref===path&&b.kind==='heading');
      toc.push({id:`toc-${toc.length}`,label:heading?.text||`Section ${toc.length+1}`,href:path,depth:0,blockIndex:index});
    }
    const landmarks:TocEntry[]=[];
    const addLandmark=(label:string,raw:string,base:string)=>{
      try{const[href,fragment]=raw.split('#');const target=(href?resolveArchivePath(base,href):base)+(fragment?'#'+fragment:'');const index=resolveLocation(baseBook,target);if(index>=0)landmarks.push({id:'landmark-'+landmarks.length,label,href:target,depth:0,blockIndex:index});}catch{}
    };
    if(nav&&files[nav.path]) {
      const doc=xml(read(nav.path),'navigation');
      for(const landmarkNav of localElements(doc,'nav').filter(n=>(n.getAttribute('epub:type')||'').includes('landmarks')))for(const a of Array.from(landmarkNav.querySelectorAll('a[href]')))addLandmark(a.textContent?.trim()||'Landmark',a.getAttribute('href')||'',nav.path);
    }
    for(const ref of localElements(opf,'reference'))addLandmark(ref.getAttribute('title')||ref.getAttribute('type')||'Landmark',ref.getAttribute('href')||'',opfPath);
    const hash=await crypto.subtle.digest('SHA-256',input);
    const coverItem=[...manifest.values()].find(m=>m.properties.includes('cover-image'));
    return {id:Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join(''),title:localElements(opf,'title')[0]?.textContent?.trim()||'Untitled book',author:localElements(opf,'creator')[0]?.textContent?.trim()||'Unknown author',language:localElements(opf,'language')[0]?.textContent||'en',blocks,toc,landmarks,spine,images:blocks.filter(b=>b.kind==='image'&&b.meaningful),urls,imageAssetCount:[...manifest.values()].filter(m=>m.mime.startsWith('image/')).length,warnings,cover:coverItem?blobUrl(coverItem.path):undefined};
  } catch(error) {urls.forEach(URL.revokeObjectURL);throw error;}
}
export function closeBook(book:Book) {book.urls.forEach(url=>URL.revokeObjectURL(url));}
