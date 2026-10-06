// The service worker owns the native ports. Page reloads and focus changes never stop them.
const servers = new Map();
const trusted = url => {
  try {
    const parsed = new URL(url);
    return (parsed.origin === 'https://brahmkshatriya.github.io' && parsed.pathname.startsWith('/reader/')) ||
      (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
  } catch { return false; }
};
function start(tabId) {
  if (servers.has(tabId)) return servers.get(tabId).ready;
  const port = chrome.runtime.connectNative('com.listen_al_gaib.gpu');
  const state = { port, controllers: new Set() };
  state.ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error('GPU server startup timed out. Check the native helper installation.')); port.disconnect(); }, 300000);
    port.onMessage.addListener(message => {
      clearTimeout(timeout);
      if (message.error || !message.url || !message.token) {
        reject(new Error(message.error || 'Invalid GPU helper response')); port.disconnect(); return;
      }
      // Only accept the loopback endpoint created by our helper.
      const url = new URL(message.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
        reject(new Error('Invalid GPU server address')); port.disconnect(); return;
      }
      state.url = url.origin + '/v1/audio/speech'; state.token = message.token;
      state.device = message.device || 'Native GPU'; resolve(state);
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      const reason = chrome.runtime.lastError?.message;
      if (servers.get(tabId) === state) servers.delete(tabId);
      for (const controller of state.controllers) controller.abort();
      reject(new Error(`Install the native helper from the README, or use your server or WASM.${reason ? ` ${reason}` : ''}`));
    });
    port.postMessage({ type: 'start' });
  });
  servers.set(tabId, state);
  return state.ready;
}
async function handle(message, tabId) {
  if (message.type === 'ping') return { available: true };
  const state = await start(tabId);
  if (message.type === 'start') return { device: state.device };
  if (typeof message.text !== 'string' || !message.text.length || message.text.length > 12000 ||
    !['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'bf_emma', 'bm_george'].includes(message.voice)) throw new Error('Invalid speech request');
  const controller = new AbortController(); state.controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(state.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ model: 'kokoro', input: message.text, voice: message.voice, response_format: 'wav', speed: 1 }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Local GPU server returned HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    return { wav: btoa(binary) };
  } finally { clearTimeout(timeout); state.controllers.delete(controller); }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab || sender.frameId !== 0 || !trusted(sender.url) || !['ping', 'start', 'synthesize'].includes(message.type)) return false;
  handle(message, sender.tab.id).then(reply, error => reply({ error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  const state = servers.get(tabId);
  if (!state) return;
  servers.delete(tabId);
  for (const controller of state.controllers) controller.abort();
  state.port.disconnect();
});
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'https://brahmkshatriya.github.io/reader/' });
});
