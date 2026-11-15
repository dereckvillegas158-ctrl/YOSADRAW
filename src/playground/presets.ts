import type { EngineSettings } from '../filters';

export const PRESETS: { id: string; label: string; s: EngineSettings }[] = [
  { id: 'none', label: 'Sin asistencia', s: { streamLine: 0, stabilization: 0, motionFiltering: 0 } },
  { id: 'sketch', label: 'Boceto', s: { streamLine: 12, stabilization: 10, motionFiltering: 0 } },
  { id: 'lineart', label: 'Line art', s: { streamLine: 40, stabilization: 35, motionFiltering: 20 } },
  { id: 'lettering', label: 'Lettering', s: { streamLine: 65, stabilization: 25, motionFiltering: 10 } },
  { id: 'tremor', label: 'Mano temblorosa', s: { streamLine: 25, stabilization: 80, motionFiltering: 60 } },
  { id: 'max', label: 'Máximo', s: { streamLine: 100, stabilization: 100, motionFiltering: 100 } },
];

export function presetFor(s: EngineSettings): string {
  const p = PRESETS.find(p => p.s.streamLine === s.streamLine && p.s.stabilization === s.stabilization && p.s.motionFiltering === s.motionFiltering);
  return p ? p.id : 'custom';
}
