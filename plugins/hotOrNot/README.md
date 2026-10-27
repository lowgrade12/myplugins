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
  - **Starting range**: Unrated performers start with the full 1–100 range. Rated performers start in a window around their current rating (±25 points after one match, narrowing to ±10 with more matches), so calibrating an established performer refines their rating instead of resetting it
  - The performer is compared against well-established "anchor" performers near the midpoint of their estimated rating range (inside the range whenever there's anyone there)
  - If the target performer **wins**, the lower bound of their rating range moves up (they're at least this good)
  - If the target performer **loses**, the upper bound moves down (they're no better than this)
  - After each match the target's rating is set to the middle of the remaining range, so it can dip after a win when the range was lopsided (a performer rated 95 starts at 70–100, is tested near 85, and moves to 93 if they win)
  - Anchors keep their rating — the match only counts in their stats — and skips don't change either rating
  - Each match narrows the range until the rating converges
  - If the range closes against an edge of the starting window (e.g. the performer keeps winning), that edge widens by 20 points (up to 100 or down to 1) so a misrated performer can still move past it
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
- Each champion's win is counted in `tournament_wins` and earns a place in the Hall of Fame

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
- Hall of Fame: every tournament champion, grouped by gender, with their title count

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

### Hall of Fame

Tournament champions get a **HotOrNot Hall of Fame** row on Stash's front page, above Stash's own rows:
- Uses Stash's own performer cards and slider, so it matches your theme
- Each card has a 🏆 trophy on its photo, with the title count from two titles
- Most titles first, then the most recent title (titles won before 2.3.2 have no date, so those champions follow, by name)
- **View All** opens the full Hall of Fame, grouped by gender (also a tab in the Stats Modal)
- Toggle on/off via **Settings → Plugins → HotOrNot → Show Hall of Fame Row** (enabled by default)

### Change Performer Image

Right-click a performer to pick a new profile image from any stash-box they're linked to (StashDB, TPDB, TPDB JAV, JAVStash, FansDB, …):
- **In battles** - right-click either performer's image
- **On performer pages and cards** - if the Stash Right Click Performers plugin is installed, its menu gets a "Change Image from …" item for each stash-box it doesn't cover itself. Without that plugin, right-clicking the image on a performer's page opens HotOrNot's own menu
- If a stash-box can't be reached or has no images, the menu item says so
- Images load straight from your browser, so a stash-box must be listed under `csp: connect-src` in `hotOrNot.yml`

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
  "last_match": "2024-01-15T10:30:00.000Z",
  "tournament_wins": 1,
  "last_title": "2024-01-12T21:04:00.000Z"
}
```

`last_title` is when the performer last won a tournament; the Hall of Fame orders champions with the same title count by it.

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
