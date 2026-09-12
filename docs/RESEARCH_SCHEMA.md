# research.json schema

`src/data/research.json` is the weekly model. The app, the pipeline, the Discord digest and the grader all read it. `scripts/validate-research.mjs` enforces this shape; run it before committing.

```
{
  season: 2026, week: 2, researchAsOf: ISO string, generatedAt: ISO string, notes: string,
  completed: [{ id, away, home, final, tds: [] }],           // games already final when research was written
  games: [ Game ],
  crossStacks: [ Stack ], upsetLeans: [{ team, price, winProb, why }],
  bestBets: [{ game: <game id>, bet: "DEN +2.5" | "Under 42.5" | "Jahmyr Gibbs ATD -330", conf: 1-5, why }],
  creditPlan: { monthly, phases, reserve, note }
}
Game = {
  id: "den-kc" (away-home, lowercase), espnId: "401872931" (from data/schedule.json), kickoff: ISO, venue,
  away: { abbr, name, short }, home: { abbr, name, short },
  lines: { spread: "KC -2.5", total: 42.5, ml: { away, home }, winProb: { away, home }, implied: { away, home } },
  sections: { offseason, matchup, injuries, oddsNotes, atdNotes },   // markdown text, **bold** and "- " bullets only
  atdBoard: [{ name, team, price, implied }],                          // 4+ entries, posted anytime-TD prices
  top3: [ Pick, Pick, Pick ],  value: [ Pick, ... ],
  stacks: [{ legs: [..], why, type: "sgp" | "contrarian" }],
  market: { projected: { away, home }, side: "DEN +2.5" | "", sideConf: 0-5, total: "Under 42.5" | "", totalConf: 0-5, why,
            propLeans: [{ player, market: player_pass_yds | player_rush_yds | player_reception_yds | player_receptions | player_pass_tds, side: over|under, line, why }] }
}
Pick = { name, team, pos, price: number|null, priceNote?: "verify"|"est.", implied: number|null, est: 0-1, why }
```

Rules that keep the grader honest: `market.side` and `bestBets` sides use the team abbreviation and the number ("PHI -5.5"); totals use "Over"/"Under" plus the number; TD bets end in "ATD" after the player's name spelled the way ESPN spells it (Jr./III included). Player names in `propLeans` and picks must match ESPN box-score spelling.
