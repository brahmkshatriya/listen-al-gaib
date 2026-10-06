import type { VoiceMode } from '../core/types';
import { LocalTtsEngine, type EngineStatus, type TtsEngine } from './engine';
import { NativeTtsEngine } from './native';
import { ServerTtsEngine } from './server';

export class SpeechEngine implements TtsEngine {
  private engine: TtsEngine;
  private mode: VoiceMode = 'standard';
  private serverUrl = '';
  private generation = 0;
  constructor(private onStatus: (status: EngineStatus) => void) { this.engine = new LocalTtsEngine(this.report(0)); }
  private report(generation: number) {
    return (status: EngineStatus) => { if (generation === this.generation) this.onStatus(status); };
  }
  get status() { return this.engine.status; }
  configure(mode: VoiceMode, serverUrl: string) {
    if (mode === this.mode && serverUrl === this.serverUrl) return;
    this.generation++;
    void this.engine.dispose();
    const report = this.report(this.generation);
    this.mode = mode; this.serverUrl = serverUrl;
    this.engine = mode === 'server' ? new ServerTtsEngine(serverUrl, report) : mode === 'native' ? new NativeTtsEngine(report) : new LocalTtsEngine(report);
    this.engine.setMode?.(mode);
    this.onStatus({ state: 'idle' });
  }
  loadVoice(voice: string, mode?: VoiceMode) { return this.engine.loadVoice(voice, mode); }
  synthesize(text: string) { return this.engine.synthesize(text); }
  cancel() { this.engine.cancel(); }
  dispose() { this.generation++; return this.engine.dispose(); }
}
