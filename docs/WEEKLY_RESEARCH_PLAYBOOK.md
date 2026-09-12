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
4. `node scripts/validate-research.mjs` must pass.
5. Run the full pipeline: `fetch-odds` (Tuesday openers), `grade-results` (grades last week from finals), `build-board`, `publish-board`, `post-discord`.
6. Regenerate `docs/week-NN-2026-report.md` from the research (same sections as Week 1) and commit everything: `research.json`, `data/`, the report.
7. Post a second Discord message: "Week NN is live" with last week's Locked In record and the three highest-confidence plays.

## Guardrails
- Never publish a fabricated price, result, or record. If a number is unverified, label it.
- Estimates are probabilities between 0 and 1; keep the calibration honest: a 78% call should hit about 78% of the time over the season.
- No guaranteed-win language anywhere in `why` fields or Discord copy. Units, not dollars.
- Keep credit spend inside the policy in `scripts/fetch-odds.mjs`; the Tuesday run costs about 16 credits.
