# The five-leg formula

How the desk builds the "max confidence, no touchdowns" five-leg ticket. First run: Week 4 Monday
night, Falcons at Saints, +977 on Courtside, all five legs cleared with room. The formula is
mechanical on purpose: the judgement goes into the projections, the ticket falls out of the rules.

## What goes on the ticket

Volume props only. Receptions first, receiving yards second, rushing yards third, passing yards
last.

- No touchdown markets of any kind: no anytime, no 2+, no passing touchdowns. Touchdowns are the
  lowest-probability legs a book sells and they are what turned every Week 4 Monday ticket that had
  one from a winner into a loser.
- Passing yards are allowed, but only at an alternate line well under the projection. A quarterback
  swings about 65 yards either way on a 250-yard mean, so the main number is a coin flip and never
  qualifies; a 200+ line under a 260 projection can.
- No sides, totals or moneylines. They are priced tighter than any player market.
- No line that rests on a one-game sample, no player with a game-day designation, and no leg whose
  model number sits on the other side of the book's line (fade it or leave it; never back it).
- No receiving leg on a player projected under 3.0 catches. A fringe role can go to zero on volume
  alone: Ted Hurst was projected 2.5 catches for Week 5 Thursday and did not see a target.

## The number on each leg

1. Project the player's mean for the market. Targets = team pass attempts x target share, blended
   from the last three games and the season, with absent teammates' targets redistributed. Catches =
   targets x regressed catch rate. Receiving yards = catches x regressed yards per catch, scaled by the
   opponent's rate against that position. Rushing yards = carries x regressed yards per carry.
2. Turn the mean into a probability for every posted alternate line:
   - Receptions: Poisson on the mean. P(N+) = 1 - P(N-1 or fewer).
   - Receiving yards: normal, standard deviation the larger of 12 yards or 0.6 x mean.
   - Rushing yards: normal, standard deviation the larger of 15 yards or 0.55 x mean.
   - Passing yards: normal, standard deviation the larger of 45 yards or 0.26 x mean.
     The yardage spreads are wide by design. A tight spread flattered Loveland's under in Week 4
     (92% on paper) and is why that leg was left off.
3. Shrink the model toward the book before trusting it: `p = 0.7 x model + 0.3 x implied`. The
   model has run a few points high all season; the shrink is what makes the hit rate honest.

## Picking the line

Take the alternate line one notch below the main line when the book still pays for it. Juwan
Johnson 4+ catches at -190, not 5+ at +118. Pitts 25+ yards at -170 under a 30.5 main line. The
step down costs a little price and buys a lot of hit rate, and five of those add up.

A leg qualifies when, after the shrink, it is at least 58% to hit, the model is at least as good as
the book's implied number (never a leg the book rates higher than we do), and the price is no worse
than -250. The ticket must carry at least one anchor leg where the model beats the book by 5 points
or more; the rest are allowed to be fairly priced, because this ticket is built for hit rate, not
for edge on every line. Monday night the anchor was Olave 7+ (model 76%, book 58%).

## Building the five

- One leg per player, no touchdown markets, and no team limit. A ticket may sit entirely on one
  offense when the game script points there; Week 6 Thursday the legs that hit were all Seattle's
  passing game, and the old rule (at most four from one offense, at least one from the other team)
  would have ruled that ticket out. Vary the scripts across a card instead of inside each ticket.
- Correlation is welcome: four Saints catches legs all ride the same passing volume, which lifts the
  joint hit rate above straight multiplication. It also means one bad pass-protection night sinks
  them together. Say so when the ticket goes out.
- Among every five-leg combination that pays the target (default +500), take the one with the
  highest joint shrunk probability. Report the joint number, the book's implied number and the gap.
- If nothing reaches the target, say so and show the best ticket that exists. Do not reach for a
  touchdown leg to make the number.

## The record

| Week | Game                      | Legs                                                                                                      | Price | Joint (shrunk) | Result                         |
| ---- | ------------------------- | --------------------------------------------------------------------------------------------------------- | ----- | -------------- | ------------------------------ |
| 4    | ATL @ NO (MNF)            | Olave 7+ rec, J. Johnson 4+ rec, Pitts 25+ rec yds, Kamara 3+ rec, Vele 4+ rec                            | +977  | 13%            | Won (8, 6, 47, 5, 6)           |
| 5    | TB @ DAL (TNF), DK/FD     | Hurst 10+ rec yds, Lamb 6+ rec, Egbuka 25+ rec yds, Otton 3+ rec, J. Williams 10+ rec yds                 | +569  | 25%            | Lost 3/5 (0, 2, 38, 3, 17)     |
| 5    | TB @ DAL (TNF), Courtside | Lamb 6+ rec, Hurst 15+ rec yds, Egbuka 25+ rec yds, Godwin 25+ rec yds, Otton 25+ rec yds                 | +819  | 22%            | Lost 3/5 (2, 0, 38, 37, 25)    |
| 5    | PHI @ JAX                 | Shipley 25+ rush yds, Rodriguez 20+ rush yds, Hurts 160+ pass yds, Lemon 25+ rec yds, Strange 25+ rec yds | +673  | 19%            | Lost 3/5 (6, 5, 220, 43, 68)   |
| 5    | CHI @ GB (card)           | Johnson 15+ rush yds, Lloyd 20+ rush yds, Raymond 20+ rec yds, Odunze 30+ rec yds, Watson 50+ rec yds     | +624  | 23%            | Lost 3/5 (6, 31, 6, 40, 143)   |
| 5    | CLE @ NYJ (card)          | Judkins 10+ rec yds, Watson 170+ pass yds, Smith 175+ pass yds, Fannin 25+ rec yds, Boston 3+ rec         | +585  | 23%            | Lost 2/5 (6, 155, 182, 4, 3)   |
| 5    | HOU @ TEN (4 legs)        | Stroud 210+ pass yds, Ward 170+ pass yds, Collins 5+ rec, Robinson 25+ rec yds                            | +348  | 29%            | Won (261, 170, 5, 53)          |
| 5    | IND @ PIT (pulled)        | Rodgers 190+ pass yds, Wilson 25+ rec yds, Warren 15+ rec yds, Freiermuth 20+ rec yds, Downs 40+ rec yds  | +530  | 25%            | Lost 4/5 (235, 0, 87, 44, 47)  |
| 5    | LV @ NE                   | Mayer 20+ rec yds, Tucker 30+ rec yds, Cousins 210+ pass yds, Doubs 40+ rec yds, Henderson 40+ rush yds   | +702  | 19%            | Lost 2/5 (2, 41, 243, 16, 22)  |
| 5    | MIN @ NO (card)           | Olave 6+ rec, Hockenson 30+ rec yds, Vele 30+ rec yds, Jones 15+ rec yds, Shough 220+ pass yds            | +601  | 19%            | Lost 0/5 (4, 7, 26, 4, 96)     |
| 5    | NYG @ WSH (pulled)        | Likely 4+ rec, Harris 20+ rush yds, Winston 175+ pass yds, White 20+ rush yds, Daniels 25+ rush yds       | +594  | 21%            | Lost 3/5 (11, 9, 326, 18, 103) |
| 5    | CIN @ MIA (4 legs)        | Burrow 225+ pass yds, Willis 170+ pass yds, Gordon 40+ rush yds, Washington 40+ rec yds                   | +501  | 24%            | Lost 2/4 (190, 137, 88, 43)    |
| 5    | DEN @ LAC (card)          | Harvey 20+ rec yds, Gadsden 25+ rec yds, Sutton 25+ rec yds, Hampton 30+ rush yds, Herbert 175+ pass yds  | +528  | 23%            | Lost 1/5 (0, 0, 18, 33, 121)   |
| 5    | DET @ ARI (card)          | Wilson 6+ rec, Goff 250+ pass yds, LaPorta 40+ rec yds, Williams 40+ rec yds, Allgeier 20+ rush yds       | +554  | 20%            | Lost 3/5 (4, 271, 88, 47, 7)   |
| 5    | SF @ SEA (4 legs)         | Black 10+ rush yds, Samuel 5+ rush yds, Evans 4+ rec, Smith-Njigba 7+ rec                                 | +503  | 21%            | Lost 2/4 (16, 4, 7, 5)         |
| 5    | BAL @ ATL (4 legs)        | Andrews 25+ rec yds, Brian Robinson 30+ rush yds, Bijan Robinson 80+ rush yds, Henry 70+ rush yds         | +530  | 21%            | Lost 3/4 (28, 16, 86, 102)     |

Append every ticket here, win or lose, with the actual stat lines.

Week 5 Thursday, what went wrong: Lamb left with a quad injury in the second half and came back
for two catches on five targets (variance, not process). Hurst was not in the box score at all after
a three-target game the week before; that was process, and it is why the 3.0-catch floor above now
exists. The three legs on established roles (Egbuka, Godwin, Otton) all cleared.

Week 5 Sunday: 1 of 13 tickets won (HOU @ TEN, the four-leg short ticket). The max-confidence card,
marked (card), went 0 for 5, and the two the morning check pulled, marked (pulled), lost as well.
Legs hit 32 of 61 (52%) against 44.1 expected from the shrunk probabilities (72% average). By
market: rush yards 7/16, receiving yards 13/25, receptions 4/7, passing yards 8/13. A starred stat
was missing from the box score; none were this week. Harvey and Gadsden were in the box score with
zero catches.

What went wrong: the projections ran hot, and it was not one bad game. 46 of 61 legs finished under
our projected mean, and the median leg finished at 73% of its projection (rush yards 51%,
receiving yards 67%, receptions 79%, passing yards 85%). Part of it was the slate: rain at
MetLife, Pittsburgh and Washington, and low totals. Part of it is built in. The formula picks the
legs where our number beats the book's by the most, so it selects for the projections that are
too high. A shrink of 0.3 toward the book is not enough to correct for that. Before Week 6, the
projections and the shrink get recalibrated against this record (see the to-do below), and until
then the book's joint number is the honest one to quote next to ours.

To do before Week 6: refit SHRINK and the per-market projection haircut on Weeks 4 and 5 (61+
graded legs), and add the rule that a leg's projection must clear its alternate line by a
market-specific cushion, not just price above the book.

## Running it

```
node scripts/five-leg.mjs --week 5                 # every game with projections and alt lines
node scripts/five-leg.mjs --week 5 --game tb-dal   # one game
node scripts/five-leg.mjs --week 5 --target 6      # decimal payout floor (6.0 = +500)
```

Inputs: `data/projections/<season>-w<week>.json` (the per-player means, written from the receiver
brief in `docs/briefs/receiver-props-brief.md`) and `data/odds/alts/<season>-w<week>-<game>.json`
(the raw Odds API event body for `player_receptions_alternate`, `player_reception_yds_alternate`
and `player_rush_yds_alternate`, or the compact `{ player: { book: [[point, price], ...] } }` form).
Output: `data/five-leg/<season>-w<week>.json` and a readable summary on stdout.

A pre-kick refresh in `data/odds/raw/prekick/<season>-w<week>-<game>.json` (same Odds API body,
only the alternate markets the game's ticket uses) takes precedence over the Saturday pull in
`data/odds/raw/`, so rerunning the formula on Sunday morning rebuilds every game that has not
kicked off on current prices. A game that has kicked off keeps the ticket it was published with.

## The max-confidence card (Sunday morning)

The front page leads with the day's five full five-leg tickets with the best joint hit rate, and
the same five go out as a sheet. Before they publish:

1. Pull fresh alternate lines for the candidate games into `data/odds/raw/prekick/` (3-4 credits a
   game) and rerun `node scripts/five-leg.mjs --week N`.
2. Check every leg on the top tickets, plus two reserves: injury report and inactives, role news,
   the current main line (a main line at or below our alternate is a drop), and kickoff weather.
   Use an independent verifier, then a skeptic who tries to refute each kept leg. Any leg the
   rebuild swapped in gets the same check.
3. Record the result in `data/five-leg/<season>-w<week>-checks.json`. `pulled` holds the tickets
   the check left off, with the reason. `notes` holds one line per game (weather, who is out).
   `pricedAt` is the time of the pull.
4. `node scripts/build-board.mjs` builds `board.maxFive` (`buildMaxFive` in `scripts/best-of.mjs`).
   It takes full tickets only, never short ones or pulled ones. Then
   `node scripts/max-five-sheet.mjs` renders `site/sheets/w<wk>-<day>-max-five.png` with its `.txt`.
   The `.txt` holds the same Discord text as the app's COPY FOR DISCORD button.
