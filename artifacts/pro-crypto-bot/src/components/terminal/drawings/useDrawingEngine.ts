/**
 * drawings/useDrawingEngine.ts
 * Owns drawing-object state, undo/redo history, and per-symbol persistence.
 * Pointer interaction (drag, multi-click sequencing, pixel<->chart-point
 * conversion) lives in DrawingCanvas.tsx, which calls into this hook's
 * mutators. Persistence is localStorage only in this phase — explicitly
 * NOT wired to a backend endpoint (none exists for this yet); Save/Load
 * are real, working, and scoped per-symbol, just local to this browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawingObject, DrawingTool } from "./types";

const STORAGE_PREFIX = "et_drawings_";
const MAX_HISTORY = 50;

export function useDrawingEngine(symbol: string) {
  const [objects, setObjects] = useState<DrawingObject[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [magnet, setMagnet] = useState(false);
  const [locked, setLocked] = useState(false);
  const [allHidden, setAllHidden] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const historyRef = useRef<DrawingObject[][]>([[]]);
  const historyIndexRef = useRef(0);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + symbol);
      const parsed: DrawingObject[] = raw ? JSON.parse(raw) : [];
      setObjects(parsed);
      historyRef.current = [parsed];
      historyIndexRef.current = 0;
      setSelectedId(null);
    } catch {
      setObjects([]);
      historyRef.current = [[]];
      historyIndexRef.current = 0;
    }
  }, [symbol]);

  const pushHistory = useCallback((next: DrawingObject[]) => {
    const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
    trimmed.push(next);
    if (trimmed.length > MAX_HISTORY) trimmed.shift();
    historyRef.current = trimmed;
    historyIndexRef.current = trimmed.length - 1;
    forceRerender(v => v + 1);
  }, []);

  const commit = useCallback((next: DrawingObject[]) => {
    setObjects(next);
    pushHistory(next);
  }, [pushHistory]);

  const addObject = useCallback((obj: DrawingObject) => {
    if (locked) return;
    commit([...objects, obj]);
  }, [objects, commit, locked]);

  const updateObject = useCallback((id: string, patch: Partial<DrawingObject>) => {
    if (locked) return;
    commit(objects.map(o => (o.id === id ? ({ ...o, ...patch } as DrawingObject) : o)));
  }, [objects, commit, locked]);

  const removeObject = useCallback((id: string) => {
    commit(objects.filter(o => o.id !== id));
    setSelectedId(prev => (prev === id ? null : prev));
  }, [objects, commit]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    removeObject(selectedId);
  }, [selectedId, removeObject]);

  const clearAll = useCallback(() => {
    commit([]);
    setSelectedId(null);
  }, [commit]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    setObjects(historyRef.current[historyIndexRef.current]);
    forceRerender(v => v + 1);
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    setObjects(historyRef.current[historyIndexRef.current]);
    forceRerender(v => v + 1);
  }, []);

  const save = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_PREFIX + symbol, JSON.stringify(objects));
      setSavedAt(Date.now());
      return true;
    } catch { return false; }
  }, [objects, symbol]);

  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + symbol);
      const parsed: DrawingObject[] = raw ? JSON.parse(raw) : [];
      commit(parsed);
      return true;
    } catch { return false; }
  }, [symbol, commit]);

  return {
    objects, activeTool, selectedId, magnet, locked, allHidden, savedAt,
    setActiveTool, setSelectedId,
    toggleMagnet: () => setMagnet(v => !v),
    toggleLocked: () => setLocked(v => !v),
    toggleAllHidden: () => setAllHidden(v => !v),
    addObject, updateObject, removeObject, deleteSelected, clearAll,
    undo, redo, save, load,
    canUndo: historyIndexRef.current > 0,
    canRedo: historyIndexRef.current < historyRef.current.length - 1,
  };
}

export type DrawingEngine = ReturnType<typeof useDrawingEngine>;
