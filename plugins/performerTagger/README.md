# PerformerTagger

Injects a quick-tag panel on performer detail pages for one-click attribute tagging, and provides a server-side batch task that auto-tags all performers from the Stash Task Queue.

## Features

- **Quick-tag panel** — one-click buttons on every performer detail page for manual tag assignment
- **Auto-tagging** — automatically applies tags derived from a performer's stored Stash data fields when you open their page
- **Batch Tag Performers** (task) — server-side task that scans every performer and applies tags in bulk
- **Remove All Performer Tags** (task) — wipes all managed tags from every performer so the batch task can start fresh
- **Current-page batch** — ⚡ Batch Tag button on the performers list page that tags only the performers currently visible (respects active filters and pagination)

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Show the quick-tag panel on performer detail pages. |
| `collapsed` | `false` | Start the quick-tag panel in a collapsed state. |

Both settings are configurable from **Settings → Plugins → PerformerTagger** in Stash.

---

## Tag Categories

The plugin manages seven tag categories. Each category uses a **parent tag** of the same name in Stash's tag hierarchy, and the individual attribute tags are children of that parent.

When a value can be derived from the performer's Stash data fields, the correct tag is always applied and any wrong managed tags in that category are replaced. Categories for which no data can be derived are left completely untouched.

---

### Hair Color

**Source field:** `hair_color`

| Tag | Applied when `hair_color` contains… |
|-----|--------------------------------------|
| Auburn | `auburn` |
| Blonde | `blonde` or `blond` |
| Brunette | `brunette` or `brown` |
| Black Hair | `black` |
| Red Hair | `red` |
| Gray Hair | `gray`, `grey`, or `silver` |

Matching is case-insensitive substring matching. If no keyword matches, no tag is applied and any existing Hair Color tags are left untouched.

---

### Eye Color

**Source field:** `eye_color`

| Tag | Applied when `eye_color` contains… |
|-----|-------------------------------------|
| Blue Eyes | `blue` |
| Brown Eyes | `brown` or `dark` |
| Green Eyes | `green` |
| Hazel Eyes | `hazel` |
| Gray Eyes | `gray` or `grey` |
| Amber Eyes | `amber` |

Matching is case-insensitive substring matching.

---

### Ethnicity

**Source field:** `ethnicity`

| Tag | Applied when `ethnicity` contains… |
|-----|-------------------------------------|
| Caucasian | `caucasian` or `white` |
| Asian | `asian` |
| Latina | `latina`, `hispanic`, or `latin` |
| Ebony | `black`, `african`, or `ebony` |
| Mixed | `mixed` or `biracial` |

> **Note:** `caucasian` is checked before `asian` to prevent `"caucasian"` from incorrectly matching the Asian tag via substring (`"caucasian"` contains `"asian"`).

---

### Body Type

**Source field:** `height_cm`

| Tag | Applied when… |
|-----|---------------|
| Skinny | `height_cm` > 0 and ≤ 160 cm (~5′3″) |

Only the Skinny tag is auto-derived (for shorter performers). The remaining Body Type tags — Slim, Athletic, Average, Curvy, BBW, Muscular — are available as manual quick-tag buttons in the panel but are never auto-applied.

---

### Height

**Source field:** `height_cm`

| Tag | Applied when… |
|-----|---------------|
| Tall | `height_cm` ≥ 175 cm (~5′9″) |
| Average | `height_cm` ≥ 165 cm and < 175 cm (~5′5″–5′8″) |
| Short | `height_cm` ≥ 155 cm and < 165 cm (~5′1″–5′4″) |
| Tiny | `height_cm` > 0 and < 155 cm (under ~5′1″) |

If `height_cm` is 0 or absent, no Height tag is applied.

---

### Bust Type

**Source field:** `fake_tits`

| Tag | Applied when `fake_tits`… |
|-----|---------------------------|
| Natural Tits | equals (case-insensitive) `""` (empty), `"no"`, `"false"`, or `"natural"` |
| Enhanced | is any non-empty, non-natural value other than `"unknown"` |

If `fake_tits` is `null`/not set, or equals `"unknown"`, no Bust Type tag is applied.

---

### Bust Size

**Source field:** `measurements`

The plugin parses the cup letter from the start of the measurements string (e.g. `"34C-24-34"` → cup `C`).

| Tag | Cup letter(s) |
|-----|---------------|
| Small Bust | A, B |
| Medium Bust | C, D |
| Large Bust | DD, DDD, E, F, FF, G, GG, H, HH, J, JJ, K (and larger) |

If the measurements field is absent or does not start with a recognisable cup letter, no Bust Size tag is applied.

---

## Tag Hierarchy

Category tags are created automatically as parents if they do not already exist. The hierarchy looks like:

```
Hair Color
├── Blonde
├── Brunette
├── Black Hair
├── Red Hair
├── Auburn
└── Gray Hair

Eye Color
├── Blue Eyes
├── Brown Eyes
├── Green Eyes
├── Hazel Eyes
├── Gray Eyes
└── Amber Eyes

Body Type
├── Skinny
├── Slim
├── Athletic
├── Average
├── Curvy
├── BBW
└── Muscular

Bust Size
├── Small Bust
├── Medium Bust
└── Large Bust

Bust Type
├── Natural Tits
└── Enhanced

Ethnicity
├── Asian
├── Latina
├── Ebony
├── Caucasian
└── Mixed

Height
├── Tall
├── Average
├── Short
└── Tiny
```

Tag aliases in Stash are also supported — if a tag name is not found by exact name, the plugin checks whether any existing tag uses that name as an alias.

---

## Batch Tasks

Both tasks are accessible from **System → Tasks** in Stash.

### Batch Tag Performers

Scans every performer in your library and applies attribute tags derived from their Stash data fields. Male performers are skipped. For each category where a value can be derived, the correct tag is applied and any incorrect managed tags in that category are removed.

### Remove All Performer Tags

Removes **all** tags from every performer. Use this before running Batch Tag Performers when you want to rebuild tags from a completely clean slate.
