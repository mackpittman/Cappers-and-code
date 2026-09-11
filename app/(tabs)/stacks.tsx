import React from 'react';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label, StackCard } from '@/components/ui';
import { useBoard } from '@/lib/store';
import { fmtAmerican, pct } from '@/lib/odds';

export default function StacksScreen() {
  const { board } = useBoard();
  return (
    <Screen
      title="Stacks"
      subtitle="Correlated legs only. Cross-game builds first, then same-game stacks for every matchup. The code wins together."
    >
      <H2>Cross-game parlays</H2>
      {board.crossStacks.map((s, i) => (
        <StackCard key={i} legs={s.legs} why={s.why} kind={s.type} />
      ))}
      <H2>Upset leans</H2>
      {board.upsetLeans.map((u) => (
        <Card key={u.team} accent="contrarian">
          <Label>
            {u.team} ML {fmtAmerican(u.price)} · {pct(u.winProb)} win prob
          </Label>
          <Body small>{u.why}</Body>
        </Card>
      ))}
      {board.games.map((g) => (
        <React.Fragment key={g.id}>
          <H2>
            {g.away.short} at {g.home.short}
          </H2>
          {g.stacks.map((s, i) => (
            <StackCard key={i} legs={s.legs} why={s.why} kind={s.type} />
          ))}
        </React.Fragment>
      ))}
    </Screen>
  );
}
