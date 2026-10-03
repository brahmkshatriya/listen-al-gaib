import type { Book, ReadingBlock, ReaderLocation, Settings } from '../core/types';
import { imageAnnouncement, locationAt } from '../core/types';
import { speechSegments, splitSpeech } from '../core/speech-segments';
import { LocalTtsEngine, type EngineStatus, type TtsEngine } from './engine';
import { PitchPreservingAudioPlayer, prepareAudio, type AudioOutput, type PreparedAudio } from './audio-player';
export type PlaybackState = 'paused' | 'loading' | 'playing';
export interface VoiceActivity { current: string; next: string; ready: number; pending: number; seconds: number }
const LOOKAHEAD = 12;
const BUFFER_SECONDS = 12;
const MAX_STARTUP_UNITS = 6;
const MAX_CACHED_UNITS = 24;
const MAX_CACHED_BYTES = 32 * 1024 * 1024;
interface SpeechUnit { location: ReaderLocation; text: string }
interface CacheEntry { promise: Promise<PreparedAudio>; audio?: PreparedAudio; epoch: number }

export class PlaybackController {
  private engine: TtsEngine;
  private output?: AudioOutput;
  private generation = 0;
  private queue = new Map<string, CacheEntry>();
  private protectedKeys = new Set<string>();
  private playingKey?: string;
  private reserveNeeded = true;
  private active = false;
  private paused = false;
  private book?: Book;
  private location?: ReaderLocation;
  private settings?: Settings;
  private cueSegments = new Map<string, string[]>();
  private textCache = new WeakMap<ReadingBlock, string[]>();
  state: PlaybackState = 'paused';
  constructor(private events: {
    onState: (state: PlaybackState) => void;
    onLocation: (location: ReaderLocation) => void;
    onStatus: (status: EngineStatus) => void;
    onError: (message: string) => void;
    onBuffer?: (seconds: number | null) => void;
    onActivity?: (activity: VoiceActivity) => void;
  }, engine?: TtsEngine, output?: AudioOutput) {
    this.engine = engine || new LocalTtsEngine(events.onStatus);
    this.output = output;
  }
  private reportActivity() {
    if (!this.events.onActivity) return;
    let current = ''; let next = '';
    if (this.location && this.book && this.settings) {
      current = this.unitAt(this.location).text;
      let location = this.next(this.location);
      while (location && !next) { next = this.unitAt(location).text; location = this.next(location); }
    }
    const entries = [...this.queue].filter(([key]) => key === this.playingKey || this.protectedKeys.has(key)).map(([, entry]) => entry);
    this.events.onActivity({ current, next, ready: entries.filter(entry => entry.audio).length, pending: entries.filter(entry => !entry.audio).length, seconds: entries.reduce((seconds, entry) => seconds + (entry.audio?.duration || 0) / (this.settings?.speed || 1), 0) });
  }
  private setState(state: PlaybackState) {
    if (this.state !== state) { this.state = state; this.events.onState(state); }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state === 'paused' ? 'paused' : 'playing';
  }
  setBook(book: Book, location: ReaderLocation, settings: Settings) {
    this.stop(); this.clearCache(); this.cueSegments.clear();
    this.book = book; this.settings = settings; this.location = this.normalize(location);
    this.reportActivity();
    this.warmAhead();
  }
  updateSettings(settings: Settings) {
    const voiceChanged = this.settings?.voice !== settings.voice;
    const cueChanged = this.settings?.imageCue !== settings.imageCue;
    const modeChanged = this.settings?.voiceMode !== settings.voiceMode;
    this.settings = settings;
    this.output?.setSpeed(settings.speed);
    this.reportActivity();
    if (voiceChanged || cueChanged || modeChanged) {
      const restart = this.active;
      this.stop(); this.cueSegments.clear();
      if (modeChanged) this.engine.setMode?.(settings.voiceMode);
      if (restart) void this.play();
      else if (!modeChanged) this.warmAhead();
    }
  }
  navigate(location: ReaderLocation, resume = this.active) {
    this.stop(); this.location = this.normalize(location); this.events.onLocation(this.location);
    this.reportActivity();
    if (resume) void this.play();
    else this.warmAhead();
  }
  private warmAhead() {
    if (this.engine.status?.state !== 'ready' || !this.location || !this.settings) return;
    const generation = this.generation;
    void this.engine.loadVoice(this.settings.voice,this.settings.voiceMode).then(() => {
      if (generation === this.generation && this.location) this.prefetch(this.location);
    }).catch(() => { /* Playback will surface errors when requested. */ });
  }
  prepareAudioOutput() {
    this.output ??= new PitchPreservingAudioPlayer(() => { if (!this.paused) this.setState('playing'); });
    return this.output.unlock();
  }
  async play() {
    if (!this.book || !this.location || !this.settings || this.active) return;
    this.output ??= new PitchPreservingAudioPlayer(() => { if (!this.paused) this.setState('playing'); });
    if (this.paused) {
      const generation = this.generation;
      this.paused = false; this.active = true;
      this.setState(this.playingKey ? 'playing' : 'loading');
      try { await this.output.resume(); } catch (error) { if (generation === this.generation) this.fail(error); }
      return;
    }
    this.active = true; this.setState('loading'); const generation = this.generation;
    try {
      await this.output.unlock();
      if (generation !== this.generation) return;
      await this.engine.loadVoice(this.settings.voice,this.settings.voiceMode);
      if (generation !== this.generation) return;
      await this.run(generation);
    } catch (error) { if (generation === this.generation) this.fail(error); }
  }
  private fail(error: unknown) { this.stop(); this.events.onError(error instanceof Error ? error.message : 'Local speech could not start.'); }
  pause() { if (!this.active) return; this.paused = true; this.active = false; this.output?.pause(); this.setState('paused'); }
  stop() {
    this.generation++; this.active = false; this.paused = false;
    this.engine.cancel(); this.output?.stop(); this.playingKey = undefined; this.protectedKeys.clear();
    this.reserveNeeded = true;
    this.events.onBuffer?.(null);
    // Completed audio remains reusable for replay, back/forward, and speed changes; pending stale work is cancelled.
    for (const [key, entry] of this.queue) if (!entry.audio) this.queue.delete(key);
    this.trimCache(); this.setState('paused');
    this.reportActivity();
  }
  toggle() { if (this.active) this.pause(); else void this.play(); }
  private textsAt(index: number): string[] {
    const block = this.book!.blocks[index];
    if (block.kind === 'separator') return [];
    if (block.kind !== 'image') {
      let texts = this.textCache.get(block);
      if (!texts) { texts = speechSegments(block).map(segment => segment.text); this.textCache.set(block, texts); }
      return texts;
    }
    const cue = imageAnnouncement(block, this.settings!.imageCue);
    if (!cue) return [];
    let texts = this.cueSegments.get(cue);
    if (!texts) { texts = splitSpeech(cue).map(segment => segment.text); this.cueSegments.set(cue, texts); }
    return texts;
  }
  private normalize(location: ReaderLocation): ReaderLocation {
    const next = locationAt(this.book!, location.blockIndex);
    const last = Math.max(0, this.textsAt(next.blockIndex).length - 1);
    return { ...next, segmentIndex: Math.min(last, Math.max(0, location.segmentIndex || 0)) };
  }
  private unitAt(location: ReaderLocation): SpeechUnit {
    return { location, text: this.textsAt(location.blockIndex)[location.segmentIndex || 0] || '' };
  }
  private next(location: ReaderLocation): ReaderLocation | undefined {
    const segmentIndex = (location.segmentIndex || 0) + 1;
    if (segmentIndex < this.textsAt(location.blockIndex).length) return { ...location, segmentIndex };
    if (location.blockIndex + 1 < this.book!.blocks.length) return { ...locationAt(this.book!, location.blockIndex + 1), segmentIndex: 0 };
    return undefined;
  }
  private key(unit: SpeechUnit): string {
    // Identical cues can reuse one clip while still announcing once at each actual image position.
    return `${this.book!.id}|${this.settings!.voiceMode}|${this.settings!.voice}|${unit.text}`;
  }
  private audioAt(unit: SpeechUnit): Promise<PreparedAudio> {
    const key = this.key(unit);
    let entry = this.queue.get(key);
    if (entry) { this.queue.delete(key); this.queue.set(key, entry); return entry.promise; }
    const epoch = this.generation;
    entry = { epoch, promise: Promise.resolve(undefined as unknown as PreparedAudio) };
    const current = entry;
    current.promise = this.engine.synthesize(unit.text).then(audio => {
      if (epoch !== this.generation) throw new DOMException('Cancelled', 'AbortError');
      const prepared = prepareAudio(audio);
      current.audio = prepared;
      this.trimCache();
      this.reportActivity();
      return prepared;
    });
    current.promise.catch(() => { if (this.queue.get(key) === current) { this.queue.delete(key); this.reportActivity(); } });
    this.queue.set(key, current);
    return current.promise;
  }
  private prefetch(location: ReaderLocation) {
    this.protectedKeys.clear();
    let next: ReaderLocation | undefined = location;
    let count = 0;
    while (next && count < LOOKAHEAD) {
      const unit = this.unitAt(next);
      if (unit.text) { this.protectedKeys.add(this.key(unit)); this.audioAt(unit); count++; }
      next = this.next(next);
    }
    this.trimCache();
    this.reportActivity();
  }
  private trimCache() {
    let bytes = Array.from(this.queue.values()).reduce((sum, entry) => sum + (entry.audio?.bytes || 0), 0);
    for (const [key, entry] of this.queue) {
      if (this.queue.size <= MAX_CACHED_UNITS && bytes <= MAX_CACHED_BYTES) break;
      if (!entry.audio || key === this.playingKey || this.protectedKeys.has(key)) continue;
      bytes -= entry.audio.bytes; URL.revokeObjectURL(entry.audio.url); this.queue.delete(key);
    }
  }
  private clearCache() { for (const entry of this.queue.values()) if (entry.audio) URL.revokeObjectURL(entry.audio.url); this.queue.clear(); }
  private async bufferAhead(location: ReaderLocation, generation: number) {
    let next: ReaderLocation | undefined = location;let seconds = 0;let count = 0;
    this.events.onBuffer?.(0);
    try {
      while (next && count < MAX_STARTUP_UNITS && seconds < BUFFER_SECONDS) {
        const unit = this.unitAt(next);
        if (unit.text) {
          const audio = await this.audioAt(unit);
          if (generation !== this.generation) return;
          seconds += audio.duration / this.settings!.speed;count++;
          this.events.onBuffer?.(Math.min(BUFFER_SECONDS, seconds));
        }
        next = this.next(next);
      }
    } finally { if (generation === this.generation) this.events.onBuffer?.(null); }
  }
  private async run(generation: number) {
    while (this.location && generation === this.generation) {
      const location = this.location;
      const unit = this.unitAt(location);
      const block = this.book!.blocks[location.blockIndex];
      this.reportActivity();
      if (unit.text) {
        this.playingKey = this.key(unit);
        const needsBuffer = this.engine.status?.device === 'WASM' && (this.reserveNeeded || !this.queue.get(this.playingKey)?.audio);
        // Request in reading order; hold a reserve on CPU rather than arriving at every sentence empty.
        const audio = this.audioAt(unit);
        const upcoming = this.next(location);
        if (upcoming) this.prefetch(upcoming);
        if (this.paused) this.setState('paused');
        else if (needsBuffer || !this.queue.get(this.playingKey)?.audio) this.setState('loading');
        const prepared = await audio;
        if (generation !== this.generation) return;
        if (needsBuffer) await this.bufferAhead(location, generation);
        if (generation !== this.generation) return;
        this.reserveNeeded = false;
        await this.output!.play(prepared, this.settings!.speed, this.paused);
      } else await this.silence(block.kind === 'image' ? 1.4 : 0.35, generation);
      if (generation !== this.generation) return;
      const next = this.next(location);
      if (block.kind === 'image' && unit.text && next?.blockIndex !== location.blockIndex) await this.silence(1.2, generation);
      if (generation !== this.generation) return;
      if (!next) { this.stop(); return; }
      this.location = next; this.events.onLocation(next);
      this.reportActivity();
    }
  }
  private async silence(seconds: number, generation: number) {
    if (generation !== this.generation) return;
    const prepared = prepareAudio({ data: new Float32Array(Math.ceil(24000 * seconds)), sampleRate: 24000 });
    try { await this.output!.play(prepared, 1, this.paused); }
    finally { URL.revokeObjectURL(prepared.url); }
  }
  async dispose() { this.stop(); this.clearCache(); await this.engine.dispose(); await this.output?.dispose(); }
}
