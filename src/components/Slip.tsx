import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { fonts, space, type, useTheme } from '@/theme';
import { useSlip, type SlipInput } from '@/lib/slip';
import type { Pick, Parlay } from '@/lib/types';

/** The one button that puts a pick on today's slip. Tapping again removes it. */
export function AddToSlip({ item, compact }: { item: SlipInput; compact?: boolean }) {
  const t = useTheme();
  const { has, toggle } = useSlip();
  const on = has(item);
  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation?.();
        toggle(item);
      }}
      hitSlop={8}
      style={({ pressed }) => ({
        paddingHorizontal: compact ? 8 : 12,
        paddingVertical: compact ? 4 : 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: on ? t.green : t.lineGreen,
        backgroundColor: on ? t.green : 'transparent',
        opacity: pressed ? 0.7 : 1,
        alignSelf: 'flex-start',
      })}
    >
      <Text
        style={[
          type.label,
          {
            color: on ? t.onGreen : t.green,
            fontFamily: fonts.dataBold,
            letterSpacing: 1,
          },
        ]}
      >
        {on ? '✓ ON SLIP' : '+ SLIP'}
      </Text>
    </Pressable>
  );
}

/** Better of FanDuel and DraftKings, then the best book, then the research price. */
export function pickPrice(p: Pick): { price: number | null; book: string | null } {
  const books = p.live?.books ?? {};
  const fd = books.fanduel;
  const dk = books.draftkings;
  if (typeof fd === 'number' || typeof dk === 'number') {
    const best = Math.max(...[fd, dk].filter((x): x is number => typeof x === 'number'));
    return { price: best, book: best === fd ? 'FD' : 'DK' };
  }
  if (p.live) return { price: p.live.best, book: p.live.bestBook ?? null };
  return { price: p.price, book: p.price != null ? 'research' : null };
}
export function pickToSlip(p: Pick, gameLabel?: string, source = 'td-board'): SlipInput {
  const { price, book } = pickPrice(p);
  return {
    kind: 'atd',
    label: `${p.name} anytime TD`,
    detail: `${p.team} · ${p.pos}`,
    game_id: p.gameId ?? null,
    game_label: gameLabel ?? null,
    price,
    book,
    model_prob: p.est,
    source,
  };
}
export function parlayToSlip(p: Parlay, category: string): SlipInput {
  const twoPlus = category === 'twoPlus';
  return {
    kind: twoPlus ? 'td2' : 'parlay',
    label: twoPlus
      ? p.legs[0].label
      : p.legs.map((l) => l.label.replace(' anytime TD', ' ATD')).join(' + '),
    detail: twoPlus
      ? `fair ${p.fairPrice != null ? (p.fairPrice > 0 ? '+' : '') + p.fairPrice : '—'}, play ${p.minPrice != null ? (p.minPrice > 0 ? '+' : '') + p.minPrice : '—'} or better`
      : `${category} #${p.rank}`,
    game_id: p.legs.length === 1 ? (p.legs[0].game ?? null) : null,
    game_label:
      p.legs.length === 1
        ? (p.legs[0].gameLabel ?? null)
        : p.legs
            .map((l) => l.gameLabel)
            .filter(Boolean)
            .join(', ') || null,
    price: twoPlus ? (p.price ?? p.minPrice ?? null) : p.price,
    book: twoPlus
      ? p.price != null
        ? (p.legs[0].book ?? 'FD/DK')
        : 'check FD/DK'
      : p.legs.every((l) => l.book === p.legs[0].book)
        ? (p.legs[0].book ?? null)
        : 'FD/DK',
    model_prob: p.prob,
    legs: p.legs.map((l) => ({ label: l.label, price: l.price, book: l.book })),
    source: 'parlays',
  };
}
export function betToSlip(
  bet: string,
  gameId: string,
  gameLabel: string | undefined,
  conf: number,
): SlipInput {
  const atd = /(.+?) ATD (.+)/.exec(bet);
  const kind = atd ? 'atd' : /^(over|under)/i.test(bet) ? 'total' : 'side';
  const priceMatch = atd ? /([+-]\d{3,4})/.exec(atd[2]) : null;
  return {
    kind,
    label: atd ? `${atd[1]} anytime TD` : bet,
    detail: `Locked In · confidence ${conf}/5`,
    game_id: gameId,
    game_label: gameLabel ?? null,
    price: priceMatch ? Number(priceMatch[1]) : atd ? null : -110,
    book: atd ? 'research' : 'FD/DK',
    model_prob: null,
    source: 'edge',
  };
}

/** Compact count pill used in headers. */
export function SlipCount() {
  const t = useTheme();
  const { todays } = useSlip();
  if (!todays.length) return null;
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: t.green,
        marginLeft: space.xs,
      }}
    >
      <Text style={[type.label, { color: t.onGreen }]}>{todays.length}</Text>
    </View>
  );
}
