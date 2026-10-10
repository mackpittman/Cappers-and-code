import React from 'react';
import { Text, View } from 'react-native';
import { Body, Card, Pill } from '@/components/ui';
import { fmtAmerican, pct } from '@/lib/odds';
import { space, type, useTheme } from '@/theme';
import type { FiveLegTicket } from '@/lib/types';
import { AddToSlip } from '@/components/Slip';
import { kickoffLabel } from '@/lib/format';

/**
 * The desk's five-leg ticket for one game: volume props only, alternate lines one notch under the
 * main number, no touchdown markets (docs/FIVE_LEG_FORMULA.md). Built for hit rate, not for edge
 * on every leg, so the joint number is the one to read.
 */
export function FiveLegCard({ t, showGame }: { t: FiveLegTicket; showGame?: boolean }) {
  const th = useTheme();
  const teams = Array.from(new Set(t.legs.map((l) => l.team)));
  const sameSide = teams.length === 1;
  return (
    <Card accent={t.short ? undefined : 'green'}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          flexWrap: 'wrap',
          marginBottom: space.sm,
        }}
      >
        {showGame && <Pill text={`${t.gameLabel} · ${kickoffLabel(t.kickoff)}`} tone="neutral" />}
        <Text style={[type.h2, { color: th.green, fontSize: 22 }]}>{fmtAmerican(t.price)}</Text>
        <Pill text={`${pct(t.joint)} model`} tone="good" />
        <Pill text={`${pct(t.bookJoint)} book`} tone="neutral" />
        {t.short && <Pill text="short of +500" tone="warn" />}
      </View>
      <View style={{ gap: 6 }}>
        {t.legs.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
            <Text style={[type.mono, { color: th.green }]}>{'〉'}</Text>
            <Text style={[type.bodyBold, { color: th.ink, flex: 1 }]}>{l.label}</Text>
            <Text style={[type.mono, { color: th.ink2 }]}>
              {fmtAmerican(l.price)} {l.book} · {pct(l.p)}
            </Text>
          </View>
        ))}
      </View>
      <Body small muted>
        {sameSide
          ? `All five legs ride ${teams[0]}'s passing volume: they lift each other, and one bad protection night sinks them together.`
          : `${t.legs.filter((l) => l.team === teams[0]).length} legs on ${teams[0]}, ${t.legs.filter((l) => l.team !== teams[0]).length} on ${teams.slice(1).join('/')}. Catches and yards only; no touchdown legs.`}
      </Body>
      <View style={{ marginTop: space.sm }}>
        <AddToSlip
          item={{
            kind: 'parlay',
            label: t.legs.map((l) => l.label).join(' + '),
            detail: `five-leg · model ${pct(t.joint)}`,
            game_id: t.game,
            game_label: t.gameLabel,
            price: t.price,
            book: t.legs.every((l) => l.book === t.legs[0].book) ? t.legs[0].book : 'FD/DK',
            model_prob: t.joint,
            legs: t.legs.map((l) => ({ label: l.label, price: l.price, book: l.book })),
            source: 'five-leg',
          }}
          compact
        />
      </View>
    </Card>
  );
}
