# Copilot Instructions

## Project Overview

This repository contains plugins for [Stash](https://stashapp.cc/), a media organization application. The main plugin is HotOrNot, which implements an ELO-based ranking system for performers and images through head-to-head comparisons.

## Language & Technology Stack

- **Primary Language**: JavaScript (ES6+)
- **Runtime Environment**: Browser-based (Stash web UI)
- **Data Layer**: GraphQL API for Stash database
- **UI Framework**: Vanilla JavaScript with DOM manipulation
- **Styling**: CSS3 with BEM-like naming conventions
- **Configuration**: YAML for plugin metadata

## Code Conventions

### JavaScript

- **Always** use strict mode: `"use strict";` at the top of IIFE
- Wrap all plugin code in an IIFE: `(function () { "use strict"; ... })();`
- Use `const` and `let` instead of `var`
- Use async/await for asynchronous operations
- Prefer template literals for string interpolation
- Use meaningful variable names with camelCase
- Add comments for complex logic sections with section headers like `// ============================================`
- Use arrow functions for callbacks

### GraphQL

- All data operations must use the Stash GraphQL API at `/graphql`
- Use fragments for reusable field sets
- Handle errors properly with try-catch blocks
- Cache queries when appropriate for performance

### CSS

- Use class-based selectors, avoid IDs
- Prefix plugin-specific classes (e.g., `hon-` for HotOrNot, `rating-` for rating plugin)
- Follow a consistent naming pattern: component-element-modifier
- Keep styles scoped to avoid conflicts with Stash UI
- Use flexbox for layouts
- Ensure responsive design considerations

### Plugin Structure

Each plugin must have:
- `pluginname.js` - Main JavaScript code
- `pluginname.css` - Styling (if needed)
- `pluginname.yml` - Plugin metadata file
- `README.md` - Documentation

### YAML Configuration

Plugin YAML files must include:
```yaml
name: PluginName
description: Brief description
version: x.y.z
url: https://github.com/lowgrade12/hotornottest.git
ui:
  javascript:
    - pluginname.js
  css:
    - pluginname.css  # if applicable
```

## Domain-Specific Guidelines

### ELO Rating System

- Ratings are stored in Stash's `rating100` field (1-100 scale)
- Use adaptive K-factors based on match count and scene count
- Implement proper ELO calculation: `newRating = oldRating + K * (actual - expected)`
- Expected score formula: `1 / (1 + 10^((opponentRating - playerRating) / 400))`

### Statistics Tracking

- Store comprehensive stats in custom fields (e.g., `hotornot_stats`)
- Track: wins, losses, draws, streaks, win rates, match history
- Use timestamps for recency weighting
- Validate data integrity when reading/writing stats

### Comparison Modes

When implementing comparison features:
- **Swiss Mode**: Fair matchups with full stat tracking
- **Gauntlet Mode**: Challenger vs defenders with limited defender stats
- **Champion Mode**: Winner-stays-on with reduced K-factor

### Performance Optimization

- For large datasets (>1000 items), implement intelligent sampling
- Use caching for frequently accessed data
- Minimize GraphQL queries - batch when possible
- Debounce user interactions to prevent spam clicks

## Testing & Validation

- Test with various library sizes (small, medium, large)
- Verify filter compatibility with Stash's active filters
- Test keyboard navigation alongside mouse interactions
- Ensure proper error handling and user feedback
- Validate GraphQL queries and mutations work correctly

## Documentation

- Keep README.md files up to date with features and usage
- Document breaking changes in version updates
- Include installation instructions
- Provide clear usage examples
- Document any dependencies or requirements

## Security & Best Practices

- Never expose sensitive user data
- Validate all user inputs
- Handle errors gracefully with user-friendly messages
- Use `console.error` for debugging, prefix with `[PluginName]`
- Prevent race conditions with proper state management
- Implement proper cleanup for event listeners

## License

All code is licensed under GNU Affero General Public License v3.0 (AGPL-3.0)

## Additional Context

- Stash uses a GraphQL API for all data operations
- The plugin system injects JavaScript and CSS into the Stash web UI
- UI elements should integrate seamlessly with Stash's existing design
- Respect user's active filters (tags, studios, favorites, etc.)
- Maintain backward compatibility when possible
