// Unit size. Every play we post is staked in units, never dollars, so the sheet reads the same
// for a $3 bettor and a $100 bettor. This holds the reader's own unit size and converts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'cc.unitSize';
export const UNIT_PRESETS = [3, 10, 25, 50, 100];
export const DEFAULT_UNIT = 100;

let current = DEFAULT_UNIT;
let loaded = false;
const subs = new Set<(n: number) => void>();
const emit = () => subs.forEach((s) => s(current));

/** Shared unit size across screens, persisted on device. */
export function useUnitSize() {
  const [size, setSize] = useState(current);
  useEffect(() => {
    subs.add(setSize);
    if (!loaded) {
      loaded = true;
      AsyncStorage.getItem(KEY)
        .then((raw) => {
          const n = Number(raw);
          if (Number.isFinite(n) && n > 0) {
            current = n;
            emit();
          }
        })
        .catch(() => {});
    }
    return () => {
      subs.delete(setSize);
    };
  }, []);
  const set = useCallback((n: number) => {
    current = Number.isFinite(n) && n > 0 ? n : 0;
    emit();
    AsyncStorage.setItem(KEY, String(current)).catch(() => {});
  }, []);
  return [size, set] as const;
}

/** Dollars, signed, with cents only when the number is small enough to need them. */
export function money(n: number, opts?: { signed?: boolean }) {
  const a = Math.abs(n);
  const digits = a === 0 ? 0 : a < 10 ? 2 : a < 1000 ? (Number.isInteger(a) ? 0 : 2) : 0;
  const body = `$${a.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
  if (n < 0) return `-${body}`;
  return opts?.signed && n > 0 ? `+${body}` : body;
}
