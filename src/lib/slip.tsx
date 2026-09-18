// Personal bet slip: tap a pick anywhere in the app to queue it for the day. Rows live in Supabase
// (slip_items, one owner per row) with an AsyncStorage mirror so the slip is instant and survives
// being offline. Signed-out users keep a local-only slip.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fmtPrice, toAmerican, toDecimal } from './price';
import { supabase } from './supabase';
import { useBoard } from './store';
import { isSettleable, pendingSettlements } from './settle';

export type SlipKind = 'side' | 'total' | 'ml' | 'atd' | 'td2' | 'prop' | 'parlay' | 'stack';
export type SlipStatus = 'queued' | 'placed' | 'won' | 'lost' | 'push';
export type SlipLeg = { label: string; price: number | null; book?: string | null };
export type SlipInput = {
  kind: SlipKind;
  label: string;
  detail?: string | null;
  game_id?: string | null;
  game_label?: string | null;
  price?: number | null;
  book?: string | null;
  model_prob?: number | null;
  legs?: SlipLeg[] | null;
  source?: string;
  link?: string | null;
};
export type SlipItem = SlipInput & {
  id: string;
  day: string;
  key: string;
  units: number;
  status: SlipStatus;
  note?: string | null;
  created_at: string;
};

const CACHE = 'cappers.slip.v1';
/** Slate day in US Eastern time so a late Sunday add stays on Sunday's slip. */
export function slateDay(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export const slipKey = (i: SlipInput) => `${i.kind}|${i.label}|${i.game_id ?? ''}`;
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
export { fmtPrice, toAmerican, toDecimal, toWin } from './price';

type Ctx = {
  items: SlipItem[];
  today: string;
  todays: SlipItem[];
  has: (input: SlipInput) => boolean;
  add: (input: SlipInput) => Promise<void>;
  toggle: (input: SlipInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  update: (
    id: string,
    patch: Partial<Pick<SlipItem, 'units' | 'status' | 'price' | 'note'>>,
  ) => Promise<void>;
  clearDay: (day: string) => Promise<void>;
  synced: boolean;
  /** How many rows the graded board settled on its own, for this session. */
  autoSettled: number;
};
const SlipContext = createContext<Ctx | null>(null);

export function SlipProvider({ children }: { children: React.ReactNode }) {
  const { session, board } = useBoard();
  const [items, setItems] = useState<SlipItem[]>([]);
  const [synced, setSynced] = useState(false);
  const [autoSettled, setAutoSettled] = useState(0);
  const today = slateDay();
  const userId = session?.user?.id ?? null;

  // Cache first, then the server copy when signed in.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE);
        if (raw) setItems(JSON.parse(raw));
      } catch {}
      if (!userId) return;
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('slip_items')
        .select('*')
        .gte('day', since)
        .order('created_at', { ascending: true });
      if (!error && data) {
        setItems(data as SlipItem[]);
        setSynced(true);
      }
    })();
  }, [userId]);
  useEffect(() => {
    AsyncStorage.setItem(CACHE, JSON.stringify(items)).catch(() => {});
  }, [items]);

  const persist = useCallback(
    async (row: SlipItem) => {
      if (!userId) return;
      const {
        id,
        day,
        key,
        kind,
        label,
        detail,
        game_id,
        game_label,
        price,
        book,
        model_prob,
        legs,
        source,
        units,
        status,
        note,
        link,
      } = row;
      await supabase.from('slip_items').upsert(
        {
          id,
          user_id: userId,
          day,
          key,
          kind,
          label,
          detail,
          game_id,
          game_label,
          price,
          book,
          model_prob,
          legs,
          source,
          units,
          status,
          note,
          link,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,day,key' },
      );
    },
    [userId],
  );

  // Settle from the graded board. grade-results already decided these outcomes from the final box
  // score; without this the member has to re-enter the same verdict by hand and the tracker's
  // record only counts what they remembered to tap. Rows they judged themselves are left alone.
  useEffect(() => {
    const due = pendingSettlements(items, board);
    if (!due.length) return;
    const byId = new Map(due.map((d) => [d.id, d.status]));
    // Resolve the rows before touching state: doing this inside the updater would run twice under
    // StrictMode and double the count.
    const settled = items
      .filter((i) => byId.has(i.id) && isSettleable(i))
      .map((i) => ({ ...i, status: byId.get(i.id)! }));
    if (!settled.length) return;
    const patched = new Map(settled.map((i) => [i.id, i]));
    setItems((prev) => prev.map((i) => patched.get(i.id) ?? i));
    setAutoSettled((n) => n + settled.length);
    // Push each settled row so the verdict survives a reload and reaches their other devices.
    settled.forEach((row) => {
      persist(row).catch(() => {});
    });
  }, [items, board, persist]);

  const has = useCallback(
    (input: SlipInput) => items.some((i) => i.day === today && i.key === slipKey(input)),
    [items, today],
  );
  const add = useCallback(
    async (input: SlipInput) => {
      const key = slipKey(input);
      if (items.some((i) => i.day === today && i.key === key)) return;
      const row: SlipItem = {
        ...input,
        id: uuid(),
        day: today,
        key,
        units: 1,
        status: 'queued',
        created_at: new Date().toISOString(),
      };
      setItems((prev) => [...prev, row]);
      await persist(row);
    },
    [items, today, persist],
  );
  const remove = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (userId) await supabase.from('slip_items').delete().eq('id', id);
    },
    [userId],
  );
  const toggle = useCallback(
    async (input: SlipInput) => {
      const existing = items.find((i) => i.day === today && i.key === slipKey(input));
      if (existing) await remove(existing.id);
      else await add(input);
    },
    [items, today, add, remove],
  );
  const update = useCallback(
    async (id: string, patch: Partial<Pick<SlipItem, 'units' | 'status' | 'price' | 'note'>>) => {
      let next: SlipItem | undefined;
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== id) return i;
          next = { ...i, ...patch };
          return next;
        }),
      );
      if (next) await persist(next);
    },
    [persist],
  );
  const clearDay = useCallback(
    async (day: string) => {
      setItems((prev) => prev.filter((i) => i.day !== day));
      if (userId) await supabase.from('slip_items').delete().eq('day', day);
    },
    [userId],
  );

  const value = useMemo<Ctx>(
    () => ({
      items,
      today,
      todays: items.filter((i) => i.day === today),
      has,
      add,
      toggle,
      remove,
      update,
      clearDay,
      synced,
      autoSettled,
    }),
    [items, today, has, add, toggle, remove, update, clearDay, synced],
  );
  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>;
}

export function useSlip(): Ctx {
  const ctx = useContext(SlipContext);
  if (!ctx) throw new Error('useSlip outside SlipProvider');
  return ctx;
}

/** Parlay math over the items that carry a price. */
export function slipSummary(list: SlipItem[]) {
  const priced = list.filter((i) => typeof i.price === 'number');
  const decimal = priced.reduce((d, i) => d * toDecimal(i.price as number), 1);
  const probs = list.filter((i) => typeof i.model_prob === 'number');
  const prob = probs.reduce((p, i) => p * (i.model_prob as number), 1);
  return {
    count: list.length,
    units: list.reduce((n, i) => n + (Number(i.units) || 0), 0),
    priced: priced.length,
    parlayPrice: priced.length > 1 ? toAmerican(decimal) : null,
    parlayProb: probs.length > 1 && probs.length === list.length ? prob : null,
  };
}
/** Plain-text slip for pasting into a book or Discord. */
export function slipText(day: string, list: SlipItem[]) {
  const s = slipSummary(list);
  const lines = list.map((i, n) => {
    const legs = i.legs?.length
      ? ` [${i.legs.map((l) => `${l.label}${l.price != null ? ` ${fmtPrice(l.price)}` : ''}`).join(' + ')}]`
      : '';
    return `${n + 1}. ${i.label}${i.game_label ? ` (${i.game_label})` : ''}${i.price != null ? ` ${fmtPrice(i.price)}` : ''}${i.book ? ` ${i.book}` : ''}${legs} · ${i.units}u`;
  });
  const tail = [
    `${s.count} picks · ${s.units}u`,
    s.parlayPrice != null ? `all parlayed ${fmtPrice(s.parlayPrice)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `CAPPERS & CODE · SLIP ${day}\n${lines.join('\n')}\n${tail}\nUnits, not dollars. Locked In. Trust the Code.`;
}
