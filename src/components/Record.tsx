import React from 'react';
import { Text, View } from 'react-native';
import { palette, space, type } from '@/theme';
import type { Board, Tally } from '@/lib/types';
import { Card, Label, Pill } from './ui';

const fmt = (t?: Tally) => (t ? `${t.wins}-${t.losses}${t.pushes ? `-${t.pushes}` : ''}` : '—');
const BUCKETS: [string, string][] = [
  ['lockedIn', 'Locked In'],
  ['top3', 'Top-3 TD calls'],
  ['td2', '2+ TD calls'],
  ['lean', 'Side and total leans'],
  ['prop', 'Prop leans'],
  ['value', 'Value TD calls'],
];

/** Season record graded from final box scores. Shown to members and, in summary, on the paywall. */
export function RecordCard({ board }: { board: Board }) {
  const season = board.record?.season_totals;
  const week = board.results;
  if (!season && !week) return null;
  const finals = week ? `${week.finals} of ${week.games} games final` : '';
  return (
    <Card>
      <Label color={palette.green}>Real record</Label>
      <Text style={[type.small, { color: palette.mute, marginBottom: 6 }]}>
        Graded from final box scores only. Pending games are not counted. {finals}
      </Text>
      {BUCKETS.map(([k, label]) => (
        <View
          key={k}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 6,
            borderBottomWidth: 1,
            borderColor: palette.line,
          }}
        >
          <Text style={[type.body, { color: palette.ink }]}>{label}</Text>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Text style={[type.small, { color: palette.mute }]}>wk {fmt(week?.summary?.[k])}</Text>
            <Text style={[type.mono, { color: palette.green, fontSize: 15 }]}>
              {fmt(season?.[k])}
            </Text>
          </View>
        </View>
      ))}
      {!!week?.items?.length && (
        <View style={{ marginTop: space.sm, gap: 4 }}>
          <Label>This week, graded</Label>
          {week.items
            .filter((i) => i.bucket === 'lockedIn' || i.bucket === 'top3' || i.bucket === 'td2')
            .slice(0, 12)
            .map((i, idx) => (
              <View
                key={idx}
                style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}
              >
                <Text style={[type.small, { color: palette.ink2, flex: 1 }]}>
                  {i.gameLabel} · {i.label}
                </Text>
                <Pill
                  text={i.result}
                  tone={i.result === 'win' ? 'good' : i.result === 'loss' ? 'warn' : 'neutral'}
                />
              </View>
            ))}
        </View>
      )}
    </Card>
  );
}
