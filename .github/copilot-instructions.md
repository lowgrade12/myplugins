# GitHub Copilot Instructions for HotOrNot Plugin Repository

This repository contains plugins for [Stash](https://stashapp.cc/), primarily implementing an ELO-based rating system for performers and images.

## Project Overview

- **Primary Plugin**: HotOrNot - ELO-based ranking system for performers and images
- **Purpose**: Stash plugin development using JavaScript, YAML configuration, and GitHub Pages deployment
- **Tech Stack**: Vanilla JavaScript (browser-based), GraphQL, YAML
- **Deployment**: GitHub Pages via `build_site.sh` script

## Coding Standards

### JavaScript

- Use **strict mode**: All JS files start with `(function () { "use strict"; ... })()`
- Use **double quotes** for strings in JavaScript
- Use **semicolons** to end statements
- Use **const** and **let** for variable declarations (no var)
- Prefer `async/await` over raw promises for GraphQL queries
- Use template literals for string interpolation

### Code Style

- **Indentation**: 2 spaces (no tabs)
- **Naming conventions**:
  - Use camelCase for variables and functions (e.g., `currentPair`, `graphqlQuery`)
  - Use UPPER_CASE for constants (e.g., `ARRAY_BASED_MODIFIERS`, `SCENE_FRAGMENT`)
  - Prefix GraphQL fragments with type name (e.g., `PERFORMER_FRAGMENT`, `IMAGE_FRAGMENT`)
- **Comments**: Use JSDoc-style comments for functions with @param and @returns
- **Console logging**: Prefix all console messages with `[PluginName]` for debugging (e.g., `console.error("[HotOrNot] GraphQL error:")`)
- Use `console.log` for debugging, `console.warn` for warnings, `console.error` for errors

### GraphQL

- All GraphQL queries go through the `graphqlQuery(query, variables)` helper function
- Define GraphQL fragments as constants (e.g., `PERFORMER_FRAGMENT`, `SCENE_FRAGMENT`)
- Always handle GraphQL errors with appropriate error logging
- Use async/await for GraphQL operations
- Endpoint: `/graphql` (relative path)

### Plugin Structure

Each plugin directory should contain:
- `<plugin_name>.yml` - Plugin metadata and configuration
- `<plugin_name>.js` - Main JavaScript code
- `<plugin_name>.css` (optional) - Plugin styles
- `README.md` (optional) - Plugin documentation

### YAML Configuration

Plugin YAML files must include:
- `name`: Plugin display name
- `description`: Brief description of functionality
- `version`: Semantic version (e.g., `1.0.0`)
- `url`: Repository URL
- `ui`: Object with `javascript` and optional `css` arrays

Example:
```yaml
name: PluginName
description: Plugin description
version: 1.0.0
url: https://github.com/lowgrade12/hotornottest.git
ui:
  javascript:
    - plugin.js
  css:
    - plugin.css
```

## Architecture Patterns

### ELO Rating System

- Ratings stored in Stash's `rating100` field (1-100 scale)
- Use adaptive K-factor based on match count and scene count
- Statistics tracked in `hotornot_stats` custom field
- Support for Swiss, Gauntlet, and Champion comparison modes

### State Management

- Use module-scoped variables for state (within IIFE closure)
- Disable inputs during processing to prevent race conditions (e.g., `disableChoice` flag)
- Cache filters when modal opens to ensure consistency

### Error Handling

- Always wrap GraphQL calls in try-catch blocks
- Log errors with descriptive messages including plugin name prefix
- Validate user input before processing
- Handle edge cases (empty arrays, null values, etc.)

## Testing & Validation

- Test all changes manually in a Stash instance
- Verify GraphQL queries return expected data
- Test filter parsing with various URL parameter combinations
- Ensure plugin UI renders correctly across different screen sizes
- Test keyboard navigation where implemented

## Security

- **Never commit secrets or API keys**
- Sanitize user input before using in GraphQL queries
- Validate filter criteria before applying
- Use safe parsing functions (e.g., `safeParseInt`) to prevent injection

## Build & Deployment

### Build Process

- Run `./build_site.sh` to build the plugin repository
- Output goes to `_site/` directory
- Each plugin is packaged as a `.zip` file
- `index.yml` contains metadata for all plugins

### GitHub Actions

- Deployment workflow: `.github/workflows/deploy.yml`
- Triggers on push to `main` branch when `plugins/**` files change
- Deploys to GitHub Pages automatically
- Requires `contents: read`, `pages: write`, `id-token: write` permissions

### Version Management

- Version format: `<yml_version>-<git_hash>`
- Git hash is short SHA of last commit affecting the plugin
- Update `version` field in YAML when making significant changes

## Dependencies

- **Stash**: v0.27 or later required
- **Browser APIs**: Fetch API, DOM manipulation
- **No external libraries**: All plugins use vanilla JavaScript
- **No package.json**: No npm dependencies or build tools

## File Organization

- Main plugins in `./plugins/` directory
- Each plugin in its own subdirectory
- Documentation files in root directory
- GitHub workflows in `.github/workflows/`
- Build artifacts in `_site/` (git-ignored)

## Common Tasks

### Adding a New Plugin

1. Create new directory in `./plugins/<plugin_name>/`
2. Add `<plugin_name>.yml` with required metadata
3. Add `<plugin_name>.js` with plugin code
4. Optional: Add `<plugin_name>.css` for styles
5. Optional: Add `README.md` for documentation
6. Test locally in Stash
7. Commit and push to trigger deployment

### Modifying Existing Plugin

1. Make changes to plugin files
2. Update `version` in YAML if significant change
3. Test thoroughly in Stash instance
4. Ensure backward compatibility when possible
5. Update documentation if behavior changes

### GraphQL Schema Changes

- Stash GraphQL schema may change between versions
- Always test against target Stash version
- Document minimum Stash version requirements
- Handle deprecated fields gracefully

## Best Practices

- **Keep it simple**: Prefer vanilla JS over complex frameworks
- **Performance**: Minimize DOM operations, cache selectors
- **Accessibility**: Support keyboard navigation where applicable
- **Documentation**: Comment complex logic, especially filter parsing
- **Backward compatibility**: Maintain compatibility with older Stash versions when possible
- **Testing**: Always test changes in actual Stash environment before committing
- **Git**: Write clear commit messages describing changes
- **Code reuse**: Extract common patterns into helper functions

## Resources

- [Stash Documentation](https://docs.stashapp.cc/)
- [Stash GraphQL API](https://stashapp.cc/graphql)
- Repository README: `/README.md`
- Plugin documentation in individual plugin directories
