import React from 'react';
import { Text, View } from 'react-native';
import { type, useTheme } from '@/theme';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label, Pill, PlayerRow } from '@/components/ui';
import { useBoard } from '@/lib/store';
import { Paywall } from '@/components/Paywall';
import { RecordCard } from '@/components/Record';
import { supabaseConfigured } from '@/lib/supabase';

export default function BoardScreen() {
  const { board, entitlement, authReady } = useBoard();
  const gated = supabaseConfigured && !entitlement?.active;
  const router = useRouter();
  const t = useTheme();
  const gameLabel = (id?: string) => {
    const g = board.games.find((x) => x.id === id);
    return g ? `${g.away.abbr}@${g.home.abbr}` : '';
  };
  const open = (id?: string) => id && router.push({ pathname: '/game/[id]', params: { id } });
  return (
    <Screen
      hero
      title="Today's Edge"
      subtitle="The model prices every game, every touchdown scorer and the key props. White is information, green is signal. Prices switch to live consensus when the feed is on."
    >
      {gated ? (
        <Paywall />
      ) : (
        <>
          <Card accent="green">
            <Label color={t.green}>How to read this</Label>
            <Body small muted>
              Est is the model's probability from goal-line share, end-zone targets, implied team
              totals and the opposing defense. Edge is est minus the price's implied probability.
              Green means the number is worth playing. Units, not dollars.
            </Body>
          </Card>
          {!!board.bestBets?.length && (
            <>
              <H2>Locked In</H2>
              {board.bestBets.map((b, i) => (
                <Card key={i} accent={b.conf >= 4 ? 'green' : undefined}>
                  <Label>{b.gameLabel ?? b.game}</Label>
                  <Text style={[type.h2, { color: t.ink, marginBottom: 6 }]}>{b.bet}</Text>
                  <Pill
                    text={`confidence ${b.conf}/5`}
                    tone={b.conf >= 4 ? 'good' : b.conf === 3 ? 'neutral' : 'warn'}
                  />
                  <Body small muted>
                    {b.why}
                  </Body>
                </Card>
              ))}
            </>
          )}
          <H2>Record</H2>
          <RecordCard board={board} />
          <H2>TD Board</H2>
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
          <H2>Value vs Market</H2>
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
        </>
      )}
    </Screen>
  );
}
