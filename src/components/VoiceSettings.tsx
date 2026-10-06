import { Check, Cpu, Zap, Server } from 'lucide-react';
import { useState } from 'react';
import type { VoiceMode } from '../core/types';
import { requestServerAccess } from '../extension';

export default function VoiceSettings({ voices, voice: initialVoice, mode: initialMode, serverUrl: initialUrl, nativeSupported, onDone }: {
  voices: Array<{ id: string; name: string; detail: string }>;
  voice: string; mode: VoiceMode; serverUrl: string; nativeSupported: boolean;
  onDone: (voice: string, mode: VoiceMode, serverUrl: string) => void;
}) {
  const [voice, onVoice] = useState(initialVoice);
  const [mode, onMode] = useState(initialMode);
  const [serverUrl, setServerUrl] = useState(initialUrl);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const options = [
    ...(nativeSupported ? [{ id: 'native' as const, name: 'Native GPU', detail: 'Starts your local GPU server', icon: Zap }] : []),
    { id: 'standard' as const, name: 'WASM', detail: 'Runs locally on your CPU', icon: Cpu },
    { id: 'server' as const, name: 'Your server', detail: 'Use a speech server URL', icon: Server },
  ];
  const save = async () => {
    setError(''); setSaving(true);
    try {
      if (mode === 'server') await requestServerAccess(serverUrl);
      onDone(voice, mode, serverUrl.trim());
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save speech settings.'); }
    finally { setSaving(false); }
  };
  return <>
    <fieldset className="voice-mode-picker">
      <legend>Generation</legend>
      <div className="voice-mode-options">
        {options.map(option => <label className={`voice-mode-option ${mode === option.id ? 'selected' : ''}`} key={option.id}>
          <input className="voice-mode-radio" type="radio" name="voice-mode" value={option.id} checked={mode === option.id} onChange={() => { onMode(option.id); setError(''); }}/>
          <option.icon size={18}/><span><strong>{option.name}</strong><small>{option.detail}</small></span>
          <span className="mode-indicator">{mode === option.id && <Check size={12}/>}</span>
        </label>)}
      </div>
    </fieldset>
    {mode === 'native' && <p className="voice-backend-note">Requires the native helper installed on this computer. The extension starts a local PyTorch GPU server when you press Play and stops it when this tab closes. <a href="https://github.com/brahmkshatriya/reader#native-gpu-extension" target="_blank" rel="noreferrer">Setup instructions</a>.</p>}
    {!nativeSupported && <p className="voice-backend-note">Native GPU narration needs the desktop extension and helper. You can always use your own server or WASM here.</p>}
    {mode === 'server' && <div className="voice-server-settings">
      <label htmlFor="speech-server">Speech server URL</label>
      <input id="speech-server" type="url" placeholder="http://localhost:8880" value={serverUrl} onChange={event => setServerUrl(event.target.value)} aria-describedby="speech-server-note"/>
      <p id="speech-server-note" className="voice-backend-note">Use a Kokoro server with an OpenAI-compatible /v1/audio/speech endpoint. Narrated book text is sent to this server. It must allow this reader’s origin through CORS.</p>
    </div>}
    {error && <p role="alert">{error}</p>}
    <div className="voice-picker-heading">Voice</div>
    <div className="voice-picker-list">{voices.map(option => <button className={`voice-choice ${voice === option.id ? 'selected' : ''}`} key={option.id} aria-pressed={voice === option.id} onClick={() => onVoice(option.id)}>
      <img className="voice-portrait" src={`${import.meta.env.BASE_URL}voices/${option.id}.svg`} alt="" width={44} height={44}/>
      <span className="voice-choice-copy"><strong>{option.name}</strong><small>{option.detail}</small></span>
      <span className="voice-choice-check">{voice === option.id && <Check size={16}/>}</span>
    </button>)}</div>
    <button className="primary-button full-width voice-done" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Done'}</button>
  </>;
}
