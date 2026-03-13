'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useState that persists to localStorage. Reads initial value from storage,
 * writes back on every set. Falls back to `defaultValue` if storage is empty
 * or unavailable (SSR).
 */
export function usePersistedState(
  key: string,
  defaultValue: number,
): [number, (v: number | ((prev: number) => number)) => void, () => void] {
  const [value, setValueRaw] = useState(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        const parsed = Number(stored);
        if (Number.isFinite(parsed)) return parsed;
      }
    } catch {
      /* SSR or quota error */
    }
    return defaultValue;
  });

  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;

  // Write to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* quota error */
    }
  }, [key, value]);

  const setValue = useCallback((v: number | ((prev: number) => number)) => {
    setValueRaw(v);
  }, []);

  const reset = useCallback(() => {
    setValueRaw(defaultRef.current);
  }, []);

  return [value, setValue, reset];
}
