# Weekly research playbook

What the Tuesday Routine does to turn a new NFL week into a new `research.json`. The standard is Week 1 (`docs/week-01-2026-report.md`): every team, every matchup, every touchdown scorer priced, sides and totals with confidence, prop leans, stacks. Real data, real wins, no fluff.

## Inputs (all free)

- `data/schedule.json` after `node scripts/fetch-schedule.mjs`: this week's games, ESPN ids, kickoff times, DraftKings spread/total/moneyline.
- `data/injuries.json` after `node scripts/fetch-injuries.mjs`.
- Last week's grading in `data/results/` (what the model got right and wrong; use it to calibrate estimates, never to hide misses).
- Web research per game (see below).

## Process

1. Run `fetch-schedule` and `fetch-injuries`. Confirm the week number and 13 to 16 games.
2. Fan out one research agent per game with the Week 1 brief: offseason and in-season changes for both teams, each offense vs the defense it faces (red-zone rates, goal-line share, end-zone targets, TE and RB pass-game usage, pressure and coverage tendencies), latest practice report, current spread/total/moneyline, posted anytime-TD prices from at least two books, three max-confidence TD scorers with estimated probability and a one-line reason, two value or longshot scorers, projected score, side lean and total lean with confidence 0 to 5, two or three prop leans on markets the pipeline prices, and two or three correlated stacks. Sources to prefer: team sites for injuries, ESPN, NFL.com, Sharp Football Analysis, Covers, SI Betting, BetMGM and FanDuel research, VSiN, Dimers. Say "verify" on any price that could not be confirmed at a book.
3. Write `src/data/research.json` in the shape of `docs/RESEARCH_SCHEMA.md`. Reuse the Week 1 file as the template. Bump `week`, `researchAsOf`, `generatedAt`. Build `bestBets` (12 to 18 entries: every side or total lean at confidence 3+, the top TD calls at 4+) and `crossStacks` (RB hammer, favorites moneyline, one SGP per time slot).
4. `node scripts/validate-research.mjs` must pass, and `node scripts/check-rosters.mjs` must report 0 problems (every pick and prop lean matched to its team on ESPN's current roster, spelled ESPN's way).
5. Run the full pipeline: `fetch-odds` (Tuesday openers), `grade-results` (grades last week from finals), `build-board`, `publish-board`, `post-discord`.
6. Regenerate `docs/week-NN-2026-report.md` from the research (same sections as Week 1) and commit everything: `research.json`, `data/`, the report.
7. Post a second Discord message: "Week NN is live" with last week's Locked In record and the three highest-confidence plays.

## Saturday build (the way Week 5 was run)

When the runner cannot pull prices (no `ODDS_API_KEY` in Actions) the whole week is built from this
session with the desk's relay, one agent per game:

1. `node scripts/fetch-schedule.mjs && node scripts/fetch-injuries.mjs && node scripts/grade-results.mjs`.
2. Save the Odds API event ids for the week to `data/odds/raw/<season>-w<wk>-events.json`
   (`sports/americanfootball_nfl/events` through the relay is free).
3. One agent per game with `docs/briefs/game-research-brief.md`: it pulls the game's prices
   (six credits), writes `research-draft/w<wk>/<game>.json`, and projects the volume props to
   `data/projections/w<wk>/<game>.json`.
4. `node scripts/ingest-odds-raw.mjs --week N` turns the raw pulls into `data/odds/latest.json`
   in the runner's own format (alternates kept whole, a main line synthesized for the board).
5. `RESEARCH_DIR=research-draft/w<wk> WEEK=N node scripts/assemble-research.mjs` reports every
   problem it finds (implied points order, de-vig, board depth); fix the drafts, then rerun with
   `WRITE=1`. It refuses to write a partial week. Then `node scripts/validate-research.mjs` and
   `node scripts/check-rosters.mjs`.
6. Merge the projections into `data/projections/<season>-w<wk>.json`, then
   `node scripts/five-leg.mjs --week N` for the five-leg tickets.
7. `node scripts/build-board.mjs` (attaches the five-leg tickets to each game and the Parlays
   tab), `node scripts/build-week-report.mjs`, commit, push; the site deploy picks up the bundled
   board.

## Guardrails

- Never publish a fabricated price, result, or record. If a number is unverified, label it.
- Probability before price (owner's rule, 2026-10-15). Rank touchdown scorers, props and card legs by how likely they are to hit. A high-probability pick whose price is a few points short of our number stays the pick: never swap it for a less likely player because his price sits closer to fair. Step down only when the price is badly short, meaning the book's implied probability is more than 5 points above our estimate, and say so. Show the price and the fair price next to every pick. (Why: on Thursday of Week 6 the desk named Dobbins the likeliest Denver scorer at the SEA 19, recommended Sutton for his price, and Dobbins scored on the next snaps.)
- Estimates are probabilities between 0 and 1; keep the calibration honest: a 78% call should hit about 78% of the time over the season.
- Card tickets are props only (owner's rule, 2026-10-15). Longshot and max-confidence cards are 4- or 5-leg tickets of yardage and reception props with no touchdown legs. On the Week 6 Thursday card the six touchdown legs went 0 for 6, while plus-money props priced +100 to +200 hit 43% of the time against 41% priced across the whole board (data/five-leg/2026-w06-tnf-card-results.json).
- Build each card ticket around one game script, and let a ticket sit entirely on one team when that is where the script points. Spread the scripts across the card (one Seattle passing night, one Denver ground game, one shootout) rather than forcing both teams into every ticket. This replaces the both-teams limit from the Week 5 Monday card (2026-10-16).
- Replay of the probability rule on Week 5: promoting every top-three scorer we gave 35% or better, unless the price was more than 5 points short, would have made 12 Locked In touchdown calls that went 7-5 for +4.0u at 1u each. The old edge-only rule made one call, which lost.
- No guaranteed-win language anywhere in `why` fields or Discord copy. Units, not dollars.
- Keep credit spend inside the policy in `scripts/fetch-odds.mjs`; the Tuesday run costs about 16 credits.
