import React from 'react';
import { Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/Screen';
import {
  Body,
  Card,
  Expandable,
  H2,
  InjuryList,
  Label,
  Markdown,
  PickCard,
  Pill,
  PlayerRow,
  StackCard,
  WinBar,
} from '@/components/ui';
import { useBoard } from '@/lib/store';
import { kickoffLabel } from '@/lib/format';
import { fmtAmerican, pct } from '@/lib/odds';
import { space, type, useTheme } from '@/theme';

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { board } = useBoard();
  const t = useTheme();
  const g = board.games.find((x) => x.id === id);
  if (!g)
    return (
      <Screen title="Game not found">
        <Body>This game is not on the current board.</Body>
      </Screen>
    );
  const live = g.live;
  const wp = live?.winProb ?? g.lines.winProb;
  const st = g.status;
  return (
    <>
      <Stack.Screen options={{ title: `${g.away.abbr} at ${g.home.abbr}` }} />
      <Screen
        title={`${g.away.short} at ${g.home.short}`}
        subtitle={`${kickoffLabel(g.kickoff)} · ${g.venue}`}
      >
        {st && st.state !== 'STATUS_SCHEDULED' && (
          <Pill
            text={`${st.detail}: ${g.away.abbr} ${st.score.away}, ${g.home.abbr} ${st.score.home}`}
            tone={st.state === 'STATUS_FINAL' ? 'neutral' : 'good'}
          />
        )}
        <Card>
          <Label>Lines</Label>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
            <Stat
              label="Spread"
              value={
                live?.spread.homePoint != null
                  ? `${g.home.abbr} ${live.spread.homePoint > 0 ? '+' : ''}${live.spread.homePoint}`
                  : g.lines.spread
              }
              sub={live ? 'live' : 'research'}
            />
            <Stat
              label="Total"
              value={String(live?.total.point ?? g.lines.total)}
              sub={
                live
                  ? `o${fmtAmerican(live.total.over)} u${fmtAmerican(live.total.under)}`
                  : 'research'
              }
            />
            <Stat
              label={`${g.away.abbr} ML`}
              value={fmtAmerican(live?.ml.away ?? g.lines.ml.away)}
              sub={live?.ml.bestAway != null ? `best ${fmtAmerican(live.ml.bestAway)}` : ''}
            />
            <Stat
              label={`${g.home.abbr} ML`}
              value={fmtAmerican(live?.ml.home ?? g.lines.ml.home)}
              sub={live?.ml.bestHome != null ? `best ${fmtAmerican(live.ml.bestHome)}` : ''}
            />
            <Stat
              label="Implied pts"
              value={`${g.lines.implied.away} / ${g.lines.implied.home}`}
              sub="away / home"
            />
          </View>
          <View style={{ marginTop: space.md }}>
            <WinBar
              away={g.away.abbr}
              home={g.home.abbr}
              pa={wp.away}
              ph={wp.home}
              live={!!live?.winProb}
            />
          </View>
          {!!g.sections.oddsNotes && (
            <View style={{ marginTop: space.sm }}>
              <Body small muted>
                {g.sections.oddsNotes}
              </Body>
            </View>
          )}
        </Card>

        <H2>Max-confidence TD scorers</H2>
        {g.top3.map((p, i) => (
          <PickCard key={p.name} p={p} rank={i + 1} />
        ))}
        <H2>Value and longshots</H2>
        {g.value.map((p) => (
          <PlayerRow key={p.name} p={p} />
        ))}

        <H2>
          {g.liveBoard?.length ? 'Live anytime-TD board' : 'Anytime-TD board (research prices)'}
        </H2>
        <Card>
          {(g.liveBoard?.length
            ? g.liveBoard
            : g.atdBoard.map((b) => ({
                name: `${b.name} (${b.team})`,
                best: b.live?.best ?? b.price,
                bestBook: b.live?.bestBook,
                consensus: b.live?.consensus ?? b.price,
                implied: b.implied,
              }))
          ).map((b, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: 6,
                borderBottomWidth: i === (g.liveBoard?.length || g.atdBoard.length) - 1 ? 0 : 1,
                borderColor: t.line,
              }}
            >
              <Text style={[type.body, { color: t.ink, flex: 1 }]}>{b.name}</Text>
              <Text style={[type.mono, { color: t.mute, width: 52, textAlign: 'right' }]}>
                {pct(b.implied)}
              </Text>
              <Text
                style={[
                  type.mono,
                  { color: t.ink, fontWeight: '700', width: 64, textAlign: 'right' },
                ]}
              >
                {fmtAmerican(b.consensus)}
              </Text>
              <Text style={[type.small, { color: t.mute, width: 84, textAlign: 'right' }]}>
                {b.best !== b.consensus ? `best ${fmtAmerican(b.best)}` : ''}
              </Text>
            </View>
          ))}
          {!!g.sections.atdNotes && !g.liveBoard?.length && (
            <Body small muted>
              {g.sections.atdNotes}
            </Body>
          )}
        </Card>

        <H2>Stacks</H2>
        {g.stacks.map((s, i) => (
          <StackCard key={i} legs={s.legs} why={s.why} kind={s.type} />
        ))}

        <H2>Injuries</H2>
        <Card>
          <Label>{g.away.short} (feed)</Label>
          <InjuryList items={g.injuryReport?.away ?? []} team={g.away.abbr} />
          <View style={{ height: space.md }} />
          <Label>{g.home.short} (feed)</Label>
          <InjuryList items={g.injuryReport?.home ?? []} team={g.home.abbr} />
          {!!g.sections.injuries && (
            <>
              <View style={{ height: space.md }} />
              <Label>Research notes</Label>
              <Markdown text={g.sections.injuries} />
            </>
          )}
        </Card>

        <H2>Research</H2>
        <Expandable title="Offense vs defense" open>
          <Markdown text={g.sections.matchup} />
        </Expandable>
        <Expandable title="Offseason">
          <Markdown text={g.sections.offseason} />
        </Expandable>
      </Screen>
    </>
  );
}
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ minWidth: 90 }}>
      <Text style={[type.label, { color: t.mute }]}>{label}</Text>
      <Text style={[type.mono, { color: t.ink, fontWeight: '700', fontSize: 16, marginTop: 2 }]}>
        {value}
      </Text>
      {!!sub && <Text style={[type.small, { color: t.mute }]}>{sub}</Text>}
    </View>
  );
}
