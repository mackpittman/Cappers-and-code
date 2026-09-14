// Results: every ticket we posted, graded, with unit P&L converted to the reader's own unit size.
// Data comes from /sheets/results.json on the public site (edited per slate, no app build needed).
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label, Pill } from '@/components/ui';
import { RecordCard } from '@/components/Record';
import { UnitSizeCard } from '@/components/UnitSize';
import { useBoard } from '@/lib/store';
import { SITE_URL } from '@/lib/site';
import { money, useUnitSize } from '@/lib/units';
import { fonts, radius, space, type, useTheme } from '@/theme';

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
/** How much of a unit each ticket risks: what we actually posted, or a flat 1u on everything. */
type Mode = 'posted' | 'flat';

/** American odds to decimal. +1400 pays 14 to 1; -180 pays 0.556 to 1. */
const dec = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
/** Profit on one unit risked. */
const toWin = (a: number) => dec(a) - 1;
const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const fmtU = (u: number) => `${u > 0 ? '+' : ''}${u.toFixed(2)}u`;
const stakeOf = (i: Item, mode: Mode) => (mode === 'flat' ? 1 : i.units);
/** Net units for one ticket: profit on a win, stake lost on a loss, zero otherwise. */
const net = (i: Item, mode: Mode) => {
  const s = stakeOf(i, mode);
  return i.result === 'win' ? s * toWin(i.price) : i.result === 'loss' ? -s : 0;
};

function tally(items: Item[], mode: Mode) {
  const t = { wins: 0, losses: 0, pushes: 0, pending: 0, units: 0, staked: 0 };
  for (const i of items) {
    if (i.result === 'win') t.wins++;
    else if (i.result === 'loss') t.losses++;
    else if (i.result === 'push') t.pushes++;
    else t.pending++;
    t.units += net(i, mode);
    if (i.result !== 'pending') t.staked += stakeOf(i, mode);
  }
  return t;
}

function Row({ i, mode, unit }: { i: Item; mode: Mode; unit: number }) {
  const t = useTheme();
  const tone =
    i.result === 'win'
      ? 'good'
      : i.result === 'loss'
        ? 'bad'
        : i.result === 'pending'
          ? 'neutral'
          : 'warn';
  const s = stakeOf(i, mode);
  const n = net(i, mode);
  const risk = `${s}u${unit ? ` (${money(s * unit)})` : ''}`;
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
          {fmt(i.price)} · risk {risk} to win {(toWin(i.price) * s).toFixed(2)}u
          {i.note ? ` · ${i.note}` : ''}
        </Text>
      </View>
      <View style={{ minWidth: 88, alignItems: 'flex-end' }}>
        <Text
          style={[
            type.mono,
            { color: n > 0 ? t.green : n < 0 ? t.mute : t.ink2, fontFamily: fonts.dataBold },
          ]}
        >
          {i.result === 'pending' ? '—' : fmtU(n)}
        </Text>
        {i.result !== 'pending' && unit > 0 && (
          <Text style={[type.small, { color: n > 0 ? t.green2 : t.mute }]}>
            {money(n * unit, { signed: true })}
          </Text>
        )}
      </View>
    </View>
  );
}

function Toggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const t = useTheme();
  const opts: Array<[Mode, string]> = [
    ['posted', 'Stakes as posted'],
    ['flat', 'Flat 1u on everything'],
  ];
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
      {opts.map(([m, label]) => {
        const on = m === mode;
        return (
          <Pressable
            key={m}
            onPress={() => onChange(m)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: on ? t.green : t.line,
              backgroundColor: on ? t.greenSoft : t.surface2,
            }}
          >
            <Text style={[type.label, { color: on ? t.green : t.ink2 }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ResultsScreen() {
  const t = useTheme();
  const { board } = useBoard();
  const [unit] = useUnitSize();
  const [mode, setMode] = useState<Mode>('posted');
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
  const total = tally(all, mode);
  const biggest = all
    .filter((i) => i.result === 'win')
    .sort((a, b) => net(b, mode) - net(a, mode))[0];

  return (
    <Screen
      hero
      title={day?.headline ?? 'Results'}
      subtitle={day?.subtitle ?? 'Every ticket we posted, graded against the box scores.'}
    >
      <UnitSizeCard />
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
              <Stat label="Net" value={unit ? money(total.units * unit, { signed: true }) : '—'} />
              <Stat
                label="Risked"
                value={`${total.staked.toFixed(2)}u${unit ? ` · ${money(total.staked * unit)}` : ''}`}
              />
              <Stat
                label="ROI"
                value={total.staked ? `${Math.round((total.units / total.staked) * 100)}%` : '—'}
              />
              <Stat label="Live" value={String(total.pending)} />
            </View>
            <Toggle mode={mode} onChange={setMode} />
            <Body small muted>
              {mode === 'posted'
                ? 'Exactly the stake printed on each sheet: 1u straights, 0.5u teasers and top scorers, 0.25u longshots and parlays, 0.1u ladder rungs.'
                : 'What the same card returns if you bet one full unit on every play, win or lose. Longshots swing much harder.'}
            </Body>
            {biggest && (
              <Body small muted>
                Biggest cash: {biggest.label} at {fmt(biggest.price)} for {fmtU(net(biggest, mode))}
                {unit ? ` (${money(net(biggest, mode) * unit, { signed: true })})` : ''}.
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
            const gt = tally(g.items, mode);
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
                    <Label color={gt.units > 0 ? t.green : t.mute}>
                      {fmtU(gt.units)}
                      {unit ? ` · ${money(gt.units * unit, { signed: true })}` : ''}
                    </Label>
                  </View>
                  {g.items.map((i, n) => (
                    <Row key={n} i={i} mode={mode} unit={unit} />
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
