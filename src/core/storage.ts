import { openDB } from 'idb';
import type { SavedState } from './types';
const database = () => openDB('listen-al-gaib', 1, { upgrade(db) {
  db.createObjectStore('books', { keyPath: 'id' });
  db.createObjectStore('progress'); db.createObjectStore('preferences'); db.createObjectStore('model-files');
}});
export interface LibraryBook { id: string; title: string; author: string; blob: Blob; added: number; lastOpened: number; cover?: Blob; blockCount?: number }
export async function saveBook(book: LibraryBook) { const db = await database(); await db.put('books', book); db.close(); }
export async function getBooks(): Promise<LibraryBook[]> { const db = await database(); const books = await db.getAll('books'); db.close(); return books.sort((a,b) => b.lastOpened-a.lastOpened); }
export async function deleteBook(id: string) { const db = await database(); const tx=db.transaction(['books','progress'],'readwrite'); await tx.objectStore('books').delete(id); await tx.objectStore('progress').delete(id); await tx.done; db.close(); }
export async function saveProgress(id: string, state: SavedState) { const db=await database(); await db.put('progress',state,id); db.close(); }
export async function getProgress(id: string): Promise<SavedState | undefined> { const db=await database(); const state=await db.get('progress',id); db.close(); return state; }
export async function saveLastBook(id: string) { const db=await database(); await db.put('preferences',id,'last-book'); db.close(); }
export async function getLastBook(): Promise<string|undefined> { const db=await database(); const id=await db.get('preferences','last-book'); db.close(); return id; }
export async function getSpeechDownloads(voice:string) {
  // Inspect keys only: opening this dialog must not read large model buffers into memory.
  const db=await database();let keys:string[];
  try{keys=(await db.getAllKeys('model-files')).map(String);}finally{db.close();}
  if('caches' in globalThis){
    const names=await caches.keys().catch(()=>[]);
    for(const name of names.filter(name=>name==='kokoro-voices'||name.startsWith('listen-shell-'))){
      const cache=await caches.open(name);keys.push(...(await cache.keys()).map(request=>request.url));
    }
  }
  const modelRoot='/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/';
  return {
    standard:keys.some(key=>key.includes(modelRoot)&&/\/onnx\/model_quantized\.onnx(?:\?|$)/.test(key)),
    voice:keys.some(key=>key.includes(modelRoot)&&key.split('?')[0].endsWith(`/voices/${voice}.bin`)),
    runtime:keys.some(key=>/\/ort-wasm[^/]*\.wasm(?:\?|$)/.test(key)),
  };
}
// Transformers.js custom cache: model weights, tokenizer and voice binaries remain on this device.
export const modelCache = {
  async match(request: Request | string): Promise<Response | undefined> {
    const db=await database(); const value=await db.get('model-files',typeof request==='string'?request:request.url); db.close();
    return value ? new Response(value.bytes,{status:200,headers:value.headers}) : undefined;
  },
  async put(request: Request | string, response: Response) {
    const value={bytes:await response.clone().arrayBuffer(),headers:Array.from(response.headers.entries())};
    const db=await database(); await db.put('model-files',value,typeof request==='string'?request:request.url); db.close();
  }
};
