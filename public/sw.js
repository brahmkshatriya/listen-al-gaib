const ROOT=new URL('./',self.registration.scope).href;
const CACHE=`listen-shell-v3-${new URL(ROOT).pathname}`;
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll([ROOT,new URL('favicon.svg',ROOT).href,new URL('demo/alice.epub',ROOT).href]);self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('listen-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET'||!request.url.startsWith(ROOT))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(request.mode==='navigate'){try{const response=await fetch(request);if(response.ok){const copy=response.clone();event.waitUntil(cache.put(ROOT,copy)); return response;}}catch{}return(await cache.match(ROOT))||Response.error();}
    const cached=await cache.match(request);if(cached)return cached;
    try{const response=await fetch(request);if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));}return response;}
    catch(error){if(request.mode==='navigate')return (await cache.match(ROOT))||Response.error();throw error;}
  })());
});
