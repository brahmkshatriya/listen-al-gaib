const channel = 'listen-al-gaib-gpu-v1';
window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel || event.data?.direction !== 'request') return;
  const { id, type, text, voice } = event.data;
  if (typeof id !== 'string' || !['ping', 'start', 'synthesize'].includes(type)) return;
  try {
    const result = await chrome.runtime.sendMessage({ type, text, voice });
    window.postMessage({ channel, direction: 'response', id, ...result }, location.origin);
  } catch (error) {
    window.postMessage({ channel, direction: 'response', id, error: error.message }, location.origin);
  }
});
