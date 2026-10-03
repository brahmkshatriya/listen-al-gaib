import { useState } from 'react';
import { Activity, ChevronDown, LoaderCircle } from 'lucide-react';
import type { EngineStatus } from '../tts/engine';
import type { PlaybackState, VoiceActivity as ActivityDetails } from '../tts/playback';

export default function VoiceActivity({ engine, playback, activity, buffer, voice, hasBook }: {
  engine: EngineStatus; playback: PlaybackState; activity: ActivityDetails;
  buffer: number | null; voice: string; hasBook: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = playback === 'playing' && buffer === null;
  const showDetails = expanded && !collapsed;
  const downloading = engine.asset && !engine.asset.complete;
  const busy = downloading || engine.state === 'loading' || !!engine.generating || playback === 'loading';
  const heading = engine.state === 'error' ? 'Voice needs attention'
    : downloading ? 'Downloading voice files'
    : engine.state === 'loading' ? engine.message || 'Loading voice model…'
    : buffer !== null ? `Buffering · ${Math.floor(buffer)}s ready`
    : playback === 'loading' ? 'Generating speech…'
    : playback === 'playing' ? `Speaking · ${voice}`
    : engine.generating || activity.pending ? 'Preparing upcoming speech'
    : !hasBook ? 'Open a book to listen'
    : engine.state === 'ready' ? `Paused · ${voice} ready` : 'Local voice ready to start';
  const file = engine.file || engine.asset?.file;
  const preview = engine.state === 'error' ? engine.message || 'Try local voice again'
    : downloading || engine.state === 'loading' ? `${file || 'Kokoro voice model'}${engine.progress !== undefined ? ` · ${Math.round(engine.progress)}%` : ''}`
    : engine.generating ? `Generating: ${engine.generating}`
    : playback === 'playing' ? `Next: ${activity.next || 'End of book'}`
    : activity.current ? `Queued: ${activity.current}` : 'Voice files download on first play';
  return <div className={`voice-activity ${collapsed ? 'is-collapsed' : ''}`}>
    <button className="voice-activity-toggle" aria-label="Voice activity" title={collapsed ? heading : undefined} disabled={collapsed} aria-expanded={showDetails} aria-controls="voice-activity-details" onClick={() => setExpanded(value => !value)}>
      {busy ? <LoaderCircle size={16} className="spin"/> : <Activity size={16}/>}
      {!collapsed && <><span className="voice-activity-summary"><strong role="status">{heading}</strong><span title={preview}>{preview}</span></span>
      <ChevronDown size={14} className={showDetails ? 'activity-chevron expanded' : 'activity-chevron'}/></>}
    </button>
    {showDetails && <section id="voice-activity-details" className="voice-activity-details" aria-label="Voice generation activity">
      <div className="activity-heading"><strong>Voice activity</strong><span>{voice} · {engine.device || 'On device'}</span></div>
      <p className="activity-status">{heading}</p>
      {engine.state === 'loading' && engine.progress !== undefined && <progress aria-label="Voice file download" max={100} value={engine.progress}/>}
      {(file || engine.message) && <div className="activity-file"><span>{downloading ? 'Downloading' : engine.state === 'loading' ? 'Loading' : engine.asset?.cached ? 'Loaded from device' : engine.asset?.complete ? 'Downloaded' : 'Model'}</span><strong>{file || engine.message}</strong></div>}
      <div className="activity-metrics"><span><strong>{activity.ready}</strong> clips ready</span><span><strong>{Math.round(activity.seconds)}s</strong> prepared</span><span><strong>{activity.pending}</strong> queued</span></div>
      <dl className="activity-lines">
        {engine.generating && <div><dt>Generating now</dt><dd>{engine.generating}</dd></div>}
        <div><dt>{playback === 'playing' ? 'Speaking now' : 'Current line'}</dt><dd>{activity.current || 'A pause between passages'}</dd></div>
        <div><dt>Next line</dt><dd>{activity.next || (hasBook ? 'End of book' : 'Open a book to begin')}</dd></div>
      </dl>
    </section>}
  </div>;
}
