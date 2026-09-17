import React from 'react';
import { Text, View } from 'react-native';
import { Card, Pill } from '@/components/ui';
import { fmtAmerican, pct } from '@/lib/odds';
import { space, type, useTheme } from '@/theme';
import type { Parlay, ParlayCategory } from '@/lib/types';
import { AddToSlip, parlayToSlip } from '@/components/Slip';

/** One ranked parlay from the builder: price, model probability, EV, legs and the reasoning. */
export function ParlayCard({ p, category }: { p: Parlay; category: ParlayCategory['key'] }) {
  const t = useTheme();
  const headline =
    category === 'twoPlus'
      ? p.price != null
        ? `${fmtAmerican(p.price)} · fair ${fmtAmerican(p.fairPrice)}`
        : `fair ${fmtAmerican(p.fairPrice)} · play ${fmtAmerican(p.minPrice)} or better`
      : p.price != null
        ? fmtAmerican(p.price)
        : '';
  return (
    <Card accent={p.rank === 1 ? 'green' : undefined}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          flexWrap: 'wrap',
          marginBottom: space.sm,
        }}
      >
        <Pill text={`#${p.rank}`} tone={p.rank === 1 ? 'accent' : 'neutral'} />
        {!!headline && (
          <Text style={[type.h2, { color: t.green, fontSize: 22, flexShrink: 1 }]}>{headline}</Text>
        )}
        {p.prob != null && <Pill text={`${pct(p.prob)} model`} tone="good" />}
        {p.ev != null && (
          <Pill
            text={`${p.ev >= 0 ? '+' : ''}${Math.round(p.ev * 100)}% EV`}
            tone={p.ev >= 0 ? 'good' : 'bad'}
          />
        )}
      </View>
      <View style={{ gap: 6 }}>
        {p.legs.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
            <Text style={[type.mono, { color: t.green }]}>{'〉'}</Text>
            <Text style={[type.bodyBold, { color: t.ink, flex: 1 }]}>{l.label}</Text>
            <Text style={[type.mono, { color: t.ink2 }]}>
              {l.price != null ? `${fmtAmerican(l.price)} ${l.book}` : l.book}
              {l.prob != null && l.type !== 'text' ? ` · ${pct(l.prob)}` : ''}
            </Text>
          </View>
        ))}
      </View>
      {p.legs.some((l) => l.moved) && (
        <Text style={[type.small, { color: t.mute, marginTop: space.xs }]}>
          {p.legs
            .filter((l) => l.moved)
            .map((l) => `${l.label}: ${l.moved}`)
            .join(' · ')}
        </Text>
      )}
      <Text style={[type.small, { color: t.ink2, marginTop: space.sm }]}>{p.why}</Text>
      {category !== 'model' && (
        <View style={{ marginTop: space.sm }}>
          <AddToSlip item={parlayToSlip(p, category)} compact />
        </View>
      )}
    </Card>
  );
}
