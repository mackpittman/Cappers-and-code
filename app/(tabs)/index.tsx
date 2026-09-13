import React from 'react';
import { Text, View } from 'react-native';
import { type, useTheme } from '@/theme';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label, Pill, PlayerRow, StackCard } from '@/components/ui';
import type { BestBet, Board, Pick } from '@/lib/types';
import { useBoard } from '@/lib/store';
import { Paywall } from '@/components/Paywall';
import { RecordCard } from '@/components/Record';
import { supabaseConfigured } from '@/lib/supabase';
import { AddToSlip, betToSlip, pickToSlip } from '@/components/Slip';

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
  const windows = slateWindows(board);
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
          {windows.map((w) => (
            <React.Fragment key={w.key}>
              <H2>{w.title}</H2>
              {w.bets.length === 0 ? (
                <Card>
                  <Body small muted>
                    No Locked In side or total in this window. Scorers and props live on the Games
                    tab.
                  </Body>
                </Card>
              ) : (
                w.bets.map((b, i) => (
                  <Card key={i} accent={b.conf >= 4 ? 'green' : undefined}>
                    <Label>{b.gameLabel ?? b.game}</Label>
                    <Text style={[type.h2, { color: t.ink, marginBottom: 6 }]}>{b.bet}</Text>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Pill
                        text={`confidence ${b.conf}/5`}
                        tone={b.conf >= 4 ? 'good' : b.conf === 3 ? 'neutral' : 'warn'}
                      />
                      {w.started && <Pill text="kicked off" tone="warn" />}
                      <AddToSlip item={betToSlip(b.bet, b.game, b.gameLabel, b.conf)} compact />
                    </View>
                    <Body small muted>
                      {b.why}
                    </Body>
                  </Card>
                ))
              )}
              {w.scorers.length > 0 && (
                <Card>
                  <Label>Top scorers this window</Label>
                  <Body small>
                    {w.scorers
                      .map((p) => `${p.name} ${p.live?.best != null ? fmtAm(p.live.best) : ''}`)
                      .join(' · ')}
                  </Body>
                </Card>
              )}
            </React.Fragment>
          ))}
          {!!board.crossStacks?.length && (
            <>
              <H2>Cross-slate builds</H2>
              <Body small muted>
                The research desk's cross-game tickets. Ranked, priced parlays by category are on
                the Parlays tab.
              </Body>
              {board.crossStacks.map((st, i) => (
                <StackCard key={i} legs={st.legs} why={st.why} kind={st.type} />
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
                slip={pickToSlip(p, gameLabel(p.gameId), 'td-board')}
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
                slip={pickToSlip(p, gameLabel(p.gameId), 'value')}
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

const fmtAm = (n: number) => (n > 0 ? `+${n}` : `${n}`);
/** Kickoff window in US Eastern: the Sunday 1:00 slate, the 4:05/4:25 slate, and primetime. */
function windowKey(kickoffIso?: string): { key: string; title: string; order: number } {
  if (!kickoffIso) return { key: 'other', title: 'Other games', order: 9 };
  const d = new Date(kickoffIso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = get('weekday');
  const h = Number(get('hour'));
  if (wd === 'Sun' && h < 15) return { key: 'early', title: '1:00 slate', order: 1 };
  if (wd === 'Sun' && h < 19) return { key: 'late', title: '4:25 slate', order: 2 };
  if (wd === 'Sun') return { key: 'snf', title: 'Sunday night', order: 3 };
  if (wd === 'Mon') return { key: 'mnf', title: 'Monday night', order: 4 };
  if (wd === 'Thu') return { key: 'tnf', title: 'Thursday night', order: 0 };
  return { key: wd.toLowerCase(), title: `${wd} games`, order: 5 };
}
function slateWindows(board: Board) {
  const byId = new Map(board.games.map((g) => [g.id, g]));
  const now = Date.now();
  const map = new Map<
    string,
    {
      key: string;
      title: string;
      order: number;
      bets: BestBet[];
      scorers: Pick[];
      started: boolean;
    }
  >();
  const bucket = (kickoff?: string) => {
    const w = windowKey(kickoff);
    if (!map.has(w.key)) map.set(w.key, { ...w, bets: [], scorers: [], started: false });
    return map.get(w.key)!;
  };
  for (const g of board.games) {
    const w = bucket(g.kickoff);
    if (g.kickoff && Date.parse(g.kickoff) < now) w.started = true;
  }
  for (const b of board.bestBets ?? []) bucket(byId.get(b.game)?.kickoff).bets.push(b);
  for (const p of board.slateTop.slice(0, 12)) {
    const w = bucket(p.kickoff ?? byId.get(p.gameId ?? '')?.kickoff);
    if (w.scorers.length < 4) w.scorers.push(p);
  }
  return [...map.values()]
    .filter((w) => w.bets.length || w.scorers.length)
    .sort((a, b) => a.order - b.order);
}
