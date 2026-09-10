# Cappers & Code

NFL touchdown board that updates itself. Weekly research (every team's offseason, offense vs the defense it draws, practice reports) is merged every morning with the live schedule, ESPN's injury feed and prices from The Odds API, then served to an Expo mobile app.

## What is in here

| Path                                  | Purpose                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/data/research.json`              | The weekly research: per game offseason notes, matchup notes, top-3 TD scorers with estimated probability, value plays, stacks, cross-game parlays.                                                                       |
| `scripts/fetch-schedule.mjs`          | Current week schedule, status, scores and consensus line from ESPN's public scoreboard (no key).                                                                                                                          |
| `scripts/fetch-injuries.mjs`          | League-wide injury feed from ESPN (no key), trimmed to name, position, status, note.                                                                                                                                      |
| `scripts/fetch-odds.mjs`              | Game lines and `player_anytime_td` props from The Odds API. Writes `data/odds/latest.json` and appends a daily row per player to `data/odds/history.jsonl` for price-movement tracking.                                   |
| `scripts/build-board.mjs`             | Merges everything into `data/board.json`, the single file the app reads. Adds live consensus/best price, edge (est minus implied), opening price and movement, injury report per team, slate-wide top-20 and value lists. |
| `.github/workflows/daily-board.yml` | Runs the four scripts daily at 11:00 UTC (and Sunday 15:00 UTC) and commits the data.                                                                                                                                     |
| `app/`, `src/`                        | Expo Router app: Board, Games, Game detail, Stacks, Settings.                                                                                                                                                             |

## Daily update flow

1. A scheduler runs `fetch-schedule → fetch-injuries → fetch-odds → build-board` and commits `data/`. Two schedulers are supported and can coexist safely (the pull log prevents double spending): the GitHub Action in `.github/workflows/daily-board.yml` (needs the `ODDS_API_KEY` repository secret) and a Claude Code Routine that runs the same commands in a fresh session once a day at 16:30 UTC.
2. The app fetches `board.json` from the raw GitHub URL on launch and on pull-to-refresh, caches it locally, and falls back to the bundled copy offline.
3. Optional: paste your own Odds API key in Settings and tap **Pull live prices now** for a same-minute refresh on game day.

## Setup

1. Get a free key at https://the-odds-api.com/ (500 credits a month).
2. Add it as the repository secret `ODDS_API_KEY`.
3. Enable Actions. Trigger **Cappers & Code daily board** manually once (workflow_dispatch) to seed `data/odds/`.
4. Point the app at the board. The default `expo.extra.boardUrl` in `app.json` is the GitHub API contents URL for `data/board.json` on `main`.
   - **Private repo (current state):** in the app's Settings, paste a fine-grained GitHub token with read access to Contents on this repo. The app sends it as a bearer token.
   - **Public repo:** flip the repo to public and set the Board URL to `https://raw.githubusercontent.com/mackpittman/cappers-and-code/main/data/board.json`; no token needed anywhere.
   - **Keyless option:** create a public Gist with a `board.json` file, add secrets `BOARD_GIST_ID` and `GIST_TOKEN` (a token with the gist scope). The workflow then publishes the board there every run; set the app's Board URL to the Gist's raw URL (`https://gist.githubusercontent.com/<user>/<id>/raw/board.json`) and leave the token blank.
   - Any other JSON host (GitHub Pages, S3, Supabase Storage) works too.

### Credit budget on the free tier

| Call                                          | Credits                              |
| --------------------------------------------- | ------------------------------------ |
| Game lines (h2h, spreads, totals; one region) | 3 per run                            |
| Props (`player_anytime_td`, one region)       | 1 per game inside `PROPS_DAYS_AHEAD` |
| Event list                                    | free                                 |

Daily run with a 4-day props window is roughly 3 + 16 on Wednesday through Sunday and 3 on other days, about 420 credits a month. Set `PROPS_DAYS_AHEAD=2` in the workflow to cut it further.

## Run the app

```bash
pnpm install
pnpm start        # Expo dev server
pnpm typecheck
pnpm test         # odds math and name matching
pnpm update:daily # run the whole pipeline locally
```

`update:daily` needs `ODDS_API_KEY` in the environment for the odds step; without it the board is built from research prices only.

## Updating the research for a new week

Replace `src/data/research.json` (same shape: `games[]` with `top3`, `value`, `stacks`, `atdBoard`, `sections`, plus `crossStacks` and `upsetLeans`), bump `week` and `researchAsOf`, run `build:board`, commit. The scripts match players to the odds feed by normalized name, so use the same spelling the books use.

## Data notes

- Win probability is vig-removed from the moneyline (median across books when live).
- Edge is our estimated TD probability minus the implied probability of the consensus price.
- "Open" is the first price recorded in `history.jsonl`; movement is consensus minus open.
- Injury statuses kept: Out, Doubtful, Questionable, Injured Reserve, Suspension, PUP.
