import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Card, H2, Pill, WinBar } from '@/components/ui';
import { useBoard } from '@/lib/store';
import { dayKey, kickoffLabel } from '@/lib/format';
import { fmtAmerican } from '@/lib/odds';
import { space, type, useTheme } from '@/theme';

export default function GamesScreen() {
  const { board } = useBoard();
  const router = useRouter();
  const t = useTheme();
  const days = Array.from(new Set(board.games.map((g) => dayKey(g.kickoff))));
  return (
    <Screen
      title="Games"
      subtitle="Every game on the slate: spread, total, vig-free win probability. Tap a game for the full model."
    >
      {days.map((day) => (
        <View key={day}>
          <H2>{day}</H2>
          {board.games
            .filter((g) => dayKey(g.kickoff) === day)
            .map((g) => {
              const live = g.live;
              const spread =
                live?.spread.homePoint != null
                  ? `${live.spread.homePoint < 0 ? g.home.abbr : g.away.abbr} ${live.spread.homePoint < 0 ? live.spread.homePoint : -live.spread.homePoint}`
                  : g.lines.spread;
              const total = live?.total.point ?? g.lines.total;
              const wp = live?.winProb ?? g.lines.winProb;
              const st = g.status;
              const done = st?.state === 'STATUS_FINAL';
              const inPlay = st?.state === 'STATUS_IN_PROGRESS';
              return (
                <Pressable
                  key={g.id}
                  onPress={() => router.push({ pathname: '/game/[id]', params: { id: g.id } })}
                >
                  <Card>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={[type.h1, { color: t.ink }]}>
                        {g.away.short} <Text style={{ color: t.mute, fontSize: 14 }}>at</Text>{' '}
                        {g.home.short}
                      </Text>
                      {done ? (
                        <Pill text={`Final ${st!.score.away}-${st!.score.home}`} tone="neutral" />
                      ) : inPlay ? (
                        <Pill text={`Live ${st!.score.away}-${st!.score.home}`} tone="good" />
                      ) : null}
                    </View>
                    <Text style={[type.small, { color: t.ink2, marginTop: 2 }]}>
                      {kickoffLabel(g.kickoff)} · {g.venue}
                    </Text>
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: 8,
                        marginTop: space.sm,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Pill text={spread} tone="accent" />
                      <Pill text={`O/U ${total}`} />
                      <Pill
                        text={`ML ${fmtAmerican(live?.ml.away ?? g.lines.ml.away)} / ${fmtAmerican(live?.ml.home ?? g.lines.ml.home)}`}
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
                    <Text style={[type.small, { color: t.ink2, marginTop: space.sm }]}>
                      Top plays: {g.top3.map((p) => p.name).join(' · ')}
                    </Text>
                  </Card>
                </Pressable>
              );
            })}
        </View>
      ))}
    </Screen>
  );
}
