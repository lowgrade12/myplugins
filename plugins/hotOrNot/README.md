# HotOrNot Plugin

An ELO-based ranking system for performers in [Stash](https://stashapp.cc/). Compare performers head-to-head in an interactive battle interface to build personalized rankings based on your preferences.

## Features

### Battle Modes

The plugin offers five distinct comparison modes:

#### ⚖️ Swiss Mode (Default)
- **True ELO with zero-sum property** - Winner gains exactly what loser loses, maintaining rating pool integrity
- Pairs performers with similar ratings for competitive matchups
- Uses weighted random selection to prioritize performers with fewer matches
- 10% random selection ensures detection of misranked performers
- Best for building initial rankings and ensuring balanced coverage

#### 🎯 Gauntlet Mode
- **King of the hill style** - One performer stays on as champion while challengers attempt to dethrone them
- Champion works their way up the rankings by defeating increasingly difficult opponents
- Only the active participant (champion) has their rating change
- When the champion loses, they enter a "falling" phase to find their proper position
  - Floor constraint: Rating cannot drop below any performer they've already defeated
  - Ceiling constraint: Rating cannot rise above the performer who beat them
- Visual streak tracking shows how many wins the current champion has
- Great for quickly placing a new performer and identifying top performers

#### 🏆 Champion Mode
- **Winner stays on** with reduced rating impact (50% of Swiss mode)
- Both performers get rating updates, but at a slower pace
- Maintains the "winner stays on" excitement while still evolving rankings
- Tracks winning streak for the current champion
- Good for fine-tuning existing rankings

#### 📐 Calibration Mode
- **Smart ranking via binary search** — Finds each performer's true rating with minimal comparisons
- The system picks the performer whose rating it is **least confident** about (fewest matches) and focuses on them
- It then uses a binary-search approach to zero in on their correct position:
  - The performer is compared against well-established "anchor" performers near the midpoint of their estimated rating range
  - If the target performer **wins**, the lower bound of their rating range moves up (they're at least this good)
  - If the target performer **loses**, the upper bound moves down (they're no better than this)
  - Each match narrows the range until the rating converges
- **Step counter (e.g. "Step 3/10")**: Shows how many comparisons have been made for the current target performer, up to a maximum of 10
- **Early convergence**: A performer can finish **before** reaching step 10 if their rating range narrows to within ±5 points — meaning the system has already found their position accurately. This is why you may see a performer finish at step 5 and a new one begin
- **Confidence percentage**: Represents how reliable a performer's current rating is, based on how many matches they've played:
  - 0 matches = 0% confidence (completely unknown)
  - 3 matches ≈ 50% confidence (partially established)
  - 15 matches ≈ 75% confidence (well-established)
  - Confidence increases with more matches but never reaches 100%
  - Performers below 75% confidence are prioritized for calibration
- **Coverage dashboard** shows overall progress: total performers, how many have been rated, average confidence across all performers, and how many still need more matches
- Best for accurately ranking large performer pools with minimal effort — each comparison is chosen to be maximally informative

#### 🏟️ Tournament Mode
- **Single-elimination bracket competition** - Classic tournament format with seeded brackets
- Choose a tournament size: 8, 16, 32, or 64 participants
- Performers are seeded by current rating (highest-rated = seed 1)
- Standard seeding: seed 1 vs. last seed, seed 2 vs. second-to-last, etc.
- Winners advance through the bracket until a champion is crowned
- Visual bracket display shows all matches and progression
- Round naming: Round 1, Round 2, ..., Quarterfinal, Semifinal, Final
- Best for engagement and determining a clear champion through bracket competition

### ELO Rating System

- **Adaptive K-factor** based on:
  - Match count (new performers have higher K-factor for faster initial placement)
  - Scene count (prolific performers have more stable ratings)
  - Current rating distance from default
- **Diminishing returns** at high ratings (harder to reach 100)
- **Skip as draw** - Skipping applies ELO draw mechanics (higher-rated performer loses points to lower-rated)

### Comprehensive Statistics

Each performer tracks:
- Total matches played
- Wins, losses, and draws
- Current streak (positive = winning, negative = losing)
- Best and worst streaks ever
- Last match timestamp

Access the **Stats Modal** to view:
- Rating distribution bar chart (grouped by rating ranges)
- Full leaderboard with all performers
- Win rates and streak information

### URL Filter Support

Respects the current page's filter criteria when launched from a filtered performers page:
- Gender filters
- Tag filters
- Studio filters
- Rating filters
- Favorites filter
- Age, ethnicity, country filters
- And many more...

### User Interface

- **Navbar fire button** launch Swiss mode from anywhere
- **Performer Gauntlet** launch from performer page to start Gauntlet with that performer
- **Battle rank badge** on individual performer pages showing their rank position (e.g., "#5 of 100")
- **Star rating widget** on performer cards in the grid view for quick inline rating
- **Battle card tier pills** on HotOrNot matchup cards, with tier-change feedback after each vote
- **Side-by-side comparison** with performer images and metadata
- **Visual feedback** showing rating changes after each choice
- **Keyboard shortcuts**: Left Arrow (choose left), Right Arrow (choose right), Space (skip), Escape (close)
- **Responsive design** that works on desktop and mobile

### Star Rating Widget

On the performers list page, each performer card displays a 10-star rating widget:
- **Click-to-rate** - Click any star to set the rating (1 star = 10, 10 stars = 100)
- **Hover preview** - See what rating you're about to set before clicking
- **Real-time updates** - Changes are saved immediately to Stash
- **Smart caching** - Batch fetches ratings for performance with 5-minute TTL
- **Native sync** - Updates Stash's native rating displays when you change a rating
- Toggle on/off via **Settings → Plugins → HotOrNot → Show Star Rating Widget** (enabled by default)

### Battle Rank Badge

When viewing a single performer's page, a badge displays their battle rank:
- Shows rank position and total performers (e.g., "Battle Rank #5 of 100")
- Tier-based styling: 👑 Legendary (top 5%), 🥇 Gold (top 20%), 🥈 Silver (top 40%), 🥉 Bronze (top 60%), 🔥 Default
- Hover for tooltip showing exact rating
- Toggle on/off via **Settings → Plugins → HotOrNot → Show Battle Rank Badge** (enabled by default)

### Battle Card Tiers

Battle cards can optionally show configurable rating tiers and highlight when a performer crosses into a new tier after a vote.

- Setting: **Settings → Plugins → HotOrNot → Battle Card Tier Mapping**
- Format: `r_<thresholds>_<tiers>`
- Example: `r_10/8.5/7/5.5/4/2.5/0_gold/hot/default/#7f1e82/#14bbe0/#92e014/#808080`
- Threshold count must match tier count (each threshold maps to one tier token)

## Installation

1. Download the `/plugins/hotOrNot/` folder to your Stash plugins directory
2. Reload plugins in Stash (Settings → Plugins → Reload)
3. Navigate to the Performers page to see the floating HotOrNot button and star rating widgets on performer cards

## Usage

1. Go to the Performers page in Stash
2. Optionally apply filters to narrow down the performer pool
3. Click the floating HotOrNot button (🔥) in the bottom-right corner
4. Select your preferred battle mode
5. Click on a performer or their "Choose" button to select the winner
6. Continue rating until you're satisfied with your rankings

### Tips

- **First run**: Swiss mode with many comparisons builds a solid ranking foundation
- **Quick ranking**: Gauntlet mode rapidly places a specific performer in the rankings
- **Fine-tuning**: Champion mode adjusts rankings with smaller changes
- **Accuracy**: Calibration mode efficiently finds each performer's true position — watch the step counter and dashboard to track progress. Performers may finish early if their rating converges before step 10
- **Fun**: Tournament mode creates a bracket competition to crown a champion
- **Skip strategically**: Use skip when you can't decide - it affects both performers' ratings based on ELO draw mechanics

## Custom Fields

The plugin stores match statistics in a custom field called `hotornot_stats` containing:
```json
{
  "total_matches": 42,
  "wins": 25,
  "losses": 15,
  "draws": 2,
  "current_streak": 3,
  "best_streak": 8,
  "worst_streak": -4,
  "last_match": "2024-01-15T10:30:00.000Z"
}
```

## Requirements

- Stash v0.27 or later
- Performers must have images for best experience (performers without images are excluded by default)

## Technical Details

### Rating Scale
- Ratings are stored as `rating100` (0-100 scale)
- Displayed as 0.0-10.0 in the UI
- Default rating for unrated performers: 50 (5.0)

### K-Factor Calculation
| Match Count | Base K-Factor |
|-------------|---------------|
| 0-9 matches | 16 |
| 10-29 matches | 12 |
| 30+ matches | 8 |

Scene count multipliers further reduce K-factor for established performers.

### Default Filters
When no URL filters are applied, the plugin automatically:
- Excludes male performers
- Excludes performers without images

## License

See [LICENCE](../../LICENCE) for details.
