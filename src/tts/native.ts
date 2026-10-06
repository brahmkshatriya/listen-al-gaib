import type { EngineStatus, TtsAudio, TtsEngine } from './engine';
import { extensionRequest } from '../extension';
import { decodeWav } from './server';

/** The extension owns the server for the tab; disposing playback never stops it. */
export class NativeTtsEngine implements TtsEngine {
  status: EngineStatus = { state: 'idle' };
  private voice = 'af_heart';
  private epoch = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private starting?: Promise<void>;
  constructor(private onStatus: (status: EngineStatus) => void) {}
  private report(status: EngineStatus) { this.status = status; this.onStatus(status); }
  async loadVoice(voice: string) {
    this.voice = voice;
    if (this.status.state === 'ready') return;
    if (!this.starting) {
      const epoch = this.epoch;
      this.report({ state: 'loading', message: 'Starting local GPU server… First use downloads the model.' });
      this.starting = extensionRequest('start', {}, 300000).then(result => {
        if (epoch !== this.epoch) throw new DOMException('Cancelled', 'AbortError');
        this.report({ state: 'ready', device: result.device || 'Native GPU' });
      }).catch(error => {
        if (epoch === this.epoch) this.report({ state: 'error', message: error.message });
        throw error;
      }).finally(() => { this.starting = undefined; });
    }
    await this.starting;
  }
  synthesize(text: string): Promise<TtsAudio> {
    const epoch = this.epoch, voice = this.voice;
    const job = this.tail.catch(() => {}).then(async () => {
      if (epoch !== this.epoch) throw new DOMException('Cancelled', 'AbortError');
      this.report({ ...this.status, generating: text });
      try {
        const result = await extensionRequest('synthesize', { text, voice });
        if (epoch !== this.epoch) throw new DOMException('Cancelled', 'AbortError');
        if (!result.wav) throw new Error('GPU server returned no audio.');
        return decodeWav(Uint8Array.from(atob(result.wav), c => c.charCodeAt(0)).buffer);
      } finally { if (epoch === this.epoch) this.report({ ...this.status, generating: undefined }); }
    });
    this.tail = job; return job;
  }
  cancel() {
    this.epoch++; this.tail = Promise.resolve();
    if (this.status.state === 'loading') this.report({ state: 'idle' });
  }
  async dispose() { this.cancel(); }
}
