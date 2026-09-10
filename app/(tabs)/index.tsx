import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label, PlayerRow } from '@/components/ui';
import { useBoard } from '@/lib/store';

export default function BoardScreen() {
  const { board } = useBoard();
  const router = useRouter();
  const gameLabel = (id?: string) => {
    const g = board.games.find((x) => x.id === id);
    return g ? `${g.away.abbr}@${g.home.abbr}` : '';
  };
  const open = (id?: string) => id && router.push({ pathname: '/game/[id]', params: { id } });
  return (
    <Screen
      title="Touchdown Board"
      subtitle="Max-confidence anytime-TD scorers across the slate, ranked by estimated probability. Prices switch to live consensus when the odds feed is on."
    >
      <Card accent="gold">
        <Label>How to read this</Label>
        <Body small muted>
          Est is our probability from goal-line share, end-zone targets, implied team totals and the
          opposing defense. Edge is est minus the price's implied probability. Green means the
          number is worth playing; a negative edge means the book is ahead of us.
        </Body>
      </Card>
      <H2>Top 20 by probability</H2>
      <View>
        {board.slateTop.map((p, i) => (
          <PlayerRow
            key={`${p.name}-${i}`}
            p={p}
            rank={i + 1}
            game={gameLabel(p.gameId)}
            onPress={() => open(p.gameId)}
          />
        ))}
      </View>
      <H2>Best value vs price</H2>
      <View>
        {board.slateValue.map((p, i) => (
          <PlayerRow
            key={`${p.name}-v${i}`}
            p={p}
            game={gameLabel(p.gameId)}
            onPress={() => open(p.gameId)}
          />
        ))}
      </View>
      {board.completed.length > 0 && (
        <>
          <H2>Already final</H2>
          {board.completed.map((c) => (
            <Card key={c.id}>
              <Body>{c.final}</Body>
              <Body small muted>
                TDs: {c.tds.join('; ')}
              </Body>
            </Card>
          ))}
        </>
      )}
      <Card>
        <Body small muted>
          {board.notes}
        </Body>
      </Card>
    </Screen>
  );
}
