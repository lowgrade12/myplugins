# HotOrNot Battle Logic Analysis

Research and analysis of the current battle system, comparison with alternatives, and ideas for new battle types — with a focus on **scalability for large performer libraries**.

---

## The Large Pool Problem

With a large number of performers (500+), the core challenge is **coverage**: getting every performer into enough matchups to establish a meaningful rating. Consider the math:

| Pool Size | Comparisons for 10 matches each | Time at ~10 sec each |
|-----------|--------------------------------|----------------------|
| 100 | 500 | ~1.5 hours |
| 500 | 2,500 | ~7 hours |
| 1,000 | 5,000 | ~14 hours |
| 2,000 | 10,000 | ~28 hours |

Even giving each performer just 10 matches (the minimum for the K-factor to drop from 16→12) is a massive time investment. Research on pairwise ranking shows that **O(n log n) comparisons** are needed for accurate rankings — so for 1,000 performers, that's roughly 10,000 comparisons. **The current system works well, but the main bottleneck is throughput, not algorithm quality.**

---

## Current System Assessment

### Rating Algorithm: Modified ELO

The plugin uses a **modified ELO system** with several smart enhancements:

| Feature | Implementation | Verdict |
|---------|---------------|---------|
| Adaptive K-factor | Tiered by match count (16→12→8) with scene count multiplier | ✅ Good — faster convergence for new items, stability for established ones |
| Diminishing returns | Quadratic curve `(distanceFromCeiling/50)²` | ✅ Good — prevents rating inflation at the top |
| Scene-adjusted diff | `log2(loserScenes/winnerScenes) * 2` adjustment (±6 max) | ✅ Good — beating a "more proven" performer is worth more |
| Zero-sum Swiss | Winner gains = loser loss | ✅ Good — maintains rating pool integrity |
| Skip-as-draw | Both get ELO draw mechanics (0.5 expected score) | ✅ Good — skipping has meaningful consequences |
| Recency weighting | Time-based cooldown (0.1x–1.0x) for matchmaking | ✅ Good — prevents back-to-back rematches |
| Streak weighting | 1.0x–1.5x matchmaking boost for streaking performers | ✅ Good — streaking performers get more chances to prove/disprove the streak |
| Big loss recovery | 2.0x–3.0x matchmaking boost after 4+ point losses | ✅ Good — prevents a single bad matchup from permanently tanking a rating |
| 10-bit recent results | Bitmask tracks last 10 wins/losses for trend analysis | ✅ Clever — efficient storage with meaningful insight |

### Is ELO the Best Choice?

**Yes, for this use case.** Here's why:

| Alternative | Why It's Not Better Here |
|-------------|------------------------|
| **Glicko/Glicko-2** | Adds rating deviation (uncertainty) — useful when players are inactive for long periods. But in HotOrNot, the *user* is the rater, not the performers. Performers don't "get rusty." The added complexity (tracking RD per performer) doesn't provide meaningful benefit. |
| **TrueSkill** | Designed for multiplayer/team matches. HotOrNot is strictly 1v1 pairwise comparison. TrueSkill would be over-engineered. |
| **Bradley-Terry** | Maximum likelihood estimation from pairwise data. Very similar to ELO in practice for 1v1 comparisons, but typically computed in batch (offline) rather than updated per-match. ELO's incremental updates are better for an interactive app where you want instant feedback. |
| **Borda Count** | Simply counts wins. Loses all nuance about *who* you beat. Beating the #1 performer counts the same as beating #100. ELO captures this naturally. |
| **Rank Centrality** | Graph-based ranking from pairwise data. Excellent for large sparse datasets but requires batch computation. Not suited for real-time interactive rating. |

**Conclusion:** The current modified ELO system is well-suited for this plugin's needs. The enhancements (adaptive K-factor, diminishing returns, scene adjustment) address ELO's main weaknesses without adding unnecessary complexity. **The algorithm isn't the bottleneck — throughput is.**

### Large Pool Bottlenecks in Current Implementation

These are specific issues that become more significant with large libraries:

1. **No coverage tracking** — The system doesn't know what percentage of performers have been matched at least once. Users have no visibility into how much of their library has been ranked. A coverage indicator (e.g., "247 of 1,200 performers rated") would help users understand their progress.

2. **Full pool fetch every pairing** — Swiss mode uses `per_page: -1` to fetch ALL performers for each pairing decision. With 1,000+ performers this is a lot of data per round. The image mode already has a 500-sample limit for pools >1,000 — a similar approach for performers (sampling a subset sorted by rating around the target window) would reduce load.

3. **Rating window creates silos** — At 50+ performers, the window narrows to ±10 rating points. When most performers start at the default rating of 50 (unrated), they're all in the same silo. This is fine early on but means newly added performers only face other new performers, never getting tested against established ones. The 10% random check helps but may not be enough for very large pools.

4. **Recency weighting for never-matched (3.0x) may be insufficient** — In a pool of 1,000 performers where 800 have never been matched, the 3.0x weight doesn't differentiate between them. They all compete for selection equally. A stronger boost (or a dedicated "onboarding queue" that forces never-matched performers into matchups first) would improve coverage.

5. **No concept of "good enough" ranking** — The system has no signal for when a performer's rating has converged (stabilized). Without this, users don't know when to stop. A confidence indicator per performer would tell users "this performer's rating is reliable after 15 matches" vs. "this performer needs more data."

---

## Current Battle Mode Assessment

### Swiss Mode ⚖️

**What it does:** True ELO with similar-rating matchmaking, weighted random selection, streak adjustment.

**Assessment: Excellent algorithm, but coverage is slow for large pools.**

- ✅ Zero-sum property maintains rating integrity
- ✅ Similar-rating matchups are more informative than random ones
- ✅ Weighted selection ensures comprehensive coverage
- ✅ 10% random pairings catch misranked performers
- ✅ Streak-adjusted matchmaking keeps things interesting
- ⚠️ **Large pool issue:** With 1,000+ performers, the 3.0x never-matched weight isn't enough to ensure all performers get matched. 800 never-matched performers all competing for selection at the same 3.0x weight means coverage is slow and random.
- ⚠️ **Large pool issue:** Fetches ALL performers every pairing (`per_page: -1`). At 1,000+ this is significant data per round.

**Possible Swiss improvement for large pools:** Add a "guaranteed coverage" mechanism — for example, maintain a queue of never-matched performers and guarantee that at least one side of every pairing is from this queue until coverage reaches 100%. This would ensure all performers get at least a few matches before re-matching established ones.

### Gauntlet Mode 🎯

**What it does:** King-of-the-hill placement mode. Champion climbs up, falls down when beaten, finds their floor.

**Assessment: Good, but becomes tedious with large pools.**

- ✅ Great for quickly placing a new performer
- ✅ The "falling" phase with floor-finding is clever
- ✅ Only active participant changes rating — makes sense for placement
- ✅ Defeated list prevents infinite loops
- ⚠️ **Large pool issue:** Champion must beat many opponents to reach the top. In a pool of 1,000, reaching #1 could require 100+ consecutive wins, which is impractical.
- ⚠️ **Large pool improvement idea:** Use binary search instead of linear climb — test the champion against the performer at the midpoint of the ranking, then narrow to the top or bottom half based on the result. This would place a performer in ~10 comparisons (log₂ 1,000 ≈ 10) instead of 100+.

### Champion Mode 🏆

**What it does:** Winner stays on, both get half-strength rating updates.

**Assessment: Good for fine-tuning, but doesn't help with coverage.**

- ✅ 50% K-factor reduction prevents over-correction
- ✅ Both performers update (unlike Gauntlet)
- ✅ Winner-stays-on mechanic is engaging
- ⚠️ **Large pool issue:** Over-samples the winning performer. If someone goes on a 20-win streak, that's 20 matchups focused on ONE performer while 999 others sit idle. This is the worst mode for coverage.
- ⚠️ **Large pool issue:** 50% K-factor means even slower convergence, which is the opposite of what large pools need.

---

## New Battle Type Ideas

> **Priority note:** These are ordered by how well they solve the large pool problem — getting accurate rankings across a massive library with minimal user effort.

### 1. ⚡ Blitz Mode (Speed Rating) — *Best for throughput*

**The problem it solves:** You have 1,000+ performers. At 10 seconds per comparison, you'll never get through them all. Blitz cuts the time-per-decision dramatically.

**How it would work:**
- 3-5 second countdown timer per matchup
- If timer expires, auto-skip (draw)
- Images preload during the current matchup (no loading delay between pairs)
- Reduced K-factor (50-75% of normal) since decisions are less deliberate
- Session stats: total matches, decisions/minute, time spent
- Goal display: "45 of 100 matchups complete" per session

**Why it's the #1 priority for large pools:**
- **2-3x more comparisons per session** — if each decision takes 3 seconds instead of 10, you get 3x coverage
- Forces instinctive choices that research shows are often *more* consistent than deliberated ones
- Timer creates urgency and engagement — feels like a game, not a chore
- Session targets ("do 50 matchups") give clear stopping points
- **Directly addresses the core problem:** throughput

**ELO integration:**
- Reduced K-factor (75%) to account for less deliberate choices
- Skip-as-draw handles timeouts
- Normal ELO math otherwise

**Complexity:** Low-Medium — requires timer UI, auto-skip logic, image preloading, session stats.

### 2. 🎯 Calibration Mode (Smart Ranking) — *Best for accuracy per comparison*

**The problem it solves:** Swiss mode picks "fair" matchups, but not necessarily the most *informative* ones. Calibration mode maximizes information gain per comparison, requiring fewer total comparisons.

**How it would work:**
- System identifies performers with the least confidence in their rating (fewest matches, most inconsistent results)
- Pairs uncertain performers against "anchor" performers (well-established ratings)
- Uses binary-search-style approach: if uncertain performer beats someone rated 60 and loses to someone rated 70, next match is against someone rated 65
- Shows confidence per performer: "Rating: 7.2 (±1.5, needs 5 more matches)"
- Coverage dashboard: "834 of 1,200 performers rated • Average confidence: 72%"

**Why it's critical for large pools:**
- Research shows adaptive sampling achieves accurate rankings in **O(n log n)** comparisons — for 1,000 performers, that's roughly 10,000 optimally chosen comparisons vs. exhaustive Round Robin's 499,500
- Every comparison is maximally informative — no "wasted" matchups between two well-established performers
- Binary-search placement means a new performer gets accurately placed in ~10 comparisons
- Confidence indicator tells the user when to stop: "Your top 50 are ranked with 95% confidence"
- **Most efficient path to accurate rankings**

**ELO integration:**
- Standard ELO updates
- Additional confidence metric: `confidence = 1 - (1 / sqrt(matches + 1))` — at 0 matches = 0.0, at 3 matches = 0.5, at 15 matches = 0.75, approaches 1.0 asymptotically
- Matchmaking driven by information gain: pair the least-confident performer against a well-anchored one near their estimated rating

**Complexity:** Medium — requires confidence estimation, adaptive pairing algorithm, coverage dashboard, and binary-search-inspired matchmaking.

### 3. 👥 Category Showdown Mode — *Best for breaking up large pools*

**The problem it solves:** 1,000 performers is overwhelming. But ranking 20 performers within a specific studio or tag? That's manageable. Category Showdown breaks the huge pool into digestible chunks.

**How it would work:**
- **Auto-categorization:** System groups performers by existing tags, studios, or other attributes
- **Phase 1 — Category ranking:** Rate performers within one category at a time (e.g., "Studio A" has 15 performers — do round-robin for those 15)
- **Phase 2 — Cross-category:** Category champions (top 3 from each) face off to establish global rankings
- Progress tracking per category: "Studio A: Complete ✅ | Studio B: 5 of 28 done | Studio C: Not started"
- Categories can be manually created or auto-generated from tags/studios

**Why it works for large pools:**
- **Cognitive simplification:** Comparing 2 performers from the same studio is easier than comparing 2 from completely different contexts
- **Parallelizable progress:** Complete one category fully before starting another — gives sense of accomplishment
- **Leverages existing data:** Uses tags and studios you've already organized
- Each category is a manageable sub-problem (10-30 performers)
- Cross-category phase efficiently links the sub-rankings into a global ranking

**ELO integration:**
- Standard ELO for all matches (even within categories, ratings are global)
- Category-level completion tracking
- Category champions get a small confidence boost (they've been tested thoroughly within their category)

**Complexity:** High — requires category management, auto-grouping logic, per-category progress, cross-category phase.

### 4. 🏟️ Tournament Mode (Bracket-Based) — *Best for engagement*

**The problem it solves:** Open-ended rating sessions feel like a grind. Tournaments have a clear start, middle, and end with dramatic moments.

**How it would work:**
- User selects pool size (8, 16, 32, or 64 performers)
- Performers seeded by current rating (or random for unrated pools)
- Single-elimination bracket with visual bracket display
- Optional: double-elimination with losers bracket
- Tournament winner gets a rating boost
- Bracket history saved — can review past tournaments
- "Auto-tournament" option: system picks the 16 performers with least confidence

**Why it works for large pools:**
- Manageable scope: 16-performer tournament = 15 comparisons. That's 5 minutes of rating.
- "Auto-tournament" mode selects the performers who need rating the most — built-in prioritization
- Multiple short tournaments > one endless session
- Visual bracket creates engagement and narrative
- Can run themed tournaments: "Top 32 by scene count", "All performers from tag X"

**ELO integration:**
- Standard ELO updates per match during the tournament
- Optional: tournament winner bonus (small rating boost)
- Tournament seed positions determined by current ELO
- Tournament placement tracked in stats

**Complexity:** Medium — requires bracket state management, seeding logic, bracket visualization UI.

### 5. 🔄 Rematch Mode — *Best for maintaining existing rankings*

**The problem it solves:** After spending hours building rankings, preferences change over time. Rematch mode keeps rankings current without starting over.

**How it would work:**
- System identifies "stale" matchups: pairs where both performers' ratings have changed significantly since their last direct comparison
- Also identifies pairs where the previous match was very close (small ELO change)
- Presents these pairs to confirm or overturn previous results
- Shows previous result: "Last time you chose [A] over [B]"
- Reversed decisions get higher K-factor (the user changed their mind, so the correction should be stronger)

**Why it works for large pools:**
- **Maintenance mode** — keeps rankings fresh without re-ranking everything
- Focuses effort where it matters most: uncertain or outdated comparisons
- Efficient: only revisits pairs where revisiting would actually change something
- For long-term users who have already built initial rankings

**ELO integration:**
- Standard ELO for reversed decisions (with 1.5x K-factor for overturned results)
- Reduced K-factor for confirmed decisions (0.5x — ranking was already correct)
- Tracks "reversal rate" as a ranking maturity metric

**Complexity:** Low-Medium — requires match history tracking per pair (not currently stored) and stale-pair identification logic.

### 6. 🏅 Round Robin Mode — *Best for small group precision*

**The problem it solves:** You want to rank a specific subset of performers with maximum accuracy. Every performer faces every other exactly once.

**How it would work:**
- User selects a small group (6-12 performers) manually or by filter
- System generates all possible pairings: n×(n-1)/2 matchups
- User works through each pairing once
- Progress indicator: "Match 15 of 28"
- Final results: head-to-head matrix, win counts, ELO ranking
- Completion screen with full group ranking

**Why it works for large pools:**
- Handles the "rank my top 20" use case perfectly — exhaustive comparison within a small group
- Clear start and definite endpoint (no open-ended grind)
- Statistically the most reliable ranking for a small group
- Good for resolving ties or close ratings among similar performers

**ELO integration:**
- Standard ELO per match
- Round-robin results can also be displayed as Borda count (total wins) for comparison
- Group ranking saved as a "snapshot" in stats

**Complexity:** Medium — requires group selection UI, pairing generation, progress tracking, completion detection.

### 7. 🔀 Random Rumble Mode — *Simplest large pool solution*

**The problem it solves:** When most performers are unrated (all at default 50), Swiss mode's rating window means all matchups are essentially random anyway. Random Rumble leans into this by removing all matchmaking overhead.

**How it would work:**
- Completely random performer selection — no rating window, no weighting, no recency
- Standard ELO updates apply
- Minimal overhead: no need to fetch all performers, just pick 2 random IDs
- Good for initial "first pass" when starting from scratch

**Why it works for large pools:**
- **Fastest possible pairing** — no matchmaking computation needed
- Performance-friendly: only needs to fetch 2 random performers per round (not all 1,000)
- When starting from scratch, all performers are at 50 anyway — matchmaking adds overhead without value
- After a "Random Rumble" pass, switch to Swiss for refinement

**ELO integration:**
- Standard ELO calculation (beating a higher-rated opponent gives more points naturally)
- No matchmaking adjustments

**Complexity:** Very Low — simpler than Swiss mode since it removes all matchmaking logic.

---

## Battle Type Comparison Matrix

| Mode | Best For | Solves Large Pool? | Engagement | Rating Accuracy | Effort |
|------|----------|-------------------|------------|-----------------|--------|
| ⚖️ Swiss (existing) | General ranking | Partially | Medium | High | — |
| 🎯 Gauntlet (existing) | Quick placement | No (linear climb) | High | Medium | — |
| 🏆 Champion (existing) | Fine-tuning | No (over-samples winner) | Medium | Medium-High | — |
| ⚡ Blitz | **Throughput** | **Yes — 2-3x faster** | Very High | Medium | Low |
| 🎯 Calibration | **Efficiency** | **Yes — O(n log n)** | Low-Medium | Very High | Medium-High |
| 👥 Category Showdown | **Chunking large pools** | **Yes — divide & conquer** | High | High | High |
| 🏟️ Tournament | Events/drama | Partially (subset) | Very High | Medium | Medium |
| 🔄 Rematch | Maintenance | Partially (revisits) | Medium | High | Low-Medium |
| 🏅 Round Robin | Small group precision | No (small groups only) | Medium | Very High | Medium |
| 🔀 Random Rumble | Initial seeding | Partially (fast pairs) | Low-Medium | Low-Medium | Very Low |

---

## Recommended Priority (For Large Libraries)

### Tier 1 — Directly solves the large pool problem
1. **⚡ Blitz Mode** — Simplest and most impactful. The #1 problem is throughput — getting through enough comparisons. A timer turns a 10-second decision into a 3-second decision, tripling your coverage rate. Low implementation effort, high impact.
2. **🎯 Calibration Mode** — The "smart" solution. Instead of making more comparisons faster, make each comparison count more. Binary-search placement + confidence tracking means you know exactly when each performer's rating is reliable. Medium-high effort but the most efficient path to accurate rankings.

### Tier 2 — Makes large pools manageable
3. **👥 Category Showdown** — Divide and conquer. Instead of "rate all 1,000 performers," it becomes "rate these 15 from Studio A, then these 20 from Studio B." Psychologically much easier and leverages existing tag/studio data. High implementation effort but transforms the user experience.
4. **🏟️ Tournament Mode** — Manageable scope with clear endpoints. A 16-performer tournament is 15 comparisons (2.5 minutes). Run 10 tournaments and you've meaningfully rated 160 performers. The visual bracket also makes the process fun.

### Tier 3 — Complementary features
5. **🔄 Rematch Mode** — Once you've built rankings, this keeps them fresh without starting over. Important for long-term maintenance.
6. **🏅 Round Robin** — Perfect for "rank my top 20 favorites" but doesn't help with initial large-pool coverage.
7. **🔀 Random Rumble** — Almost free to implement (simpler than Swiss) and useful for initial seeding when all performers are at default rating.

---

## Improvements to Existing Modes for Large Pools

Beyond new battle types, these changes to the existing system would directly help with large libraries:

### 1. Coverage Dashboard
Add a visible counter: **"247 of 1,200 performers rated (21%)"**. This gives users a sense of progress and motivation to continue. Can be displayed in the battle modal header or stats modal.

### 2. Coverage-Guaranteed Swiss
Modify Swiss matchmaking so that when unrated performers exist, at least one side of every pairing is always an unrated performer. This guarantees maximum coverage per comparison. Once all performers have ≥ N matches, revert to normal Swiss matchmaking.

### 3. Performer Sampling for Large Pools
Mirror the image mode's approach: when the pool exceeds 500 performers, fetch a stratified sample of ~200 performers (proportionally across rating tiers) instead of all performers. This improves performance without sacrificing matchmaking quality.

### 4. Batch Quick-Rate Option
Before entering full battle mode, show a "Quick Sort" screen where performers appear one at a time and users swipe/click to place them into 5 tiers (Terrible → Amazing). This initial 5-tier sort converts to approximate ELO ratings (10/30/50/70/90), giving every performer a rough starting position before pairwise refinement. This could significantly reduce the early comparisons where all performers sit at the default rating of 50 and matchmaking has no meaningful signal to work with.

### 5. Session Targets
Add optional session goals: "Rate 50 matchups" or "Rate for 10 minutes." Shows progress bar toward the goal. Makes the task feel achievable rather than infinite. Pairs well with Blitz mode.

---

## Summary

The current HotOrNot battle logic uses a **well-designed modified ELO system** that is the right algorithm choice for this use case. The three existing modes (Swiss, Gauntlet, Champion) are solidly implemented.

**The main challenge isn't the algorithm — it's throughput.** With a large performer library, getting every performer into enough matchups is a time problem, not a math problem.

The highest-impact additions would be:
1. **⚡ Blitz Mode** — 2-3x more comparisons per session (low effort, high impact)
2. **🎯 Calibration Mode** — maximize information per comparison (medium effort, high impact)
3. **Coverage-guaranteed Swiss** — ensure every comparison helps cover the pool (low effort, medium impact)
4. **Batch Quick-Rate** — eliminate the cold-start problem where everyone starts at 50 (medium effort, high impact)
