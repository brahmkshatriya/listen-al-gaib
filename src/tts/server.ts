import type { EngineStatus, TtsAudio, TtsEngine } from './engine';

/** Accept a server base URL or the full OpenAI-compatible speech endpoint. */
export function speechEndpoint(value: string): URL {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid speech server URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS server URL without credentials, a query, or a fragment.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/audio/speech') ? path : `${path}${path.endsWith('/v1') ? '' : '/v1'}/audio/speech`;
  return url;
}

/** Decode uncompressed WAV without creating an AudioContext for every passage. */
export function decodeWav(buffer: ArrayBuffer): TtsAudio {
  const view = new DataView(buffer);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  const invalid = () => new Error('The speech server must return an uncompressed PCM or float WAV.');
  if (buffer.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw invalid();
  let format = 0, channels = 0, sampleRate = 0, bits = 0, stride = 0;
  let start = 0, length = 0;
  for (let offset = 12; offset + 8 <= buffer.byteLength;) {
    const size = view.getUint32(offset + 4, true), body = offset + 8;
    if (body + size > buffer.byteLength) throw invalid();
    if (tag(offset) === 'fmt ' && size >= 16) {
      format = view.getUint16(body, true); channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true); stride = view.getUint16(body + 12, true); bits = view.getUint16(body + 14, true);
    } else if (tag(offset) === 'data') { start = body; length = size; }
    offset = body + size + (size % 2);
  }
  if (!start || !length || channels < 1 || channels > 8 || sampleRate < 8000 || sampleRate > 192000 ||
    !((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && bits === 32)) ||
    stride !== channels * bits / 8 || length % stride) throw invalid();
  const samples = new Float32Array(length / stride);
  for (let frame = 0; frame < samples.length; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const offset = start + frame * stride + channel * bits / 8;
      const sample = format === 3 ? view.getFloat32(offset, true) : bits === 8 ? (view.getUint8(offset) - 128) / 128 :
        bits === 16 ? view.getInt16(offset, true) / 32768 : bits === 32 ? view.getInt32(offset, true) / 2147483648 :
        ((view.getUint8(offset) | view.getUint8(offset + 1) << 8 | view.getUint8(offset + 2) << 16) << 8 >> 8) / 8388608;
      if (!Number.isFinite(sample)) throw invalid();
      sum += sample;
    }
    samples[frame] = Math.max(-1, Math.min(1, sum / channels));
  }
  return { data: samples, sampleRate };
}

export class ServerTtsEngine implements TtsEngine {
  status: EngineStatus = { state: 'idle' };
  private voice = 'af_heart';
  private epoch = 0;
  private requests = new Set<AbortController>();
  // Keep inference in reading order instead of sending twelve GPU jobs at once.
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private url: string, private onStatus: (status: EngineStatus) => void, private token?: string, private device = 'Server') {}
  async loadVoice(voice: string) {
    speechEndpoint(this.url);
    this.voice = voice;
    this.status = { state: 'ready', device: this.device }; this.onStatus(this.status);
  }
  synthesize(text: string): Promise<TtsAudio> {
    const epoch = this.epoch, voice = this.voice;
    const job = this.tail.catch(() => {}).then(async () => {
      if (epoch !== this.epoch) throw new DOMException('Cancelled', 'AbortError');
      const controller = new AbortController(); this.requests.add(controller);
      const timeout = setTimeout(() => controller.abort(new Error('Speech server timed out after two minutes.')), 120000);
      this.onStatus(this.status = { state: 'ready', device: this.device, generating: text });
      try {
        const response = await fetch(speechEndpoint(this.url), {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, signal: controller.signal,
          body: JSON.stringify({ model: 'kokoro', input: text, voice, response_format: 'wav', speed: 1 }),
        });
        if (!response.ok) throw new Error(`Speech server returned HTTP ${response.status}. Check the URL and server configuration.`);
        const audio = decodeWav(await response.arrayBuffer());
        if (epoch !== this.epoch) throw new DOMException('Cancelled', 'AbortError');
        return audio;
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error instanceof TypeError) throw new Error('Cannot reach the speech server. Check its URL, CORS settings, and browser network permissions. You can also choose WASM in voice settings.');
        throw error;
      } finally {
        clearTimeout(timeout); this.requests.delete(controller);
        if (epoch === this.epoch) this.onStatus(this.status = { state: 'ready', device: this.device });
      }
    });
    this.tail = job; return job;
  }
  cancel() {
    this.epoch++;
    for (const request of this.requests) request.abort(new DOMException('Cancelled', 'AbortError'));
    this.requests.clear(); this.tail = Promise.resolve();
  }
  async dispose() { this.cancel(); }
}
