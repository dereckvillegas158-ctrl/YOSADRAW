import type { StoredStroke } from './StrokeStore';

export type HistoryOp =
  | { kind: 'add'; stroke: StoredStroke }
  | { kind: 'clear'; strokes: StoredStroke[] };

/** Pila de deshacer/rehacer basada en operaciones (no en imágenes): ocupa poca memoria. */
export class History {
  private undoStack: HistoryOp[] = [];
  private redoStack: HistoryOp[] = [];
  constructor(public limit = 2000) {}

  push(op: HistoryOp) {
    this.undoStack.push(op);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(): HistoryOp | undefined {
    const op = this.undoStack.pop();
    if (op) this.redoStack.push(op);
    return op;
  }
  redo(): HistoryOp | undefined {
    const op = this.redoStack.pop();
    if (op) this.undoStack.push(op);
    return op;
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoDepth() { return this.undoStack.length; }
  get redoDepth() { return this.redoStack.length; }
}
