const svg = (body: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  brush: svg('<path d="M4 20c2.5 0 4-1.2 4-3.4 0-1.2-.9-2.1-2-2.1s-2 .9-2 2.2V20z"/><path d="M8.6 14.6 19.2 4a1.6 1.6 0 0 1 2.3 2.3L10.9 16.9"/>'),
  eraser: svg('<path d="m7 20-3.3-3.3a1.8 1.8 0 0 1 0-2.6l9.4-9.4a1.8 1.8 0 0 1 2.6 0l4.6 4.6a1.8 1.8 0 0 1 0 2.6L12.6 20z"/><path d="M8.5 9.6 15 16.1M7 20h13"/>'),
  hand: svg('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.6-2.2L4.3 15a1.5 1.5 0 0 1 2.2-2L8 14.5V12"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/><circle cx="12" cy="12" r="1.6"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4M11 8.2v5.6M8.2 11h5.6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4M8.2 11h5.6"/>'),
  fit: svg('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  rotL: svg('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>'),
  rotR: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/>'),
  trash: svg('<path d="M4 7h16M9.5 7V4.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V7M6.5 7l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8L17.5 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  import: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'),
  edit: svg('<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="m14.5 7.5 2.9 2.9"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10" stroke-width="2"/>'),
  layout: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M9 9h12"/>'),
  sliders: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
};
