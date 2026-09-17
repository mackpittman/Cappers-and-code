import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { space, type, useTheme } from '@/theme';
import { Body, Card, H2, Label, Pill, PlayerRow, StackCard } from '@/components/ui';
import { ParlayCard } from '@/components/ParlayCard';
import { AddToSlip, betToSlip, pickToSlip } from '@/components/Slip';
import { fmtAmerican, pct } from '@/lib/odds';
import { kickoffLabel } from '@/lib/format';
import type { Board, Parlay, ParlayCategory, Ticket } from '@/lib/types';
import { ticketEv, ticketToSlip, type Primetime as PrimetimeGame } from '@/lib/primetime';

const KIND_TITLE: Record<Ticket['kind'], string> = {
  twoPlus: '2+ touchdowns',
  anytime: 'Anytime TD parlays',
  sgp: 'Same-game parlays',
  cross: 'Cross-game',
  contrarian: 'Contrarian',
  side: 'Side',
  total: 'Total',
};
const KIND_ORDER: Ticket['kind'][] = [
  'twoPlus',
  'anytime',
  'sgp',
  'side',
  'total',
  'contrarian',
  'cross',
];

function TicketCard({ tk, pt, first }: { tk: Ticket; pt: PrimetimeGame; first: boolean }) {
  const t = useTheme();
  const ev = ticketEv(tk);
  const fmt = (n: number | null | undefined) => (n == null ? '' : fmtAmerican(n));
  const headline =
    tk.price != null
      ? fmt(tk.price)
      : tk.minPrice != null
        ? `play ${fmt(tk.minPrice)} or better`
        : 'price at the book';
  return (
    <Card accent={first ? 'green' : undefined}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          flexWrap: 'wrap',
          marginBottom: space.sm,
        }}
      >
        <Text style={[type.h2, { color: t.green, fontSize: 22, flexShrink: 1 }]}>{headline}</Text>
        {tk.prob != null && <Pill text={`${pct(tk.prob)} model`} tone="good" />}
        {ev != null && (
          <Pill
            text={`${ev >= 0 ? '+' : ''}${Math.round(ev * 100)}% EV`}
            tone={ev >= 0 ? 'good' : 'bad'}
          />
        )}
        {!!tk.book && <Pill text={tk.book} tone="neutral" />}
      </View>
      {!!tk.label && <Label>{tk.label}</Label>}
      <View style={{ gap: 6, marginTop: tk.label ? 4 : 0 }}>
        {tk.legs.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
            <Text style={[type.mono, { color: t.green }]}>{'〉'}</Text>
            <Text style={[type.bodyBold, { color: t.ink, flex: 1 }]}>{l.label}</Text>
            <Text style={[type.mono, { color: t.ink2 }]}>
              {l.price != null ? fmtAmerican(l.price) : ''}
              {l.book ? ` ${l.book}` : ''}
            </Text>
          </View>
        ))}
      </View>
      <Text style={[type.small, { color: t.ink2, marginTop: space.sm }]}>{tk.why}</Text>
      <View style={{ marginTop: space.sm }}>
        <AddToSlip item={ticketToSlip(tk, pt.game)} compact />
      </View>
    </Card>
  );
}

/** Builder parlays whose legs all sit in this game (the 2+ singles and same-game tickets). */
function builderParlays(board: Board, gameId: string): { p: Parlay; key: ParlayCategory['key'] }[] {
  const out: { p: Parlay; key: ParlayCategory['key'] }[] = [];
  for (const c of board.parlays?.categories ?? [])
    for (const p of c.parlays)
      if (p.legs.length && p.legs.every((l) => l.game === gameId)) out.push({ p, key: c.key });
  return out;
}

export function Primetime({ board, pt }: { board: Board; pt: PrimetimeGame }) {
  const t = useTheme();
  const router = useRouter();
  const g = pt.game;
  const gameLabel = `${g.away.abbr}@${g.home.abbr}`;
  const live = g.live;
  const spread =
    live?.spread.homePoint != null
      ? `${live.spread.homePoint < 0 ? g.home.abbr : g.away.abbr} -${Math.abs(live.spread.homePoint)}`
      : g.lines.spread;
  const total = live?.total.point ?? g.lines.total;
  const ml = {
    away: live?.ml.away ?? g.lines.ml.away,
    home: live?.ml.home ?? g.lines.ml.home,
  };
  const started = Date.parse(g.kickoff) < Date.now();
  const bets = (board.bestBets ?? []).filter((b) => b.game === g.id);
  const tickets = [...(g.tickets ?? [])].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const fromBuilder = builderParlays(board, g.id);
  const scorers = [...g.top3, ...g.value].map((p) => ({ ...p, gameId: g.id, kickoff: g.kickoff }));
  let lastKind: Ticket['kind'] | null = null;
  return (
    <>
      <Pressable onPress={() => router.push({ pathname: '/game/[id]', params: { id: g.id } })}>
        <Card accent="green">
          <Label color={t.green}>{pt.title}</Label>
          <Text style={[type.h1, { color: t.ink, marginTop: 4 }]}>
            {g.away.short} at {g.home.short}
          </Text>
          <Text style={[type.small, { color: t.mute, marginBottom: space.sm }]}>
            {kickoffLabel(g.kickoff)}
            {g.venue ? ` · ${g.venue}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Pill text={spread} tone="neutral" />
            <Pill text={`total ${total}`} tone="neutral" />
            <Pill
              text={`${g.away.abbr} ${fmtAmerican(ml.away)} / ${g.home.abbr} ${fmtAmerican(ml.home)}`}
              tone="neutral"
            />
            {g.status?.state === 'STATUS_FINAL' ? (
              <Pill text={`final ${g.status.score.away}-${g.status.score.home}`} tone="accent" />
            ) : started && g.status ? (
              <Pill
                text={`${g.status.detail} · ${g.status.score.away}-${g.status.score.home}`}
                tone="warn"
              />
            ) : null}
          </View>
          {!!g.market?.why && (
            <Text style={[type.small, { color: t.ink2, marginTop: space.sm }]}>{g.market.why}</Text>
          )}
          <Text style={[type.small, { color: t.mute, marginTop: space.sm }]}>
            Tap for the full matchup, injuries and prop lines.
          </Text>
        </Card>
      </Pressable>

      <H2>Locked in</H2>
      {bets.length === 0 ? (
        <Card>
          <Body small muted>
            No Locked In side, total or scorer on this game.
          </Body>
        </Card>
      ) : (
        bets.map((b, i) => (
          <Card key={i} accent={b.conf >= 4 ? 'green' : undefined}>
            <Text style={[type.h2, { color: t.ink, marginBottom: 6 }]}>{b.bet}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Pill
                text={`confidence ${b.conf}/5`}
                tone={b.conf >= 4 ? 'good' : b.conf === 3 ? 'neutral' : 'warn'}
              />
              {started && <Pill text="kicked off" tone="warn" />}
              <AddToSlip item={betToSlip(b.bet, b.game, gameLabel, b.conf)} compact />
            </View>
            <Body small muted>
              {b.why}
            </Body>
          </Card>
        ))
      )}

      <H2>{pt.short} parlays</H2>
      {tickets.length === 0 && fromBuilder.length === 0 ? (
        <Card>
          <Body small muted>
            No tickets on this game yet. The desk posts them once prices are up, and the builder
            adds its own after the pre-kick pull.
          </Body>
        </Card>
      ) : null}
      {tickets.map((tk, i) => {
        const header = tk.kind !== lastKind ? KIND_TITLE[tk.kind] : null;
        lastKind = tk.kind;
        return (
          <React.Fragment key={i}>
            {header && <Label>{header}</Label>}
            <TicketCard tk={tk} pt={pt} first={i === 0} />
          </React.Fragment>
        );
      })}
      {fromBuilder.length > 0 && (
        <>
          <Label>From the builder, live FD/DK prices</Label>
          {fromBuilder.map(({ p, key }, i) => (
            <ParlayCard key={`${key}-${i}`} p={p} category={key} />
          ))}
        </>
      )}

      {g.stacks.length > 0 && (
        <>
          <H2>Stacks</H2>
          {g.stacks.map((s, i) => (
            <StackCard
              key={i}
              legs={s.legs}
              why={s.why}
              kind={s.type}
              slip={{
                kind: 'stack',
                label: s.legs.join(' + '),
                detail: s.type === 'sgp' ? 'same-game stack' : s.type,
                game_id: g.id,
                game_label: gameLabel,
                price: null,
                book: null,
                legs: s.legs.map((l) => ({ label: l, price: null })),
                source: 'primetime',
              }}
            />
          ))}
        </>
      )}

      <H2>Scorers</H2>
      <View>
        {scorers.map((p, i) => (
          <PlayerRow
            key={`${p.name}-${i}`}
            p={p}
            rank={i + 1}
            onPress={() => router.push({ pathname: '/game/[id]', params: { id: g.id } })}
            slip={pickToSlip(p, gameLabel, 'primetime')}
          />
        ))}
      </View>

      {!!g.market?.propLeans?.length && (
        <>
          <H2>Prop leans</H2>
          {g.market.propLeans.map((pl, i) => {
            const line = g.propLines?.find(
              (x) => x.market === pl.market && x.name.toLowerCase() === pl.player.toLowerCase(),
            );
            const label = `${pl.player} ${pl.side} ${pl.line} ${pl.market.replace('player_', '').replace(/_/g, ' ')}`;
            return (
              <Card key={i}>
                <Text style={[type.bodyBold, { color: t.ink }]}>{label}</Text>
                {line && line.line != null && (
                  <Text style={[type.small, { color: t.mute, marginTop: 2 }]}>
                    Book line {line.line}
                    {pl.side === 'over' && line.over != null
                      ? ` · over ${fmtAmerican(line.over)}`
                      : ''}
                    {pl.side === 'under' && line.under != null
                      ? ` · under ${fmtAmerican(line.under)}`
                      : ''}
                  </Text>
                )}
                <Text style={[type.small, { color: t.ink2, marginTop: space.xs }]}>{pl.why}</Text>
                <View style={{ marginTop: space.sm }}>
                  <AddToSlip
                    item={{
                      kind: 'prop',
                      label,
                      detail: 'prop lean',
                      game_id: g.id,
                      game_label: gameLabel,
                      price: pl.side === 'over' ? (line?.over ?? null) : (line?.under ?? null),
                      book: line ? 'FD/DK' : 'research',
                      model_prob: null,
                      source: 'primetime',
                    }}
                    compact
                  />
                </View>
              </Card>
            );
          })}
        </>
      )}
      <Card>
        <Body small muted>
          Model probabilities, not guarantees. Same-game legs are correlated and books price them
          their own way; treat the listed parlay prices as the number to beat. Units, not dollars.
        </Body>
      </Card>
    </>
  );
}
