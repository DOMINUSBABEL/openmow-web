/**
 * Simulation Event Bus & Flags (T05 / Gate G2).
 * Decoupled from DOM/browser events. Fully deterministic.
 */

export interface SimEvent {
  name: string;
  data?: any;
  tick: number;
}

export type SimEventHandler = (event: SimEvent) => void;

export class SimEventBus {
  private handlers = new Map<string, SimEventHandler[]>();
  private activeFlags = new Set<string>();
  private eventHistory: SimEvent[] = [];

  /** Register an event listener */
  on(eventName: string, handler: SimEventHandler) {
    let list = this.handlers.get(eventName);
    if (!list) {
      list = [];
      this.handlers.set(eventName, list);
    }
    list.push(handler);
  }

  /** Unregister an event listener */
  off(eventName: string, handler: SimEventHandler) {
    const list = this.handlers.get(eventName);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  /** Emit an event immediately to all registered listeners */
  emit(name: string, data?: any, tick = 0) {
    const ev: SimEvent = { name, data, tick };
    this.eventHistory.push(ev);
    const list = this.handlers.get(name);
    if (list) {
      for (const h of list) {
        try {
          h(ev);
        } catch (e) {
          console.error(`[SimEventBus] Error in handler for '${name}':`, e);
        }
      }
    }
  }

  /** Set a named state flag (e.g. GEM2 trigger events) */
  setFlag(name: string, active: boolean) {
    if (active) {
      this.activeFlags.add(name);
    } else {
      this.activeFlags.delete(name);
    }
  }

  /** Query whether a named flag is currently set */
  hasFlag(name: string): boolean {
    return this.activeFlags.has(name);
  }

  /** Get list of all active flag names (sorted for determinism) */
  getActiveFlags(): string[] {
    return Array.from(this.activeFlags).sort();
  }

  /** Clear all state */
  reset() {
    this.handlers.clear();
    this.activeFlags.clear();
    this.eventHistory = [];
  }
}
