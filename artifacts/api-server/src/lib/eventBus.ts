/**
 * eventBus.ts — lightweight cross-module pub/sub for runtime events.
 *
 * Used to broadcast config updates, status changes, and other events
 * to SSE clients without coupling modules to each other.
 */

export interface RuntimeEvent {
  type: "config:update" | "risk:update" | "status:update" | "position:update" | "order:created" | "order:update";
  payload: Record<string, unknown>;
  ts: string;
}

type EventSubscriber = (event: RuntimeEvent) => void;
const subscribers = new Set<EventSubscriber>();

export function publishEvent(event: RuntimeEvent): void {
  for (const cb of subscribers) {
    try { cb(event); } catch { /* ignore */ }
  }
}

export function subscribeEvents(cb: EventSubscriber): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}
