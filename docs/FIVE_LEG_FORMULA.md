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

- One leg per player, no touchdown markets, at most four legs from one offense, and at least one leg
  from the other team when one qualifies.
- Correlation is welcome: four Saints catches legs all ride the same passing volume, which lifts the
  joint hit rate above straight multiplication. It also means one bad pass-protection night sinks
  them together. Say so when the ticket goes out.
- Among every five-leg combination that pays the target (default +500), take the one with the
  highest joint shrunk probability. Report the joint number, the book's implied number and the gap.
- If nothing reaches the target, say so and show the best ticket that exists. Do not reach for a
  touchdown leg to make the number.

## The record

| Week | Game | Legs | Price | Joint (shrunk) | Result |
| ---- | ---- | ---- | ----- | -------------- | ------ |
| 4 | ATL @ NO (MNF) | Olave 7+ rec, J. Johnson 4+ rec, Pitts 25+ rec yds, Kamara 3+ rec, Vele 4+ rec | +977 | 13% | Won (8, 6, 47, 5, 6) |
| 5 | TB @ DAL (TNF), DK/FD | Hurst 10+ rec yds, Lamb 6+ rec, Egbuka 25+ rec yds, Otton 3+ rec, J. Williams 10+ rec yds | +569 | 25% | Lost 3/5 (0, 2, 38, 3, 17) |
| 5 | TB @ DAL (TNF), Courtside | Lamb 6+ rec, Hurst 15+ rec yds, Egbuka 25+ rec yds, Godwin 25+ rec yds, Otton 25+ rec yds | +819 | 22% | Lost 3/5 (2, 0, 38, 37, 25) |

Append every ticket here, win or lose, with the actual stat lines.

Week 5 Thursday, what went wrong: Lamb left with a quad injury in the second half and came back
for two catches on five targets (variance, not process). Hurst was not in the box score at all after
a three-target game the week before; that was process, and it is why the 3.0-catch floor above now
exists. The three legs on established roles (Egbuka, Godwin, Otton) all cleared.

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
