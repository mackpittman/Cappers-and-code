import React from 'react';
import { Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label, Pill } from '@/components/ui';
import { useBoard } from '@/lib/store';
import { fmtAmerican, pct } from '@/lib/odds';
import { space, type, useTheme } from '@/theme';
import type { Parlay, ParlayCategory } from '@/lib/types';
import { AddToSlip, parlayToSlip } from '@/components/Slip';
import { StackCard } from '@/components/ui';

const CATEGORY_ORDER: ParlayCategory['key'][] = [
  'twoPlus',
  'anytime',
  'sameGame',
  'sides',
  'totals',
  'model',
];

function ParlayCard({ p, category }: { p: Parlay; category: ParlayCategory['key'] }) {
  const t = useTheme();
  const headline =
    category === 'twoPlus'
      ? `fair ${fmtAmerican(p.fairPrice)} · play ${fmtAmerican(p.minPrice)} or better`
      : p.price != null
        ? fmtAmerican(p.price)
        : '';
  return (
    <Card accent={p.rank === 1 ? 'green' : undefined}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          flexWrap: 'wrap',
          marginBottom: space.sm,
        }}
      >
        <Pill text={`#${p.rank}`} tone={p.rank === 1 ? 'accent' : 'neutral'} />
        {!!headline && (
          <Text style={[type.h2, { color: t.green, fontSize: 22, flexShrink: 1 }]}>{headline}</Text>
        )}
        {p.prob != null && <Pill text={`${pct(p.prob)} model`} tone="good" />}
        {p.ev != null && (
          <Pill
            text={`${p.ev >= 0 ? '+' : ''}${Math.round(p.ev * 100)}% EV`}
            tone={p.ev >= 0 ? 'good' : 'bad'}
          />
        )}
      </View>
      <View style={{ gap: 6 }}>
        {p.legs.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
            <Text style={[type.mono, { color: t.green }]}>{'〉'}</Text>
            <Text style={[type.bodyBold, { color: t.ink, flex: 1 }]}>{l.label}</Text>
            <Text style={[type.mono, { color: t.ink2 }]}>
              {l.price != null ? `${fmtAmerican(l.price)} ${l.book}` : l.book}
              {l.prob != null && l.type !== 'text' ? ` · ${pct(l.prob)}` : ''}
            </Text>
          </View>
        ))}
      </View>
      {p.legs.some((l) => l.moved) && (
        <Text style={[type.small, { color: t.mute, marginTop: space.xs }]}>
          {p.legs
            .filter((l) => l.moved)
            .map((l) => `${l.label}: ${l.moved}`)
            .join(' · ')}
        </Text>
      )}
      <Text style={[type.small, { color: t.ink2, marginTop: space.sm }]}>{p.why}</Text>
      {category !== 'model' && (
        <View style={{ marginTop: space.sm }}>
          <AddToSlip item={parlayToSlip(p, category)} compact />
        </View>
      )}
    </Card>
  );
}

export default function ParlaysScreen() {
  const { board } = useBoard();
  const parlays = board.parlays;
  return (
    <Screen
      title="Parlays"
      subtitle="Ranked one to five in every category from the model's numbers and the better of FanDuel and DraftKings. Units, not dollars."
    >
      {!parlays ? (
        <Card>
          <Label>No parlay board yet</Label>
          <Body small muted>
            The parlay board is built with the daily update. Pull to refresh after the next run.
          </Body>
        </Card>
      ) : (
        <>
          <Card>
            <Label>Books: {parlays.books.join(' / ')}</Label>
            <Body small muted>
              {parlays.note}
            </Body>
            {!!parlays.oddsFetchedAt && (
              <Body small muted>
                TD prices pulled {new Date(parlays.oddsFetchedAt).toLocaleString()}. Built{' '}
                {new Date(parlays.builtAt).toLocaleString()}.
              </Body>
            )}
          </Card>
          {CATEGORY_ORDER.map((key) => {
            const c = parlays.categories.find((x) => x.key === key);
            if (!c) return null;
            return (
              <React.Fragment key={key}>
                <H2>{c.title}</H2>
                <Body small muted>
                  {c.note}
                </Body>
                <View style={{ height: space.sm }} />
                {c.parlays.length ? (
                  c.parlays.map((p) => <ParlayCard key={p.rank} p={p} category={key} />)
                ) : (
                  <Card>
                    <Body small muted>
                      Nothing qualifies yet. Legs need a FanDuel or DraftKings price and a model
                      edge.
                    </Body>
                  </Card>
                )}
              </React.Fragment>
            );
          })}
          <H2>Upset leans</H2>
          {board.upsetLeans.map((u) => (
            <Card key={u.team} accent="contrarian">
              <Label>
                {u.team} ML {fmtAmerican(u.price)} · {pct(u.winProb)} win prob
              </Label>
              <Body small>{u.why}</Body>
              <View style={{ marginTop: space.sm }}>
                <AddToSlip
                  item={{
                    kind: 'ml',
                    label: `${u.team} ML`,
                    price: u.price,
                    book: 'research',
                    model_prob: u.winProb,
                    source: 'parlays',
                  }}
                  compact
                />
              </View>
            </Card>
          ))}
          <H2>Same-game stacks by matchup</H2>
          {board.games.map((g) =>
            g.stacks.length ? (
              <React.Fragment key={g.id}>
                <Label>
                  {g.away.short} at {g.home.short}
                </Label>
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
                      game_label: `${g.away.abbr}@${g.home.abbr}`,
                      price: null,
                      book: null,
                      legs: s.legs.map((l) => ({ label: l, price: null })),
                      source: 'parlays',
                    }}
                  />
                ))}
              </React.Fragment>
            ) : null,
          )}
          <Body small muted>
            Expected value uses model probabilities, not guarantees. Cross-game legs are treated as
            independent; same-game tickets carry a correlation factor and books price them
            differently. 2+ TD prices are not in the feed, so confirm them on the book before
            betting.
          </Body>
        </>
      )}
    </Screen>
  );
}
