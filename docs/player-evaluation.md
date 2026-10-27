# Player decisions and research prototype

Awaker now lets you choose a player to replace on the Waiver wire. The same selector offers **Find trade returns**. The shopping result compares keeping him, the best projected replacement found, and the best displayed trade return over the same future weeks. These are read-only plans. Listing a player for trade, sending an offer, and making a waiver claim still happen in Sleeper.

Selecting a player constrains the actual optimizer, including when your roster has an open slot. It never silently drops somebody else. Existing protections, position rules, injuries, missing projections and current game locks still apply. Reserve and taxi players are not offered as active-roster drops. Selection lasts for the browser session and is scoped to the account and league. It does not affect scheduled reports.

## What the experimental view measures

**Beyond projections** on the Waiver wire scans all eligible available players at the chosen position, including those without a projection. Click **Explore recent performance** to load stats. Player profiles also expose these signals under **Beyond projections** using the selected scoring format.

The research window covers the six weeks before the selected week. It excludes the current week, even if some games have finished, to avoid mixing live and final results. Within that window, compare the last three recorded appearances with up to three earlier appearances. Byes, absences and missing records are excluded rather than scored as zero. A recorded zero or negative score remains in the average. Actual week numbers and metric coverage are shown.

| Signal | Calculation | Interpretation and limitation |
| --- | --- | --- |
| Recent scoring | League-scored points per recorded game, up to three games | A descriptive starting point, not a new projection |
| Projection disagreement | Recent points per game minus the selected week's projection, with at least two scored games | Flag a difference of at least three points for review. Matchup and injury context may explain it |
| Target trend | Recent targets per game minus earlier targets per game | Flag a rise or fall of at least two. Missing fields remain unknown. Trends need complete field coverage and at least two games per group |
| Carry trend | Recent carries per game minus earlier carries per game | Flag a rise or fall of at least three. Trends need complete field coverage and at least two games per group. A target and a carry are not interchangeable opportunities |
| Touchdown dependence | Passing, receiving and rushing touchdown points divided by recent total points, using league weights | Flag at least 40%. This describes where points came from, not whether touchdowns will regress |
| Sample size | Recorded games and stat coverage | Small sample flag when fewer than three recent or two earlier games are available |

Thresholds are exploratory choices, not fitted parameters or established prediction intervals. Players can sort by recent scoring, target growth, carry growth or projection disagreement within a position. Unknown values sort last. The prototype creates no blended player rating and changes no trade rankings, projections or alerts. Partial weekly fetch failures pause research results. Refresh retries them. Existing projection advice remains usable.

## Ideas to evaluate next

1. **Opportunity quality.** Expected fantasy points can assign value to the situation of each target or rush, rather than treating a touchdown as proof of a lasting role. The [ffopportunity project](https://ffopportunity.ffverse.com/) describes models that estimate scoring from play opportunities. A candidate experiment would compare expected points, actual points and the existing forecast. Confirm current-season coverage, identity joins and data licensing before integration.
2. **Role stability.** Snap share, route participation, team target share and red-zone usage could distinguish a growing role from one long touchdown. [nflreadr provides game-level snap counts](https://nflreadr.nflverse.com/reference/load_snap_counts.html). Route participation needs a separately verified source. Snap share alone cannot tell whether a player ran a route or blocked.
3. **ADP and market value.** Lower numerical ADP means earlier draft selection. Keep dated, format-specific ADP as a market prior, with explicit season, redraft or dynasty, reception scoring, and superflex context. Test whether its contribution should decay during the season. It is neither current trade acceptance probability nor evidence that an injured player is a safe pickup. No ADP feed is integrated yet.
4. **Context and uncertainty.** Injured teammates returning, offensive line changes, quarterback changes and upcoming opponents can explain disagreement. Separate verified facts from inferred role changes. Distinguish a ceiling stash, short-term starter and reliable depth option. A single points forecast cannot represent all three goals.
5. **Trade price versus roster value.** Continue measuring both teams' lineup gains and waiver alternatives. Separately investigate market prices and manager needs. A projected gain does not prove another manager will accept, and keeper or dynasty value requires a different horizon.

Sleeper's [documented API](https://docs.sleeper.com/#trending-players) describes trending adds and drops as transaction counts. Those counts measure attention, not ability. Awaker's weekly stats and projections use undocumented endpoints, so availability and field coverage must remain visible.

## Validation before changing recommendations

Use chronological evaluation with each prediction made from information available before that week. Save the original projection and market snapshot. A revised projection downloaded after the game is not a valid historical baseline. Keep a final season or block of weeks untouched while selecting windows and weights.

Compare the current projection baseline with recent scoring, workload-only estimates, ADP-only estimates and a candidate blend. Use identical player pools and scoring settings. Report coverage and sample size, error by position, rank quality, and the realized lineup gain of feasible pickups. Include injuries, byes, missing feeds and the cost of dropping the outgoing player. Evaluate waiver choices only against players actually available at the time.

Test each added signal separately, then remove it from the blend to check whether it contributes beyond the others. Require improvement across multiple held-out periods and league formats before using a blend in automatic advice. Investigate the worst false positives, especially touchdown spikes, stale ADP and lost workloads.

This implementation includes synthetic correctness tests, not a historical performance study. No claim of better predictive accuracy has been established.
