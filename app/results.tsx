// Results: every ticket we posted, graded, with unit P&L, plus the model's own tracker.
// Data comes from /sheets/results.json on the public site (edited per slate, no app build needed).
import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label, Pill } from '@/components/ui';
import { RecordCard } from '@/components/Record';
import { useBoard } from '@/lib/store';
import { SITE_URL } from '@/lib/site';
import { fonts, space, type, useTheme } from '@/theme';

type Result = 'win' | 'loss' | 'push' | 'pending';
type Item = { label: string; price: number; units: number; result: Result; note?: string };
type Group = { title: string; items: Item[] };
type Day = {
  day: string;
  title: string;
  headline: string;
  subtitle?: string;
  highlights?: string[];
  groups: Group[];
};

const dec = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const fmtU = (u: number) => `${u > 0 ? '+' : ''}${u.toFixed(2)}u`;
/** Net units for one ticket: profit on a win, stake lost on a loss, zero otherwise. */
const net = (i: Item) =>
  i.result === 'win' ? i.units * (dec(i.price) - 1) : i.result === 'loss' ? -i.units : 0;

function tally(items: Item[]) {
  const t = { wins: 0, losses: 0, pushes: 0, pending: 0, units: 0, staked: 0 };
  for (const i of items) {
    if (i.result === 'win') t.wins++;
    else if (i.result === 'loss') t.losses++;
    else if (i.result === 'push') t.pushes++;
    else t.pending++;
    t.units += net(i);
    if (i.result !== 'pending') t.staked += i.units;
  }
  return t;
}

function Row({ i }: { i: Item }) {
  const t = useTheme();
  const tone =
    i.result === 'win'
      ? 'good'
      : i.result === 'loss'
        ? 'bad'
        : i.result === 'pending'
          ? 'neutral'
          : 'warn';
  const n = net(i);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: t.line,
      }}
    >
      <Pill text={i.result === 'pending' ? 'live' : i.result} tone={tone} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyBold, { color: t.ink }]}>{i.label}</Text>
        <Text style={[type.small, { color: t.mute }]}>
          {fmt(i.price)} · {i.units}u{i.note ? ` · ${i.note}` : ''}
        </Text>
      </View>
      <Text
        style={[
          type.mono,
          {
            color: n > 0 ? t.green : n < 0 ? t.mute : t.ink2,
            fontFamily: fonts.dataBold,
            minWidth: 64,
            textAlign: 'right',
          },
        ]}
      >
        {i.result === 'pending' ? '—' : fmtU(n)}
      </Text>
    </View>
  );
}

export default function ResultsScreen() {
  const t = useTheme();
  const { board } = useBoard();
  const [days, setDays] = useState<Day[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${SITE_URL}/sheets/results.json?t=${Math.floor(Date.now() / 300000)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => live && setDays(j?.days ?? []))
      .catch((e) => live && setErr(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, []);
  const day = days?.[0];
  const all = useMemo(() => (day ? day.groups.flatMap((g) => g.items) : []), [day]);
  const total = tally(all);
  const biggest = all.filter((i) => i.result === 'win').sort((a, b) => net(b) - net(a))[0];

  return (
    <Screen
      hero
      title={day?.headline ?? 'Results'}
      subtitle={day?.subtitle ?? 'Every ticket we posted, graded against the box scores.'}
    >
      {err && (
        <Card>
          <Label>Could not load results</Label>
          <Body small muted>
            {err}
          </Body>
        </Card>
      )}
      {day && (
        <>
          <Card accent="green">
            <Label color={t.green}>{day.title} · settled tickets</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: 6 }}>
              <Stat label="Record" value={`${total.wins}-${total.losses}`} />
              <Stat label="Net units" value={fmtU(total.units)} />
              <Stat label="Staked" value={`${total.staked.toFixed(2)}u`} />
              <Stat
                label="ROI"
                value={total.staked ? `${Math.round((total.units / total.staked) * 100)}%` : '—'}
              />
              <Stat label="Live" value={String(total.pending)} />
            </View>
            {biggest && (
              <Body small muted>
                Biggest cash: {biggest.label} at {fmt(biggest.price)} for {fmtU(net(biggest))}.
              </Body>
            )}
          </Card>
          {!!day.highlights?.length && (
            <Card>
              <Label>Highlights</Label>
              {day.highlights.map((h, i) => (
                <Text key={i} style={[type.body, { color: t.ink, marginTop: 4 }]}>
                  〉 {h}
                </Text>
              ))}
            </Card>
          )}
          {day.groups.map((g) => {
            const gt = tally(g.items);
            return (
              <View key={g.title}>
                <H2>{g.title}</H2>
                <Card>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}
                  >
                    <Label>
                      {gt.wins}-{gt.losses}
                      {gt.pending ? ` · ${gt.pending} live` : ''}
                    </Label>
                    <Label color={gt.units > 0 ? t.green : t.mute}>{fmtU(gt.units)}</Label>
                  </View>
                  {g.items.map((i, n) => (
                    <Row key={n} i={i} />
                  ))}
                </Card>
              </View>
            );
          })}
        </>
      )}
      <H2>Model tracker</H2>
      <Body small muted>
        The model's own record across every call on the board, not just what we posted.
      </Body>
      <RecordCard board={board} />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ minWidth: 84 }}>
      <Text style={[type.label, { color: t.mute }]}>{label}</Text>
      <Text style={[type.h2, { color: t.green, fontSize: 24 }]}>{value}</Text>
    </View>
  );
}
