const CACHE='pixel-studio-v3-perfect-pixel-release';
const FILES=['./','./index.html','./style.css','./ui.css','./app.js','./engine.js','./ase.js','./gif.js','./gestures.js','./dialogs.js','./pixel-import.js','./pixel-import.css','./pixel-worker.js','./perfect-pixel.js','./perfect-pixel-LICENSE.txt','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Keep installed assets together; only replace an open version after saving.
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;const url=new URL(event.request.url),scope=new URL('./',self.location.href);if(!FILES.some(f=>new URL(f,scope).pathname===url.pathname))return;event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(event.request,{ignoreSearch:true});return cached||fetch(event.request);}));});
