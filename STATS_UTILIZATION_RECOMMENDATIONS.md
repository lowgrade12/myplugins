# Stats Utilization Recommendations for HotOrNot_v2

## Executive Summary

After reviewing the `hotornot_v2` plugin, I found that while comprehensive statistics are being collected, there is significant opportunity to better utilize these stats to improve battle quality and user experience. This document outlines how the stats are currently used, what's missing, and provides concrete recommendations for improvement.

---

## Current Stats Being Collected

The plugin collects the following statistics in the `hotornot_stats` custom field:

| Stat | Description | Currently Used? |
|------|-------------|-----------------|
| `total_matches` | Total battles participated in | ✅ Yes (K-factor calculation, recency weight) |
| `wins` | Number of wins | ❌ Partially (Stats display only) |
| `losses` | Number of losses | ❌ Partially (Stats display only) |
| `draws` | Number of skips/draws | ❌ Partially (Stats display only) |
| `current_streak` | Current win/loss streak | ❌ Display only (gauntlet champion badge) |
| `best_streak` | Best winning streak ever | ❌ Stats display only |
| `worst_streak` | Worst losing streak ever | ❌ Stats display only |
| `last_match` | ISO timestamp of last battle | ✅ Yes (recency weight) |

---

## How Stats Are Currently Used

### 1. K-Factor Calculation (Rating Volatility)
**Location:** `getKFactor()` function (lines ~1025-1090)

The `total_matches` stat is used to determine how much ratings can change:
- **0-9 matches**: K=16 (new performers change quickly)
- **10-29 matches**: K=12 (moderate stability)
- **30+ matches**: K=8 (established, stable ratings)

### 2. Recency Weighting for Swiss Matchmaking
**Location:** `getRecencyWeight()` function (lines ~1595-1660)

Both `total_matches` and `last_match` are used to prioritize performers:
- Performers with fewer matches get higher weight (more likely to be selected)
- Recently matched performers get lower weight (avoid repetition)

```javascript
// Match count weight
if (stats.total_matches === 0) matchCountWeight = 3.0;  // Never matched
else if (stats.total_matches <= 5) matchCountWeight = 2.0;
else if (stats.total_matches <= 15) matchCountWeight = 1.5;
else if (stats.total_matches <= 30) matchCountWeight = 1.0;
else matchCountWeight = 0.5;  // Well established

// Recency weight
if (hoursSinceMatch < 1) recencyWeight = 0.1;   // Very recent
else if (hoursSinceMatch < 6) recencyWeight = 0.3;
else if (hoursSinceMatch < 24) recencyWeight = 0.6;
else recencyWeight = 1.0;  // Old enough
```

### 3. Display Only
- **Stats Modal**: Shows win rates, streaks, and leaderboard
- **Battle Rank Badge**: Shows match record on performer page
- **Gauntlet Champion Badge**: Shows win streak during gauntlet runs

---

## What's NOT Being Utilized

### 🔴 Win Rate / Performance Metrics
The `wins`, `losses`, and `draws` stats are NOT used in matchmaking. A performer with 90% win rate is matched the same as one with 10% win rate at similar ratings.

### 🔴 Streak Information
`current_streak`, `best_streak`, and `worst_streak` are NOT used in battle selection. This means:
- A performer on a 10-win streak has no special consideration
- Cold streaks don't trigger "prove yourself" matchups

### 🔴 Draw/Skip Rate
The `draws` stat doesn't influence anything. Performers frequently skipped aren't handled specially.

---

## Recommendations for Better Stats Utilization

### 1. **Win Rate Adjusted Rating Display** (Low Effort, High Impact)

**Problem:** Rating alone doesn't tell the full story. A performer at rating 70 with 20% win rate is different from one at 70 with 80% win rate.

**Solution:** Show a "confidence indicator" based on win rate vs expected win rate.

```javascript
// Calculate expected win rate based on rating
function getExpectedWinRate(rating) {
  // At rating 50, expected ~50% win rate
  // At rating 75, expected ~75% against average opponents
  return rating / 100;
}

// Compare actual vs expected
function getConfidenceIndicator(performer) {
  const stats = parsePerformerEloData(performer);
  if (stats.total_matches < 10) return "⚡ New";
  
  const actualWinRate = stats.wins / stats.total_matches;
  const expected = getExpectedWinRate(performer.rating100 || 50);
  const diff = actualWinRate - expected;
  
  if (diff > 0.15) return "📈 Overperforming";  // Winning more than expected
  if (diff < -0.15) return "📉 Underperforming"; // Losing more than expected
  return "📊 Stable";
}
```

**Display in battle UI:** Show this next to the performer's rating.

---

### 2. **Hot/Cold Streak Matchmaking** (Medium Effort, High Impact)

**Problem:** Performers on winning streaks might be underrated and should face tougher opponents. Cold streak performers might be overrated.

**Solution:** Use streak data to influence opponent selection.

```javascript
function getStreakAdjustedOpponentSelection(performer, allPerformers) {
  const stats = parsePerformerEloData(performer);
  const baseRating = performer.rating100 || 50;
  
  // If on a hot streak, look for opponents ABOVE their rating
  // This accelerates rating for truly underrated performers
  if (stats.current_streak >= 3) {
    const streakBonus = Math.min(stats.current_streak * 2, 10); // Max +10
    return findOpponentsNear(baseRating + streakBonus, allPerformers);
  }
  
  // If on a cold streak, look for opponents BELOW their rating
  // Gives them a chance to prove their rating or drop faster
  if (stats.current_streak <= -3) {
    const streakPenalty = Math.min(Math.abs(stats.current_streak) * 2, 10);
    return findOpponentsNear(baseRating - streakPenalty, allPerformers);
  }
  
  // Normal: match near their actual rating
  return findOpponentsNear(baseRating, allPerformers);
}
```

**Benefits:**
- Hot performers quickly climb to their "true" level
- Cold performers either regain confidence at easier matchups or drop appropriately
- Makes rankings more dynamic and responsive

---

### 3. **"Undermatched" Performer Priority** (Medium Effort, Medium Impact)

**Problem:** Some performers have very few matches compared to others. This means their ratings are less reliable.

**Solution:** Prioritize undermatched performers more aggressively, especially for new sessions.

```javascript
function shouldForceUndermatchedPerformer() {
  // 20% of matchups should include an undermatched performer
  return Math.random() < 0.20;
}

async function fetchSwissPairPerformersImproved() {
  const performers = await fetchAllPerformersWithStats();
  
  // Find performers with low match counts
  const undermatched = performers.filter(p => {
    const stats = parsePerformerEloData(p);
    return stats.total_matches < 10;
  });
  
  if (shouldForceUndermatchedPerformer() && undermatched.length > 0) {
    // Force pick an undermatched performer
    const performer1 = undermatched[Math.floor(Math.random() * undermatched.length)];
    // Find similar-rated opponent
    const opponent = findSimilarRated(performer1, performers);
    return { performers: [performer1, opponent], ranks: [/* ... */] };
  }
  
  // Normal weighted selection
  return await fetchSwissPairPerformers();
}
```

---

### 4. **Skip/Draw Rate for "Controversial" Performers** (Low Effort, Medium Impact)

**Problem:** Some performers get skipped frequently, indicating users can't decide. This is valuable data not being used.

**Solution:** Track skip rate and use it to identify "controversial" performers that might need more matchups.

```javascript
function getSkipRate(performer) {
  const stats = parsePerformerEloData(performer);
  if (stats.total_matches === 0) return 0;
  return (stats.draws || 0) / stats.total_matches;
}

function isControversialPerformer(performer) {
  return getSkipRate(performer) > 0.3; // More than 30% skips
}

// In matchmaking: occasionally pair two controversial performers
// This forces users to make decisions on "hard" matchups
```

---

### 5. **Rating Confidence Interval** (Medium Effort, High Impact)

**Problem:** A rating of 70 means very different things depending on match count.

**Solution:** Calculate and display a confidence interval.

```javascript
function getRatingConfidence(performer) {
  const stats = parsePerformerEloData(performer);
  const matches = stats.total_matches || 0;
  
  // More matches = narrower confidence interval
  // Using a simplified formula: base uncertainty decreases with sqrt(matches)
  const baseUncertainty = 15;
  const uncertainty = Math.round(baseUncertainty / Math.sqrt(Math.max(1, matches)));
  
  return {
    low: Math.max(1, (performer.rating100 || 50) - uncertainty),
    high: Math.min(100, (performer.rating100 || 50) + uncertainty),
    matches: matches
  };
}

// Display: "Rating: 70 (65-75)" for performer with 10 matches
// Display: "Rating: 70 (68-72)" for performer with 100 matches
```

---

### 6. **Performance Trend Indicator** (Medium Effort, Medium Impact)

**Problem:** Current stats don't show if a performer is trending up or down.

**Solution:** Track recent performance vs historical.

```javascript
// Add to stats: recent_results as a 10-bit bitmask
// Each bit represents a match outcome: 1=win, 0=loss (draws are treated as losses for trend)
// Least significant bit is the most recent match
// Example: 0b1110010001 means: W, W, W, L, L, W, L, L, L, W (oldest to newest)
function updatePerformerStatsWithTrend(currentStats, outcome) {
  // outcome: true (win), false (loss), or "draw" (skip)
  // For trend tracking, draws count as 0 (loss) since they don't indicate a clear victory
  const isWin = outcome === true;
  
  const newStats = updatePerformerStats(currentStats, outcome);
  
  // Keep a rolling window of last 10 results using efficient bitmask storage
  let recentResults = currentStats.recent_results || 0;
  recentResults = (recentResults << 1) | (isWin ? 1 : 0); // Shift left and add new result
  recentResults = recentResults & 0x3FF; // Keep only 10 bits (0x3FF = 1023 = 0b1111111111)
  
  newStats.recent_results = recentResults;
  return newStats;
}

function getTrend(performer) {
  const stats = parsePerformerEloData(performer);
  if (!stats.recent_results) return "neutral";
  
  // Count wins using Brian Kernighan's bit counting algorithm (efficient)
  let recentWins = 0;
  let n = stats.recent_results;
  while (n) {
    recentWins++;
    n &= n - 1; // Clear the least significant set bit
  }
  
  const recentMatches = Math.min(10, stats.total_matches);
  if (recentMatches < 5) return "new";
  
  const recentWinRate = recentWins / recentMatches;
  const overallWinRate = stats.wins / stats.total_matches;
  
  if (recentWinRate > overallWinRate + 0.2) return "rising";
  if (recentWinRate < overallWinRate - 0.2) return "falling";
  return "stable";
}
```

---

### 7. **Smart Gauntlet Starting Point** (Low Effort, High Impact)

**Problem:** Gauntlet mode always starts at the bottom, which can be tedious for known high performers.

**Solution:** Use stats to suggest a better starting point.

```javascript
async function suggestGauntletStartPosition(performer) {
  const stats = parsePerformerEloData(performer);
  const rating = performer.rating100 || 50;
  
  // If performer has a track record, suggest starting near their rating level
  if (stats.total_matches >= 10) {
    const winRate = stats.wins / stats.total_matches;
    
    // Adjust starting position based on win rate
    // High win rate suggests they might be underrated
    const adjustment = (winRate - 0.5) * 20; // ±10 points
    
    return Math.round(Math.max(1, Math.min(100, rating + adjustment)));
  }
  
  // New performer: start at bottom
  return 1;
}
```

---

## Implementation Priority

| Recommendation | Effort | Impact | Priority |
|---------------|--------|--------|----------|
| 1. Win Rate Adjusted Display | Low | High | 🔥 **P1** |
| 5. Rating Confidence Interval | Medium | High | 🔥 **P1** |
| 2. Hot/Cold Streak Matchmaking | Medium | High | 🟡 **P2** |
| 7. Smart Gauntlet Start | Low | High | 🟡 **P2** |
| 3. Undermatched Priority | Medium | Medium | 🟢 **P3** |
| 4. Skip Rate Tracking | Low | Medium | 🟢 **P3** |
| 6. Performance Trend | Medium | Medium | 🟢 **P3** |

---

## Quick Win: Enhanced Battle Card Display

A simple enhancement that uses existing stats immediately:

```javascript
function createEnhancedPerformerCard(performer, side, rank = null, streak = null) {
  const stats = parsePerformerEloData(performer);
  
  // Add these to the card display
  const matchCount = stats.total_matches;
  const winRate = matchCount > 0 ? ((stats.wins / matchCount) * 100).toFixed(0) : 'N/A';
  const confidenceLevel = matchCount < 10 ? '⚡ New' : 
                          matchCount < 30 ? '📊 Growing' : '✅ Established';
  
  // Streak indicator
  const streakIcon = stats.current_streak >= 3 ? '🔥' :
                     stats.current_streak <= -3 ? '❄️' : '';
  
  // Add to card HTML
  return `
    <!-- existing card HTML... -->
    <div class="hon-meta-item">
      <strong>Matches:</strong> ${matchCount} (${confidenceLevel})
    </div>
    <div class="hon-meta-item">
      <strong>Win Rate:</strong> ${winRate}% ${streakIcon}
    </div>
    <!-- rest of card... -->
  `;
}
```

---

## Conclusion

The hotornot_v2 plugin collects excellent statistics but primarily uses them for display purposes. By incorporating these stats into the matchmaking logic, you can:

1. **Faster Rating Convergence**: Use win rate and streaks to identify over/underrated performers
2. **Better Matchups**: Pair performers more intelligently based on confidence and trends
3. **Reduced Tedium**: Smart starting positions for gauntlet mode
4. **More Informative UI**: Show users why matchups are happening

The highest-impact, lowest-effort improvements are:
- Display confidence intervals and win rates in battle cards
- Use streak data to adjust matchmaking targets

These changes would make the ranking system significantly more responsive and accurate while keeping the fun, gamified experience intact.
