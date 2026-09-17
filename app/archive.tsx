import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label } from '@/components/ui';
import { PlaySheets } from '@/components/Sheets';
import { useBoard } from '@/lib/store';
import { space, type, useTheme } from '@/theme';

/** Past weeks: the graded record by week and every play sheet that is not this week's. */
export default function ArchiveScreen() {
  const { board } = useBoard();
  const t = useTheme();
  const router = useRouter();
  const weeks = (board.record?.weeks ?? []).filter((w) => w.week !== board.week);
  const fmt = (k: string, w: (typeof weeks)[number]) => {
    const s = w.summary?.[k];
    return s ? `${s.wins}-${s.losses}${s.pushes ? `-${s.pushes}` : ''}` : '';
  };
  return (
    <Screen
      title="Archive"
      subtitle="Every past week, graded and kept. The live board only shows the current slate."
    >
      <H2>Record by week</H2>
      {weeks.length === 0 ? (
        <Card>
          <Body small muted>
            Nothing archived yet.
          </Body>
        </Card>
      ) : (
        weeks.map((w) => (
          <Pressable key={w.week} onPress={() => router.push('/results')}>
            <Card>
              <Label color={t.green}>Week {w.week}</Label>
              <Text style={[type.h2, { color: t.ink, marginTop: 4 }]}>
                Locked In {fmt('lockedIn', w)}
              </Text>
              <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap', marginTop: 4 }}>
                <Text style={[type.small, { color: t.ink2 }]}>Leans {fmt('lean', w)}</Text>
                <Text style={[type.small, { color: t.ink2 }]}>Top-3 TD {fmt('top3', w)}</Text>
                <Text style={[type.small, { color: t.ink2 }]}>2+ TD {fmt('td2', w)}</Text>
                <Text style={[type.small, { color: t.ink2 }]}>Props {fmt('props', w)}</Text>
              </View>
              <Text style={[type.small, { color: t.mute, marginTop: space.xs }]}>
                {w.finals} of {w.games} games final. Tap for the ticket ledger.
              </Text>
            </Card>
          </Pressable>
        ))
      )}
      <PlaySheets archive currentWeek={board.week} />
    </Screen>
  );
}
