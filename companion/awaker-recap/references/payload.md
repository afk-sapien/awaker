# What `get_recap` returns

`get_recap` takes an optional `leagueId` and an optional integer `week` (1–18). With no arguments it
covers every enabled league for the most recently finished week. Over HTTP the same thing is
`POST /api/v1/recap`.

Every response carries Awaker's standard envelope, then the recap.

## Envelope

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Contract version. `1` today. |
| `generatedAt` | When the response was built, in epoch milliseconds. |
| `season`, `week` | The **current** NFL season and week — not the week being recapped. |
| `recapWeek` | The week this recap covers. Use this one in the headline. |
| `demo` | `true` means sample leagues, not the user's own. Say so on the page. |
| `complete`, `dataComplete`, `health` | Whether anything was stale, missing or excluded. |
| `warnings` | Plain sentences about what was incomplete. Quote them at the foot of the page. |
| `limitations` | Standing caveats about the method. Worth one line in the footer. |
| `sources` | Per-source fetch times and staleness. Rarely worth printing. |
| `recaps` | One entry per league. |

If `recapWeek` equals `week`, the week may still be in progress; `warnings` will say so.

## Each entry in `recaps`

| Field | Meaning |
| --- | --- |
| `leagueId`, `league` | The league's id and name. |
| `rosterId`, `team` | **The user's own** roster id and team. Their team is the one to write around. |
| `summary` | League-wide numbers for the week. |
| `rows` | One per roster, including the user's. |
| `moves` | The week's transactions. |
| `names` | `{playerId: name}` covering every id in `starters` and `bestLineup`. |

A `team` is an object: `{team, manager}`, either of which can be null.

### `summary`

`teams`, `average`, `high`, `low`, `leftOnBench` (the league's combined bench regret), plus
`closest` and `widest` — each `{rosterId, opponentId, margin, total}`, the tightest and most
lopsided games of the week. Both are null in a league where nobody played.

### `rows`

A roster with no matchup that week is `{rosterId, played: false, decisions: []}`. Report it as
missing; do not count it. Everything else has:

| Field | Meaning |
| --- | --- |
| `team`, `opponent` | Names, resolved. `opponent` is null if there was no opponent. |
| `points`, `against` | The official league score for each side. |
| `result`, `margin` | `win` / `loss` / `tie`, and the signed margin. |
| `started` | What the lineup that was set actually scored. |
| `best` | The most the roster could have scored with hindsight. |
| `left` | `best - started`. **Bad luck plus bad decisions, mixed together.** |
| `advised` | What the lineup the projections advised before kickoff would have scored. |
| `cost` | `started - advised`. **Negative means ignoring the projections cost this much. Positive means the manager out-picked them.** |
| `swung` | True when the roster lost by less than `left`. The classic recap opening. |
| `starters`, `bestLineup` | Player ids, in slot order. Resolve through `names`. |
| `decisions` | The individual start/sit calls. |
| `complete` | False when some player could not be projected, so `advised` and `cost` are partial. |

**The distinction that matters.** `left` is what the bench was holding. `cost` is what the manager
could have done about it. They come apart constantly, and that gap is the most interesting thing on
the page:

- `left` high, `cost` near zero — the manager set the right lineup and the football gods laughed.
  This is a story about luck. It is not a story about a mistake.
- `left` high, `cost` strongly negative — the projections said start the other guy. This is the
  questionable decision, and it is the only case criticism is earned.
- `cost` positive — the manager went against the projections and was right. Give them the credit;
  it is rarer than being unlucky.

### `decisions`

One per swap the hindsight lineup would have made.

| Field | Meaning |
| --- | --- |
| `sat`, `satName` | The player who should have started. |
| `played`, `playedName` | The player who did — **null when the slot was left empty**. |
| `gained` | Points the swap would have added. |
| `foreseen` | Projected margin between them before kickoff. Null when either had no projection. |
| `label` | `avoidable`, `defensible`, `toss-up` or `unknown`. |

The two players in a decision are always ones who could have held the same starting slot, so a swap
is a real either/or rather than two unrelated names put side by side.

`avoidable` means the projections favoured the player who sat by more than a point: knowable in
advance, and fair to raise. `defensible` means they favoured the player who started — say it was
bad luck, or leave it out. `toss-up` is inside a point either way. `unknown` means a missing
projection, so there is no verdict to give.

An empty slot (`played: null`) is always the manager's own doing and is measured against the zero it
scored. It deserves the mention every time.

## `moves`

`moves.summary` has `count`, `trades`, `spent` (total FAAB across the week), `pending` (how many are
waiting on games) and `best` — the graded claim with the highest `net`, or null when none has been
played yet.

`moves.rows` is one entry per completed transaction, oldest first as Sleeper processed them. Failed
and pending claims are already filtered out.

| Field | Meaning |
| --- | --- |
| `type` | `waiver`, `free_agent` or `trade`. |
| `at` | Sleeper's timestamp. |
| `rosterIds`, `teams` | Who was involved, as ids and as resolved names. |
| `bid` | FAAB spent, or null where the league does not use it. |
| `adds`, `drops` | Players in and out. |
| `forWeek` | **The week this move is graded on — not always `recapWeek`.** See below. |
| `played` | False when `forWeek`'s games have not all been played. Then `net` is null. |
| `net` | Added points minus dropped points, in each player's own `forWeek`. Null when `played` is false. |
| `label` | On waivers and free agents only. |
| `sides` | On trades only: `{rosterId, received, sent, net}` per manager. |

Each entry in `adds` and `drops` is `{id, name, position, rosterId, team, points, started, forWeek}`.
`started` says whether the player was in a starting lineup in his own `forWeek` — a pickup who never
started tells you the claim was a stash or a panic.

**Why `forWeek` exists, and why it matters.** Sleeper files a transaction under the week it *cleared*
in, not the week it affects. Waivers run on Tuesday or Wednesday, after that week's games are over,
so most of a week's transactions are really moves for the following week. A player's points only
count toward a move made before **his own game kicked off** — so a Sunday-evening pickup cannot take
credit for the afternoon's scoring either. One move can straddle two weeks (claimed after the early
games but before Monday night), in which case each player carries his own `forWeek` and the move
stays ungraded until both weeks are on the board.

This means a recap written the day after a week ends will often show every move as `not played yet`.
That is correct, and it is the honest thing to print: those claims have not had a chance to pay off.
Say so plainly rather than reaching for the raw points, which describe the week *before* the move.

Labels: `not played yet` (the week it is graded on has not finished — no verdict is available),
`unused bid` (paid FAAB for someone who never started), `stashed` (same, but free), `backfired` (the
drop outscored the add by 3+), `paid off` (the add won by 3+), `neutral`, `unknown` (no scoring data).

A trade gets `sides` instead of a label, because one week cannot say who won a trade and pretending
otherwise is how recaps get a reputation.
