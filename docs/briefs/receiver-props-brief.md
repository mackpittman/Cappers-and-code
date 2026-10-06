# Receiver props brief (one agent per game)

You are projecting volume props for ONE NFL game for a betting desk. The desk turns your means into
probabilities (Poisson for catches, wide normal for yards) and builds a five-leg ticket from the
alternate lines, so the mean is the deliverable. Price-shopping is secondary.

Do, in order:

1. Confirm both rosters on ESPN's current depth chart and the latest practice report. Name every
   skill player who is Out, Doubtful or Questionable and what happens to their targets or carries.
2. For each team, estimate pass attempts and rush attempts for this game from the posted total and
   spread, the team's season pace, and the opponent's pass-rate-over-expected allowed.
3. For every receiver, tight end and running back likely to see three or more targets, give:
   - targets (blend: 50% last three games, 50% season, then move the absent teammates' targets to
     the players who actually took them in prior absences),
   - catch rate (regress toward 68% for WRs, 72% for TEs, 78% for RBs; weight the player's own rate
     by targets seen),
   - projected catches, projected receiving yards (catches x regressed yards per catch x the
     opponent's factor against that position, capped between 0.85 and 1.15),
   - for the lead backs, projected carries and rushing yards the same way.
4. Flags on each player: `questionable`, `one-game-sample` (the role exists in a single game),
   `new-role` (a change of QB or scheme this week), `weather`, `revenge-narrative` (ignore it; flag
   it so the desk knows you did).
5. Write the JSON to the path in your task:

```
{ "game": "tb-dal", "kick": "2026-10-09T00:15:00Z", "weather": "...",
  "teams": { "TB": { "passAtt": 34, "rushAtt": 25 }, "DAL": { ... } },
  "players": [
    { "team": "DAL", "player": "CeeDee Lamb", "pos": "WR",
      "targets": 9.4, "catchRate": 0.66, "receptions": 6.2, "recYds": 84,
      "carries": null, "rushYds": null, "flags": [], "why": "one line" }
  ],
  "sources": ["..."] }
```

Rules: ESPN box-score spelling for every name (Jr., III included). Never project a player you could
not confirm active. Say which numbers you could not verify. Do not invent a stat line; a blank with
a note beats a guess.
