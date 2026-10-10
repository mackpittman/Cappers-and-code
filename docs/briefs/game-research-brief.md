# Game research brief (one agent per game)

You are the desk's researcher for ONE NFL game. Three deliverables, in this order, all written to
disk; your final text is a short JSON summary, not prose for a reader.

Your task names: the game id (`away-home`, lowercase, e.g. `chi-gb`), the ESPN id, the kickoff,
the Odds API event id, and the three output paths. The season is 2026, the week is 5. Today is
Saturday; Friday's practice reports and designations are final.

## 1. Pull the prices (one call, six credits)

**Skip this step if `data/odds/raw/2026-w05-<game>.json` already exists and the check command
below prints both books.** A re-pull spends credits for nothing. Read that file for every price.

Call the tool `mcp__Make__s6505830_odds_api_fetch` exactly once:

- `path`: `sports/americanfootball_nfl/events/<EVENT_ID>/odds`
- `query`: `bookmakers=draftkings,fanduel&markets=player_anytime_td,player_tds_over,player_receptions_alternate,player_reception_yds_alternate,player_rush_yds_alternate,player_pass_yds_alternate&oddsFormat=american&includeLinks=true`

The result is JSON shaped `{ result: { outputs: { tool_output: { statusCode, headers, data } } } }`
where `data` is the Odds API body as a **string**. Write that string, byte for byte, to
`data/odds/raw/2026-w05-<game>.json`. The harness saves a large tool result to a file and tells
you the path; read that file and extract `data` with node, for example:

```
node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");const i=t.indexOf("{");const r=JSON.parse(t.slice(i));const d=r.result?.outputs?.tool_output?.data??r.outputs?.tool_output?.data;fs.writeFileSync(process.argv[2],typeof d==="string"?d:JSON.stringify(d))' <saved-result-file> data/odds/raw/2026-w05-<game>.json
```

Then prove it: `node -e 'const j=require("./data/odds/raw/2026-w05-<game>.json");console.log(j.id,j.home_team,j.bookmakers.map(b=>b.key+":"+b.markets.map(m=>m.key).join("+")).join(" | "))'`
must print the event id and both books. If the call returns a non-200 status, retry once, then
stop and say so in your summary. Never call it a third time: every call spends credits.

## 2. Research the game -> `research-draft/w05/<game>.json`

Write this file as soon as it is complete, **before** starting step 3, so the work is saved if the
session is interrupted. If the file already exists and passes the shape check in step 4, keep it
and go straight to step 3.

One object in the `Game` shape of `docs/RESEARCH_SCHEMA.md`. Open `src/data/research.json` and
read `games[0]` first: that is the template for shape, field names, depth and tone. Match it.

- `id`, `espnId`, `kickoff` from your task; `venue` from ESPN; `away`/`home` as
  `{ abbr, name, short }` (name "Green Bay Packers", short "Packers").
- `lines`: from `data/schedule.json` (the entry with your `espnId`, field `espnLine`): `spread`
  as "GB -3.5", `total`, `ml.away`/`ml.home`; `winProb` is the moneyline with the vig removed
  (away + home = 1); `implied` team points from spread and total.
- `sections.offseason`, `sections.matchup`, `sections.injuries`, `sections.oddsNotes`,
  `sections.atdNotes`: markdown with **bold** and "- " bullets only. Matchup is the heart: each
  offense against the defense it draws (red-zone rate, goal-line share, end-zone targets, TE and RB
  pass-game usage, pressure and coverage), 1,200 to 2,500 characters. Injuries: Friday's report
  for both teams from `data/injuries.json` (`teams.<ABBR>`) and the team sites, who is out and
  where the touches go.
- `atdBoard`: at least 8 entries, the posted anytime price (the better of DraftKings and FanDuel
  from the file you just pulled) with `implied`. Prices from anywhere else carry no place here.
- `top3`: exactly three max-confidence touchdown scorers; `value`: two or three value or longshot
  scorers. Each `Pick` = `{ name, team, pos, price, implied, est, why }` with `price` from your
  pull (or `priceNote: "verify"` if the book has none), `est` the desk's own probability from role
  (goal-line share, end-zone targets, implied team total, the defence's touchdown-rate weakness).
  Calibration note from Week 4 grading: the 40-60% estimates hit 29-43%, so estimates have run high;
  a player you would have called 50% is 44%. Only players confirmed active on ESPN's depth chart.
- `stacks`: two or three correlated same-game or contrarian stacks, `{ legs, why, type }`.
- `market`: `projected` score, `side` ("GB -3.5" or ""), `sideConf` 0-5, `total` ("Under 41.5" or
  ""), `totalConf` 0-5, `why`, and two or three `propLeans` only on
  `player_pass_yds | player_rush_yds | player_reception_yds | player_receptions | player_pass_tds`,
  each with `side`, `line` (the book's main number from your pull: the point where over and under
  are both near -110) and `why`.

Sources to prefer: team sites, ESPN, NFL.com, Sharp Football Analysis, Covers, VSiN, Dimers,
FanDuel and BetMGM research. ESPN box-score spelling for every name (Jr., III included). Say
"verify" on anything you could not confirm. No guaranteed-win language. Units, not dollars. Keep
the web reading to what the game needs; this is one of fourteen games running in parallel.

## 3. Project the volume props -> `data/projections/w05/<game>.json`

Follow `docs/briefs/receiver-props-brief.md` exactly (its JSON shape, its blends, its flags). The
desk turns these means into the five-leg ticket. Project from role and pace, not from the posted
line; use the lines you pulled only to sanity-check (a projection 40% off the book's main number
needs a stated reason in `why`). Every player you project must be confirmed active for Sunday,
and a player with a Friday designation carries the `questionable`/`doubtful`/`out` flag.

## 4. Check, then summarize

Shape check for the draft (must print `ok`):

```
node -e 'const g=require("./research-draft/w05/<game>.json");const bad=[];if(!g.id||!g.espnId)bad.push("id");if((g.top3||[]).length!==3)bad.push("top3");if(!(g.value||[]).length)bad.push("value");for(const k of ["offseason","matchup","injuries"])if(!(g.sections?.[k]?.length>40))bad.push(k);if(!g.market?.projected)bad.push("projected");if((g.atdBoard||[]).length<4)bad.push("atdBoard");console.log(bad.length?bad:"ok")'
```

Return `{ game, odds: { file, status, books }, research: { file, top3: [names], side, total },
projection: { file, players }, flags: [strings], unverified: [strings] }`. Nothing else.
