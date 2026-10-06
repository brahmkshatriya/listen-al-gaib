import { speechEndpoint } from './tts/server';
const channel = 'listen-al-gaib-gpu-v1';
export interface ExtensionResponse { available?: boolean; device?: string; wav?: string; error?: string }
export function extensionRequest(type: 'ping' | 'start' | 'synthesize', payload: { text?: string; voice?: string } = {}, timeoutMs = 120000): Promise<ExtensionResponse> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('GPU extension did not respond. Check the extension and native helper, or choose your server or WASM.')); }, timeoutMs);
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel || event.data?.direction !== 'response' || event.data?.id !== id) return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data);
    };
    const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
    window.addEventListener('message', receive);
    window.postMessage({ channel, direction: 'request', id, type, ...payload }, location.origin);
  });
}
export async function supportsNativeExtension() {
  try { return !!(await extensionRequest('ping', {}, 1500)).available; } catch { return false; }
}
export async function requestServerAccess(url: string) { speechEndpoint(url); }
