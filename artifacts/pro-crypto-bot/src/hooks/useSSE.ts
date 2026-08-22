/**
 * useSSE — subscribes to /api/bot/logs/stream (SSE) and exposes real-time events.
 *
 * Usage:
 *   useSSE((event) => {
 *     if (event.type === 'position:open') refetch();
 *     if (event.type === 'config:update') showBanner(event.payload);
 *   });
 */

import { useEffect, useRef, useCallback } from "react";
import { SERVER_URL } from "../config/urls";

export type SSEEventType =
  | "init"
  | "log"
  | "position:open"
  | "position:close"
  | "position:update"
  | "order:created"
  | "order:update"
  | "config:update"
  | "risk:update"
  | "status:update";

export interface SSELogEntry {
  ts: string;
  level: string;
  msg: string;
}

export interface SSEEvent {
  type: SSEEventType;
  entry?: SSELogEntry;
  logs?: SSELogEntry[];
  payload?: Record<string, unknown>;
  symbol?: string;
}

type SSEListener = (event: SSEEvent) => void;

const RECONNECT_DELAY_MS = 5_000;

export function useSSE(onEvent: SSEListener, enabled = true): void {
  const esRef        = useRef<EventSource | null>(null);
  const listenerRef  = useRef<SSEListener>(onEvent);
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef   = useRef(true);

  // Always keep listener ref current (avoids stale closure)
  listenerRef.current = onEvent;

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;

    try {
      const url = `${SERVER_URL}/api/bot/logs/stream`;
      const es  = new EventSource(url);
      esRef.current = es;

      es.onmessage = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as SSEEvent;
          listenerRef.current(data);
        } catch { /* malformed event — ignore */ }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (mountedRef.current) {
          timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    } catch { /* EventSource not supported or URL invalid */ }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) connect();

    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [connect, enabled]);
}
