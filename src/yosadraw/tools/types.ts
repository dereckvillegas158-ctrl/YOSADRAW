import type { BrushLibrary } from '../brush/BrushLibrary';
import type { BrushPreset } from '../brush/BrushPreset';
import type { CanvasEngine, ToolHandler } from '../engine';

export type CategoryId = 'draw' | 'paint' | 'edit' | 'select' | 'geometry' | 'transform' | 'color' | 'view';

export const CATEGORIES: { id: CategoryId; label: string; short: string }[] = [
  { id: 'draw', label: 'Dibujo', short: 'Dibujo' },
  { id: 'paint', label: 'Pintura', short: 'Pintura' },
  { id: 'edit', label: 'Edición', short: 'Edición' },
  { id: 'select', label: 'Selección', short: 'Selec.' },
  { id: 'geometry', label: 'Geometría', short: 'Geom.' },
  { id: 'transform', label: 'Transformación', short: 'Transf.' },
  { id: 'color', label: 'Color', short: 'Color' },
  { id: 'view', label: 'Vista', short: 'Vista' },
];

/** Control del panel de propiedades contextual. */
export type Prop =
  | { type: 'slider'; label: string; min: number; max: number; step?: number; unit?: string; log?: boolean; display?: number; value: number; onInput: (v: number) => void; onChange?: (v: number) => void }
  | { type: 'select'; label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }
  | { type: 'segmented'; label?: string; options: { value: string; label: string; icon?: string }[]; value: string; onChange: (v: string) => void }
  | { type: 'toggle'; label: string; value: boolean; onChange: (v: boolean) => void }
  | { type: 'button'; label: string; icon?: string; primary?: boolean; disabled?: boolean; title?: string; onClick: () => void }
  | { type: 'preset'; slot: string; categories: string[] }
  | { type: 'note'; text: string }
  | { type: 'sep' };

export interface ToolContext {
  engine: CanvasEngine;
  lib: BrushLibrary;
  setting<T>(tool: string, key: string): T;
  setSetting(tool: string, key: string, value: unknown): void;
  readonly primary: string;
  readonly secondary: string;
  setPrimary(hex: string): void;
  notify(message: string, kind?: 'info' | 'ok' | 'error'): void;
  /** Vuelve a dibujar el panel de propiedades. */
  refreshProps(): void;
  openBrushStudio(p: BrushPreset): void;
}

/** Herramienta con su propio manejo del lienzo y ciclo de vida. */
export interface ActiveHandler extends ToolHandler {
  activate?(): void;
  deactivate?(): void;
  /** true si consumió la tecla (Enter, Esc…). */
  key?(e: KeyboardEvent): boolean;
}

export interface ToolDef {
  id: string;
  label: string;
  category: CategoryId;
  icon: string;
  shortcut: string[];
  hint: string;
  kind: 'brush' | 'eraser' | 'pan' | 'rotate' | 'custom';
  /** Categorías de la biblioteca que usa una herramienta de pincel. */
  brushCategories?: string[];
  defaults?: Record<string, unknown>;
  props?(ctx: ToolContext): Prop[];
  create?(ctx: ToolContext): ActiveHandler;
}
