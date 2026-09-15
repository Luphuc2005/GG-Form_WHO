import { useState, useEffect } from "react";

export function useSessionDraft<T>(key: string, initialValue: T): [T, (val: T | ((prev: T) => T)) => void, () => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch {
      // Ignore parse error
    }
    return initialValue;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Ignore storage errors
    }
  }, [key, state]);

  const clearDraft = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignore
    }
    setState(initialValue);
  };

  return [state, setState, clearDraft];
}
