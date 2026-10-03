import { useId, useRef, useState } from 'react';

export default function SpeedControl({ speed, onChange }: { speed: number; onChange: (speed: number) => void }) {
  const id = useId();
  const slider = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });
  return <div className="speed-control">
    <button className={`icon-button speed-button ${open ? 'active' : ''}`} popoverTarget={id}
      aria-label={`Reading speed: ${speed.toFixed(1)} times`} aria-expanded={open} aria-haspopup="dialog"
      title="Reading speed" onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setPosition({ left: Math.max(12, Math.min(window.innerWidth - 232, bounds.left + bounds.width / 2 - 110)), bottom: window.innerHeight - bounds.top + 12 });
      }}>{speed.toFixed(1)}×</button>
    <div id={id} className="speed-popup" popover="auto" role="dialog" aria-label="Reading speed"
      style={position} onToggle={event => {
        const isOpen = event.newState === 'open';
        setOpen(isOpen);
        if (isOpen) slider.current?.focus();
      }}>
      <div className="speed-popup-heading"><label htmlFor={`${id}-slider`}>Reading speed</label><span>{speed.toFixed(1)}×</span></div>
      <input ref={slider} id={`${id}-slider`} type="range" aria-label="Reading speed" aria-valuetext={`${speed.toFixed(1)} times`}
        min="0.6" max="2" step="0.1" value={speed} onChange={event => onChange(Number(event.target.value))}/>
      <div className="speed-popup-limits"><span>0.6×</span><span>2.0×</span></div>
    </div>
  </div>;
}
