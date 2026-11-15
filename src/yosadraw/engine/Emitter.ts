/** Emisor de eventos tipado y mínimo: la UI se suscribe, el motor no conoce la UI. */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(v: never) => void>>();
  on<K extends keyof E>(type: K, fn: (v: E[K]) => void): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as (v: never) => void);
    return () => set!.delete(fn as (v: never) => void);
  }
  protected emit<K extends keyof E>(type: K, value: E[K]) {
    this.map.get(type)?.forEach(fn => (fn as (v: E[K]) => void)(value));
  }
}
