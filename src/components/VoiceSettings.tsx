import { Check, Cpu, Zap } from 'lucide-react';
import { useState } from 'react';
import type { VoiceMode } from '../core/types';

export default function VoiceSettings({ voices, voice: initialVoice, mode: initialMode, gpuSupported, onDone }: {
  voices: Array<{ id: string; name: string; detail: string }>;
  voice: string; mode: VoiceMode; gpuSupported: boolean;
  onDone: (voice: string, mode: VoiceMode) => void;
}) {
  const [voice, onVoice] = useState(initialVoice);
  const [mode, onMode] = useState(initialMode);
  return <>
    {gpuSupported && <fieldset className="voice-mode-picker">
      <legend>Generation</legend>
      <div className="voice-mode-options">
        {([{ id: 'standard', name: 'Standard', detail: 'Smaller download', icon: Cpu }, { id: 'gpu', name: 'GPU', detail: 'Faster on supported devices', icon: Zap }] as const).map(option => <label className={`voice-mode-option ${mode === option.id ? 'selected' : ''}`} key={option.id}>
          <input className="voice-mode-radio" type="radio" name="voice-mode" value={option.id} checked={mode === option.id} onChange={() => onMode(option.id)}/>
          <option.icon size={18}/><span><strong>{option.name}</strong><small>{option.detail}</small></span>
          <span className="mode-indicator">{mode === option.id && <Check size={12}/>}</span>
        </label>)}
      </div>
    </fieldset>}
    <div className="voice-picker-heading">Voice</div>
    <div className="voice-picker-list">{voices.map(option => <button className={`voice-choice ${voice === option.id ? 'selected' : ''}`} key={option.id} aria-pressed={voice === option.id} onClick={() => onVoice(option.id)}>
      <img className="voice-portrait" src={`${import.meta.env.BASE_URL}voices/${option.id}.svg`} alt="" width={44} height={44}/>
      <span className="voice-choice-copy"><strong>{option.name}</strong><small>{option.detail}</small></span>
      <span className="voice-choice-check">{voice === option.id && <Check size={16}/>}</span>
    </button>)}</div>
    <button className="primary-button full-width voice-done" onClick={() => onDone(voice, gpuSupported ? mode : 'standard')}>Done</button>
  </>;
}
