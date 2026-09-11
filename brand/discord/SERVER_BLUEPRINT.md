# Cappers & Code — Discord server blueprint

Everything a moderator needs to make the server look and sound like the brand. Assets in this folder are rendered from the approved logo and character masters; do not recolor them.

## Assets

| File                                          | Use                                                              | Size        |
| --------------------------------------------- | ---------------------------------------------------------------- | ----------- |
| `server-icon.png`                             | Server icon (Server Settings → Overview)                         | 1024 × 1024 |
| `server-banner.png`                           | Server banner (requires Boost level 2) and channel welcome image | 960 × 540   |
| `invite-splash.png`                           | Invite background (Boost level 1) and pinned welcome graphic     | 1920 × 1080 |
| `embed-thumb.png`                             | Thumbnail on every bot embed                                     | 256 × 256   |
| `emoji-cc.png`                                | Custom emoji `:cc:` for reactions and role icons                 | 128 × 128   |
| `../characters/cc-core-robot.png`             | Model and analysis posts                                         | transparent |
| `../characters/dufflebag-mack-cyber-chef.png` | Win recaps only ("Chef Made It")                                 | transparent |

Embed accent color everywhere: electric green `#B6FF00` (decimal `11992832`). Never red or gold.

## Structure

Category names are uppercase with a green-bracket prefix so the sidebar reads like the HUD panels in the campaign art.

```
〈 START HERE 〉
  #welcome            read-only. invite splash, tagline, three rules, how the model works
  #announcements      read-only. launches, offers, schedule changes
  #rules              read-only
  #get-roles          reaction roles: sport interests, notification opt-in

〈 THE EDGE 〉
  #daily-board        bot-posted board digest every morning (webhook). read-only, thread replies on
  #best-bets          the confidence 3+ plays with reasoning. read-only, threads on
  #td-board           anytime-TD board and live price moves
  #props              yardage and reception lines vs our leans
  #line-moves         alerts when a tracked price moves 20+ cents or a spread moves a key number

〈 THE CODE 〉
  #model-talk         how the numbers are built; members ask, model team answers
  #nfl / #cfb / #nba  sport rooms
  #stacks-and-parlays correlated builds, SGP ideas
  #bankroll           unit sizing, discipline, no chasing

〈 THE COMMUNITY 〉
  #general
  #wins               real proof only. Dufflebag Mack posts live here. no fabricated slips
  #introductions
  #feedback

〈 FOUNDERS 〉           (visible to Founder role)
  #founders-lounge
  #early-access

〈 STAFF 〉               (visible to Model Team)
  #ops                 pipeline reports, credit ledger, outages
```

## Roles and colors

| Role          | Color                          | Who                                                    |
| ------------- | ------------------------------ | ------------------------------------------------------ |
| Founder       | `#B6FF00` electric green       | first 100 grandfathered subscribers                    |
| Model Team    | `#79E000` signal green         | people who run the pipeline and answer model questions |
| Member        | `#F5F7F2` soft white           | paid members                                           |
| Guest         | `#9DA59D` cool gray            | free signups                                           |
| Bot / CC Core | `#B6FF00`, icon `emoji-cc.png` | the daily-board webhook                                |

Hoist Founder and Model Team. Give Member a role icon of the monogram if the server has Boost level 2.

## Voice for every channel description and pinned post

Confident, data-literate, communal, concise, earned. Use: edge, model, data, strategy, community, locked in, trust the code, level up, intelligence, insight, discipline. Never: guaranteed, lock of the year, can't lose, fake scarcity, unsupported win percentages.

Channel topic examples:

- `#daily-board`: "Today's edge, straight from the model. Posted every morning. Ask questions in the thread."
- `#best-bets`: "Confidence 3+ only. Reasoning included. Size with discipline."
- `#wins`: "Real proof only. Chef made it. No fabricated slips, no balances, no screenshots that aren't yours."
- `#bankroll`: "Units, not dollars. Flat stakes. The code wins together, over a season."

## Welcome post (pin in #welcome)

> **WELCOME TO THE EDGE**
> AI Models. Human Insight. One Edge.
>
> Cappers & Code is a sports-intelligence community. The model prices every game, every touchdown scorer and the key props each week; the community argues about it, sharpens it, and sizes it with discipline.
>
> 1. Read `#rules`. Real proof only, no guarantees, no touting.
> 2. Grab your sports in `#get-roles`.
> 3. The board drops in `#daily-board` every morning. Confidence 3+ plays live in `#best-bets`.
>
> Locked in. Trust the code.

## Rules post (pin in #rules)

1. No guaranteed-win language, no fake scarcity, no unsupported percentages. Ever.
2. Wins channel is real proof only, from your own account. Never edit a slip.
3. Units, not dollars. Respect the bankroll talk.
4. Disagree with the model in `#model-talk`, with data. That is how it gets better.
5. 21+ where required. If it stops being fun, stop; help is at 1-800-GAMBLER.

## Daily digest format (what the webhook posts)

One message, up to three embeds, electric-green accent, monogram thumbnail:

1. **Locked In** — best bets with confidence, one line of why each.
2. **TD Board** — top 8 anytime-TD scorers: name, team, price, est, edge.
3. **Credits and freshness** footer — when prices were pulled and how many credits remain (staff-only detail can go to `#ops` instead).

See `scripts/post-discord.mjs`. Set `DISCORD_WEBHOOK_URL` (a webhook created on `#daily-board`, named "CC Core", avatar `server-icon.png`).
