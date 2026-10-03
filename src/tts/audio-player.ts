import type { TtsAudio } from './engine';

export interface PreparedAudio { url: string; bytes: number; duration: number }
export interface AudioOutput {
  unlock(): Promise<void>;
  play(audio: PreparedAudio, speed: number, paused: boolean): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  setSpeed(speed: number): void;
  stop(): void;
  dispose(): Promise<void>;
}

export function encodeWav(audio: TtsAudio): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + audio.data.length * 2);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, audio.data.length * 2, true);
  for (let i = 0; i < audio.data.length; i++) {
    const sample = Math.max(-1, Math.min(1, audio.data[i]));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export function prepareAudio(audio: TtsAudio): PreparedAudio {
  const wav = encodeWav(audio);
  return { url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })), bytes: wav.byteLength, duration: audio.data.length / audio.sampleRate };
}

/** Native pitch-preserving time stretching, routed through Web Audio for stable device-local output. */
export class PitchPreservingAudioPlayer implements AudioOutput {
  private media = new Audio();
  private context?: AudioContext;
  private node?: MediaElementAudioSourceNode;
  private unlocked = false;
  private paused = false;
  private generation = 0;
  private playRequest = 0;
  private finish?: () => void;
  private onPlaying = () => { if (this.finish && !this.paused) this.playing(); };
  constructor(private playing: () => void) {
    this.media.preload = 'auto';
    this.media.setAttribute('playsinline', '');
    const media = this.media as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
    media.preservesPitch = true;
    media.mozPreservesPitch = true;
    media.webkitPreservesPitch = true;
    this.media.addEventListener('playing', this.onPlaying);
    // Give the reusable media element a stable document lifetime through voice changes.
    this.media.hidden = true;
    document.body.append(this.media);
  }
  async unlock() {
    const generation = this.generation;
    this.context ??= new AudioContext();
    if (!this.node) { this.node = this.context.createMediaElementSource(this.media); this.node.connect(this.context.destination); }
    const resume = this.context.resume();
    if (this.unlocked) { await resume; return; }
    // Start the media element during the user's gesture, before model/inference awaits (including Safari).
    const prime = prepareAudio({ data: new Float32Array(240), sampleRate: 24000 });
    this.media.src = prime.url;
    try {
      await Promise.all([resume, this.media.play()]);
      if (generation === this.generation) this.unlocked = true;
    } catch (error) {
      if (generation === this.generation) throw error;
    } finally {
      if (generation === this.generation) this.media.pause();
      URL.revokeObjectURL(prime.url);
    }
  }
  play(audio: PreparedAudio, speed: number, paused: boolean): Promise<void> {
    this.stop(); this.paused = paused;
    return new Promise((resolve, reject) => {
      const settle = (error?: Error) => {
        this.media.removeEventListener('ended', ended); this.media.removeEventListener('error', failed);
        if (this.finish === finish) this.finish = undefined;
        if (error) reject(error); else resolve();
      };
      const finish = () => settle();
      const ended = () => settle();
      const failed = () => settle(new Error('The generated speech audio could not be played.'));
      this.finish = finish;
      this.media.addEventListener('ended', ended); this.media.addEventListener('error', failed);
      this.media.src = audio.url; this.setSpeed(speed);
      if (!paused) {
        const request = ++this.playRequest;
        this.media.play().catch(error => {
          if (this.finish === finish && request === this.playRequest) settle(error);
        });
      }
    });
  }
  pause() { this.playRequest++; this.paused = true; this.media.pause(); }
  async resume() {
    const generation = this.generation;
    const request = ++this.playRequest;
    this.paused = false;
    try {
      await this.context?.resume();
      if (generation === this.generation && request === this.playRequest && !this.paused && this.finish) await this.media.play();
    } catch (error) {
      if (generation === this.generation && request === this.playRequest) throw error;
    }
  }
  setSpeed(speed: number) { this.media.defaultPlaybackRate = speed; this.media.playbackRate = speed; this.media.preservesPitch = true; }
  stop() {
    this.generation++; this.playRequest++; this.media.pause();
    const finish = this.finish; this.finish = undefined; finish?.();
    // Keep the element loaded until its next source is assigned. Calling load() here
    // queues an abort that can interrupt the next voice's play() request in Chrome.
  }
  async dispose() {
    this.stop(); this.media.removeEventListener('playing', this.onPlaying);
    this.media.removeAttribute('src'); this.media.load();
    this.node?.disconnect();
    try { await this.context?.close(); } finally { this.media.remove(); }
  }
}
