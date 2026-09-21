# House style

A league recap is read once, on a phone, by people who already know the scores. It earns its place
by telling them something they did not notice: who was unlucky, who was careless, and which move
nobody clocked at the time. Aim for 400–700 words of prose around the tables. If it runs to two
screens of scrolling before the first number, it is too long.

## Section order

1. **Headline and the week.** The league name and `recapWeek`. One sentence on the shape of the
   week — use `summary.average`, `high`, `low`.
2. **The scoreboard.** Every matchup, winner first, with both scores. Mark the `closest` and
   `widest` games. This is the part people scan for their own name, so put it high.
3. **What the benches were holding.** Lead with any roster where `swung` is true: lost by less than
   it left behind. Then the league's `leftOnBench` total. Be explicit that this is hindsight.
4. **The decisions.** Only rows with `avoidable` labels, and empty starting slots. This is the
   section the league will argue about, so it has to be the most careful one on the page — every
   claim quotes `gained` and `foreseen`, and anything `defensible` belongs in the luck section
   instead, if it appears at all.
5. **The wire.** The week's `moves`: the best claim by `net`, anything that `backfired`, the biggest
   `bid`, and any `unused bid`. Trades get both `sides` and no verdict.
6. **Footer.** `warnings`, the relevant `limitations`, and a line saying the numbers came from
   Awaker on `generatedAt`. If `demo` is true, say plainly that these are sample leagues.

Drop any section with nothing in it. A quiet week with no trades and no avoidable starts is a short
page, and a short page is fine.

## Tone

Dry beats zany. The numbers are funny on their own when they are surprising — a manager who left 31
points on the bench does not need an exclamation mark, and a joke stapled to a number usually
weakens it. Write like a beat reporter who likes everyone in the league.

Things that work:

- Letting a number land on its own. "Sunday Scaries lost by 2.4. Their bench outscored their flex by
  19.8."
- Naming the counterfactual precisely. "The projections had Mason 4.1 ahead of Gibbs; Gibbs went for
  22.6." That is a real defence, and printing it is how the page stays fair.
- Crediting the manager who went against the projections and won. `cost` above zero.
- A single closing line about what is at stake next week, if `get_opportunities` gave you one.

Things that do not:

- Calling anyone an idiot, in any of the many ways that is available.
- Inventing why someone did something. You have the what. You do not have the why, ever.
- Treating a projection as a fact that was ignored. It was an estimate, and the page should carry
  that lightly rather than pretending hindsight was available at kickoff.
- Manufactured drama between managers, fake quotes, invented rivalries, or a "power ranking" you
  made up. If `find_trades` or `get_opportunities` did not produce it, it is not yours to assert.
- Awards and superlatives that the data does not support. "Worst manager of the week" is a claim
  about a person; "most points left on the bench" is a number.

## The one mistake to avoid

Every bad fantasy recap makes the same one: it finds the biggest bench score in the league and
writes it up as a blunder. Most of the time the manager did exactly what the projections told them
and got unlucky, `cost` says so, and the recap has just told eleven people something false about
the twelfth. Check `cost` and the decision `label` before you criticise anything. When they say the
call was defensible, the story is the luck — which is a better story anyway, because nobody in the
league has heard it yet.
