const svg = (body: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Iconos de herramientas (trazo 1.6 sobre 24×24, reconocibles a 20 px). */
export const TOOL_ICONS: Record<string, string> = {
  'vector-edit': svg('<path d="M4 18C8 6 14 20 20 6"/><rect x="2.5" y="16.5" width="3" height="3" fill="currentColor"/><rect x="10.5" y="10.5" width="3" height="3" fill="currentColor"/><rect x="18.5" y="4.5" width="3" height="3" fill="currentColor"/>'),
  brush: svg('<path d="M4 20c2.5 0 4-1.2 4-3.4 0-1.2-.9-2.1-2-2.1s-2 .9-2 2.2V20z"/><path d="M8.6 14.6 19.2 4a1.6 1.6 0 0 1 2.3 2.3L10.9 16.9"/>'),
  pencil: svg('<path d="M4 20l1.2-4.4L16.6 4.2a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.4 18.8z"/><path d="m14.8 6 3.2 3.2M4 20l4.4-1.2"/>'),
  pen: svg('<path d="M12 21v-4"/><path d="M8 17h8l-1.5-7L12 3 9.5 10z"/><circle cx="12" cy="11" r="1.2"/>'),
  marker: svg('<path d="m14 4 6 6-8.5 8.5H6v-5.5z"/><path d="M6 18.5 4 20.5M11 7l6 6"/><path d="M3 21h8" stroke-width="2.4"/>'),
  airbrush: svg('<path d="M5 15h7l3-3V8l-3-3H9"/><path d="M12 15v5h-3v-5M15 10h4M17 8v4"/><circle cx="20.5" cy="5" r=".7" fill="currentColor"/><circle cx="21" cy="9" r=".7" fill="currentColor"/>'),
  watercolor: svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9 15a3 3 0 0 0 3 3"/>'),
  oil: svg('<path d="M14.5 3h3v6h-3z"/><path d="M14 9h4l-.5 3h-3z"/><path d="M15.5 12v3.5c0 1.7-1.3 3-3 3H8"/><path d="M3 18.5c1.5-2 4-2 5 0s-1 3-2.5 2"/>'),
  smudge: svg('<path d="M9 21v-6.5a1.5 1.5 0 0 1 3 0V12a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0v3.5a4.5 4.5 0 0 1-4.5 4.5H9"/><path d="M9 14.5V5.5a1.5 1.5 0 0 0-3 0v9.5"/><path d="M3 9h2M3 12h2" stroke-dasharray="1 2"/>'),
  eraser: svg('<path d="m7 20-3.3-3.3a1.8 1.8 0 0 1 0-2.6l9.4-9.4a1.8 1.8 0 0 1 2.6 0l4.6 4.6a1.8 1.8 0 0 1 0 2.6L12.6 20z"/><path d="M8.5 9.6 15 16.1M7 20h13"/>'),
  bucket: svg('<path d="m11 3 8 8-7 7a2.1 2.1 0 0 1-3 0l-5-5a2.1 2.1 0 0 1 0-3z"/><path d="M4.5 11.5h13"/><path d="M20 15s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z"/>'),
  gradient: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M7 7h.01M7 12h.01M7 17h.01M11 9.5h.01M11 14.5h.01M15 7h.01M15 12h.01M15 17h.01" stroke-width="2.4"/>'),
  'select-rect': svg('<path d="M4 7V4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4"/>'),
  'select-ellipse': svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5" stroke-dasharray="3 2.4"/>'),
  lasso: svg('<path d="M7 17.5C4.5 16.3 3 14.3 3 12c0-4.4 4-8 9-8s9 3.6 9 8-4 8-9 8c-1 0-2-.1-2.9-.4"/><path d="M7 17.5c0 1.7 1.3 3 3 3"/><circle cx="7.5" cy="17" r="1.4"/>'),
  wand: svg('<path d="m4 20 10-10"/><path d="M15 3v2M15 9v2M11 7h2M17 7h2M18.5 3.5 17.2 4.8M12.8 9.2l-1.3 1.3M18.5 10.5l-1.3-1.3"/>'),
  shapes: svg('<rect x="3.5" y="11" width="9" height="9" rx="1"/><circle cx="16.5" cy="7.5" r="4"/><path d="M13 20.5h7.5L16.8 14z"/>'),
  ruler: svg('<path d="m3 16.5 13.5-13.5 4.5 4.5L7.5 21z"/><path d="m7 12.5 1.8 1.8M9.6 9.9l2.6 2.6M12.2 7.3l1.8 1.8M14.8 4.7l2.6 2.6"/>'),
  symmetry: svg('<path d="M12 3v18" stroke-dasharray="2 2.4"/><path d="M9 6 4 12l5 6zM15 6l5 6-5 6z"/>'),
  transform: svg('<rect x="5" y="5" width="14" height="14" stroke-dasharray="2.5 2"/><rect x="3" y="3" width="4" height="4" fill="currentColor" stroke="none"/><rect x="17" y="3" width="4" height="4" fill="currentColor" stroke="none"/><rect x="3" y="17" width="4" height="4" fill="currentColor" stroke="none"/><rect x="17" y="17" width="4" height="4" fill="currentColor" stroke="none"/>'),
  eyedropper: svg('<path d="m14.5 6.5 3 3"/><path d="M19 3a2.1 2.1 0 0 1 2 2c0 .6-.2 1.1-.6 1.5l-2.4 2.4-4-4 2.4-2.4c.4-.4.9-.5 1.5-.5z"/><path d="m13.5 7.5-8.8 8.8a1.6 1.6 0 0 0-.4.7L3.5 20.5l3.5-.8c.3-.1.5-.2.7-.4l8.8-8.8"/>'),
  hand: svg('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.6-2.2L4.3 15a1.5 1.5 0 0 1 2.2-2L8 14.5V12"/>'),
  'rotate-view': svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/><circle cx="12" cy="12" r="1.6"/>'),
};

/** Iconos pequeños para opciones (tipos de forma, modos). */
export const OPTION_ICONS: Record<string, string> = {
  rect: svg('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="8" ry="6"/>'),
  line: svg('<path d="M5 19 19 5"/>'),
  polygon: svg('<path d="m12 3.5 8 5.8-3 9.2H7l-3-9.2z"/>'),
  star: svg('<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>'),
  arrow: svg('<path d="M4 20 18 6M10 6h8v8"/>'),
};
