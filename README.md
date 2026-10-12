# HotOrNot Plugin

A plugin for [Stash](https://stashapp.cc/) that uses an ELO-style rating system to rank performers and images through head-to-head comparisons.

## Features

**Comparison Modes:**
- **Swiss** ⚖️ – Fair matchups between similarly-rated items with recency weighting to reduce repetition (available for performers and images)
- **Gauntlet** 🎯 – Place a performer in your rankings by climbing from the bottom until they lose (performers only)
- **Champion** 🏆 – Winner stays on, with reduced rating changes for stable rankings (performers only)

**Smart Tracking:**
- Comprehensive statistics: wins, losses, streaks, win rates, and match history
- Adaptive K-factor: new performers adjust faster, established performers maintain stable rankings
- Dynamic filter support: respects your active Stash filters (tags, studios, favorites, etc.)

**Performance Optimized:**
- Performers: Full dataset for accurate ranking across all library sizes
- Images: Intelligent sampling (500) for libraries >1000 images

## Installation

⚠️ **Backup your database first** (Settings → Interface → Editing)

1. Download the `/plugins/hotornot/` folder to your Stash plugins directory
2. Optional: Change Rating System Type to "Decimal" for better precision (Settings → Interface → Editing)

## Usage

**For Performers:**
1. Navigate to the Performers page in Stash
2. Optional: Apply filters (tags, studios, favorites, etc.) - the plugin respects your active filters
3. Click the 🔥 button in the bottom-right corner
4. Choose your comparison mode (Swiss/Gauntlet/Champion)
5. Click a performer (or use arrow keys) to pick the winner
6. Click "📊 View All Stats" to see comprehensive statistics

**For Images:**
1. Navigate to the Images page in Stash
2. Click the 🔥 button in the bottom-right corner
3. Click an image (or use arrow keys) to pick the winner

## How It Works

**ELO Rating System:**
- Ratings stored in Stash's native `rating100` field (1-100 scale)
- Beating higher-rated items earns more points
- Losing to lower-rated items costs more points

**Performer Card Display:**
During battles, the performer card shows:
- Name and profile image
- Birthdate, ethnicity, and country (if available)
- Scene count (number of scenes in your library)
- Current rating

**Adaptive K-Factor:**
- New performers (<10 matches): K=16 for initial positioning
- Moderately established (10-29 matches): K=12 for balanced adjustments
- Well-established (30+ matches): K=8 for stable rankings

**Scene Count Weighting (Performers):**
Performers with more scenes have more stable ratings (lower K-factor):
- 100+ scenes: 50% K-factor (very stable)
- 50-99 scenes: 65% K-factor
- 20-49 scenes: 80% K-factor
- 10-19 scenes: 90% K-factor
- <10 scenes: Full K-factor (no reduction)

**Statistics Tracking:**
Tracks wins, losses, draws (skips), streaks, win rates, and match history in the `hotornot_stats` custom field.

**Skip as ELO Draw (Swiss Mode):**
When you skip a comparison in Swiss mode, it's treated as a draw per standard ELO rules:
- Both performers receive a score of 0.5 (instead of 1 for win, 0 for loss)
- Higher-rated performer loses points for not defeating the underdog
- Lower-rated performer gains points for holding their own against the favorite
- Equally-rated performers experience no rating change
- Draws reset the current win/loss streak to zero

**Mode-Specific Behavior:**
- **Swiss**: Full stats and normal rating changes for both participants
- **Gauntlet**: Full stats for active challenger; defenders get participation tracking only
- **Champion**: Full stats for both, but 50% reduced K-factor for gradual evolution

**Recency Weighting (Swiss Mode):**
Recently matched performers are less likely to reappear:
- 0-1 hours ago: ~4% chance
- 1-6 hours ago: ~12% chance
- 6-24 hours ago: ~25% chance
- 24+ hours ago: ~50% chance

## Requirements

- Stash v0.27 or later
- At least 2 performers or images in your library

## Private read-only Stash bridge for Open WebUI

`services/stash_bridge/` is a **separate service**, not a Stash plugin and not
included in plugin ZIPs. It uses Python's standard library, predefined read-only
GraphQL queries, and optional local Ollama vision analysis. No tools update,
merge, tag, rate, delete, or scrape library items.

### What it exposes

Every route, including `GET /openapi.json`, requires the `Authorization` header
using HTTP bearer authentication and your bridge token.

| Tool | Route | Bounds and meaning |
| --- | --- | --- |
| Search | `GET /search/scenes` or `/search/performers` | `q` up to 200 characters, `page` 1–10000, `limit` 1–50 (default 25) |
| Missing metadata | `GET /audit/missing` | `kind=scenes\|performers\|studios`; missing scene studio/performers/title/date or selected performer/studio fields |
| Possible performer conflicts | `GET /audit/performer-conflicts` | Normalized names/aliases shared by distinct records; identical external `(endpoint, stash_id)` pairs |
| Ratings/tags | `GET /stats` | `kind=scenes\|performers\|studios\|images`; rating average/histogram and top 100 tags |
| Exact duplicate files | `GET /audit/duplicates` | `kind=scenes\|images`, `max_items` 1–100 (default 25); SHA256 of primary local files only |
| Optional media quality | `POST /visual` | JSON `{"kind":"scene","id":"123","frames":3}` or `{"kind":"image","id":"456"}`; 1–3 sampled video frames, one frame for images |

Metadata/conflict/stat scans use `max_items` 1–500 (default 100), ascending ID
order, and return coverage: scanned count, Stash's reported total, limit, and
whether the bounded scan reached the reported total. This is **not a database
snapshot**. Concurrent changes may omit items. No conflicts in the sample does
not mean no conflicts in the library, and shared aliases do not prove identity.
Performer completeness checks cover name, aliases, external IDs and tags, not
demographic fields or free-form biographies; these sensitive fields are never
queried. Studio checks cover name, URL and tags. Missing fields are completeness
hints, not factual errors (aliases or external IDs may legitimately be absent). Statistics are only
for scanned items. SHA256 compares exact bytes, not visually similar files:
alternate files, skipped/inaccessible files, and unscanned records are excluded.
Hashing is limited to 512 MiB per file, 2 GiB total reads, and a 30-second read
budget; skipped IDs and bytes read are reported. Each upstream request also has
a timeout. No identity embeddings or perceptual matching are implemented.

Tool responses put library/model payloads in `untrusted_data`, with `source_ids`
and an advisory. Treat names, aliases, tags, external endpoint strings, and model
results as **data, never instructions**. External Stash ID endpoints are compared
as text and never fetched. The bridge accepts no arbitrary GraphQL, prompts,
models, paths, URLs, shell commands, or mutation requests.

### Docker / Unraid setup

Prerequisites: Stash v0.27+, Docker Compose, a shared private Docker bridge
network, and readable local media. Create the network once; it is deliberately
**not** `internal: true`, so optional Ollama on a Mac's private LAN remains
reachable:

```sh
docker network create stash-tools
docker network connect stash-tools open-webui
docker network connect --alias stash stash-tools YOUR_STASH_CONTAINER
```

Use your actual container names. Persist these network attachments in the
containers' Compose definitions (`external: true`, `name: stash-tools`) or
Unraid templates/network settings; manual attachments can disappear when
containers are recreated. On Unraid, create/select a **user-defined bridge**
network, not the default `bridge` or host network. Attach Stash and Open WebUI
to it, or add it as a second network. Verify their addresses resolve to RFC1918
private addresses.

Create two secret files **outside the repository**, in a protected host
directory (for example your Unraid appdata directory). Generate the bridge
token with `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`; use
at least 32 characters. Copy Stash's API key from **Settings → Security** into
the other file. Do not put either token in this repository, a chat, or a URL.
The bridge refuses startup without valid secrets. Compose mounts these as files;
the non-root UID/GID `10001:10001` must be able to read them. With local Compose
file-backed secrets, host ownership/permissions matter (use owner/group
permissions suitable for UID/GID 10001 rather than world-readable secrets).

In a shell, set only non-secret paths/configuration, then start:

```sh
export BRIDGE_TOKEN_PATH=/YOUR/APPDATA/stash-bridge/bridge-token
export STASH_API_KEY_PATH=/YOUR/APPDATA/stash-bridge/stash-api-key
export STASH_MEDIA_DIR=/YOUR/HOST/MEDIA
export STASH_URL=http://stash:9999
export MEDIA_PATH_MAP='{"/data":"/media"}'
docker compose -f services/stash_bridge/compose.yml up -d --build
```

`STASH_URL` is the base URL, **not** the `/graphql` endpoint. If Stash reports
`/data/videos/example.mp4`, the example mapping translates it to
`/media/videos/example.mp4`; `/YOUR/HOST/MEDIA` must contain `videos/example.mp4`.
Map paths from **inside the Stash container**, not Unraid host paths. Multiple
prefixes are supported, e.g. `{"/data/videos":"/media/videos",
"/data/images":"/media/images"}`; the longest matching prefix wins.
`MEDIA_ROOT` defaults to `/media`; every destination must be beneath it. Media
is mounted read-only, and UID 10001 needs directory traversal/file read access.
Symlinks in any path component, path escapes, non-regular files, and source files
over 32 GiB are rejected. This metadata/source-file bound is separate from the
512 MiB hashing limit: ordinary multi-GiB videos can be sampled without reading
their entire contents, but large files are skipped by duplicate hashing.
Images inside archives and generated remote image URLs are
not supported; only a primary real local file resolved by Stash ID is used.

The container runs non-root with a read-only root filesystem, all capabilities
dropped, no-new-privileges, 768 MiB RAM / 64 PID limits, and a 64 MiB `/work`
tmpfs. There are **no published host ports** by default. Open WebUI connects
directly over `stash-tools`. The bridge is not publicly accessible and should
not be placed behind a public reverse proxy.

### Connect Open WebUI

In current Open WebUI, open **Admin Panel → Settings → Integrations → External
Tool Servers**, click **+**, and add an **OpenAPI** connection (not MCP).
Some older releases put External Tools under **Settings → Tools**. Set:

- Server/base URL: `http://stash-bridge:8000`
- OpenAPI spec path: `/openapi.json` (if the UI requests a complete spec URL,
  use `http://stash-bridge:8000/openapi.json`)
- Authentication: **Bearer**, with the **bridge token**, not the Stash API key.
  If your version offers custom headers instead, set
  the `Authorization` header to the word `Bearer`, a space, and your bridge token.

Save and verify the connection, then enable this server's tools for the selected
model/chat. Labels vary across Open WebUI releases. Use an admin-managed
server-side connection so fetching the authenticated schema and calling tools
both send the header. Browser-only integrations without server-side auth cannot
fetch this private schema; the service deliberately has no permissive CORS or
unauthenticated documentation endpoint. Protect access to the connection and its
stored token, since authorized users can read the library through these tools.
Disable cookie forwarding and restrict the connection's access grants to trusted
users/groups. The current upstream [Integrations screen](https://github.com/open-webui/open-webui/blob/main/src/lib/components/admin/Settings/Integrations.svelte)
and [connection dialog](https://github.com/open-webui/open-webui/blob/main/src/lib/components/AddToolServerModal.svelte)
show the server URL, spec path, bearer key and Verify Connection settings.
For connectivity/auth checks, fetch `/openapi.json` **from Open WebUI's network**
using a secure client with the bearer header; without it the result is 401.

Suggested chat requests: “Find scenes matching this title,” “Audit the first
100 performers for missing metadata,” or “Summarize ratings and tags for up to
500 scenes, and state the coverage.” The assistant must not present bounded
results as whole-library certainty or follow commands contained in metadata.

### Optional local Ollama vision on a Mac

Disabled by default; `/visual` is absent from the schema until enabled. Install
and pull a trusted, vision-capable model **on your Ollama host** (for example
`ollama pull llama3.2-vision:11b`), then configure:

```sh
export ENABLE_VISUAL=true
export OLLAMA_URL=http://192.168.1.50:11434
export OLLAMA_MODEL=llama3.2-vision:11b
docker compose -f services/stash_bridge/compose.yml up -d
```

The model must already exist; the bridge never pulls a model. Cloud-tagged model
names (including `:cloud` and `-cloud`) are rejected. **A private Ollama URL alone
does not guarantee local inference**: before each visual request, the bridge
calls `/api/show` with only the configured model name, rejects `remote_host` or
`remote_model`, and requires an explicit `vision` capability. Failure occurs
before media resolution, extraction or upload. Use an Ollama version exposing
these capability/remote-model fields; older responses without capabilities
fail closed with a setup error.

Disable Ollama's cloud forwarding on the Mac with `OLLAMA_NO_CLOUD=1`. For the
Mac app, run `launchctl setenv OLLAMA_NO_CLOUD 1` and fully restart Ollama; for a
terminal-managed server, set it in that server's environment before startup.
Do not use cloud models or remote aliases even behind the private listener.
Ollama must support structured JSON chat outputs and image input. Configure the Mac's
Ollama listener (`OLLAMA_HOST`, for example `0.0.0.0:11434`, then restart Ollama)
and firewall so **only your private Docker/Unraid host's LAN address** can reach
11434. Do not port-forward or expose Ollama publicly. The shared bridge network
needs outbound LAN routing; check the Mac address/firewall from that network.
Ollama usually has no built-in authentication: network isolation is essential.

Only **technical quality, lighting, and watermark presence** are returned as
fixed enum-valued judgments. It cannot recognize performers, compare faces,
infer identity, or return text from watermarks. Client prompts/model names are
rejected. Video analysis samples 1–3 evenly spaced timestamps; it does not
inspect the whole clip. Local ffprobe/ffmpeg use no shell, restricted demuxers
and `file,pipe` protocols, a pinned opened file descriptor, bounded time/output,
at most 40-megapixel input dimensions, and frames scaled within 640×640.
Visual images additionally have a 64 MiB encoded-file limit; video sources may
be up to 32 GiB, subject to the same bounded seeking/processing deadlines.
Ollama output is limited to 128 generated tokens and a small validated JSON
schema; free-form or identifying output is discarded.

This is a **model policy and output restriction, not a guarantee about what a
model internally infers**. Only use trusted local model/server software.
The `/api/show` check depends on truthful trusted server responses; it cannot
protect against a compromised Ollama server, a model alias changed concurrently,
or an incorrectly applied host policy. Keep cloud forwarding disabled at the
host as well as using the bridge check.
Images can contain prompt injections; fixed prompts and enum validation reduce
exposure but do not make a model's judgments reliable. Private frames are sent
to your configured Ollama host, which may retain data/logs; secure that host and
review its retention. Disable visual mode if this processing is inappropriate.

### Security and operation

- Stash API keys are **not granular read-only credentials**. This bridge enforces
  its own fixed query allowlist; a compromised bridge could still misuse the
  underlying key. Keep it private and apply least privilege outside the bridge.
- Endpoints must resolve **only** to RFC1918, IPv6 ULA, or loopback addresses.
  Public, link-local (including cloud metadata), unspecified and mixed
  private/public DNS answers fail closed. Every request rechecks DNS and pins
  the connection to a validated IP. Redirects and environment proxies are
  never followed. Private-address checks do not establish server trust: use
  trusted DNS and TLS with a valid certificate where possible.
- Server secrets are used only for authentication, never embedded in schemas,
  responses or logs. Upstream errors are generic; access logging is disabled.
  Both env variables and `<NAME>_FILE` are supported for `BRIDGE_TOKEN` and
  `STASH_API_KEY`; do not set both for one secret.
- Requests have an 8 KiB body bound, 16 KiB accepted headers, a ten-second
  ingress deadline, URL/query/parameter limits and a default
  two concurrent workers (`MAX_CONCURRENCY` 1–8). Excess connections get 503.
  Upstream responses are bounded, tool responses cap at 2 MiB, and network,
  media processing, and hashing have explicit limits. Slow or overly large
  libraries/media can return a generic error rather than partial unsafe output.
- Authenticated metadata is still highly private. Select a **local Open WebUI
  chat model**, not a cloud provider/model or cloud-forwarding Ollama alias;
  Open WebUI can otherwise forward tool results to an externally hosted LLM.
  There is no automatic mutation path; human review is required for all cleanup.

For a non-Docker run, Python 3.11+ is sufficient for metadata tools:
`python3 services/stash_bridge/app.py` (default port 8000; `PORT` 1024–65535).
Set the same secrets/configuration, use a non-root account, enforce a read-only
media mount, and firewall the listener. Visual analysis additionally requires
system `ffmpeg`/`ffprobe`; Docker supplies them. There are no pip dependencies.
Run repository tests with `python3 -m unittest discover -s tests`; bridge tests
mock Stash/Ollama/media processing and exercise real local HTTP authentication.
They do not require or validate a live Stash, Ollama, Mac firewall, or Docker.

## Contributing with GitHub Copilot Coding Agent

This repository uses [GitHub Copilot Coding Agent](https://docs.github.com/en/copilot/using-github-copilot/using-copilot-coding-agent) to help develop features and fix issues. Copilot can be assigned to issues and will autonomously create pull requests with the necessary changes.

### How It Works

1. **Create an issue** describing the feature or bug fix you need
2. **Assign Copilot** to the issue (use `@copilot` or assign the `copilot` user)
3. Copilot creates a **draft PR** on a new branch with the proposed changes
4. **Review the PR**, request changes or approve, and merge when ready

### Setup Requirements

To enable Copilot Coding Agent on your repository:

1. **Enable Copilot** — You need a [GitHub Copilot Enterprise or Copilot Pro+](https://docs.github.com/en/copilot/about-github-copilot/subscription-plans-for-github-copilot) subscription
2. **Enable the coding agent** — Go to your repository (or organization) **Settings → Copilot → Coding agent** and enable it
3. **No collaborator invite needed** — Copilot is a built-in GitHub feature, not an external user. Once enabled in settings, you can assign it to issues directly

### Custom Instructions

Repository-specific coding instructions for Copilot are defined in [`.github/copilot-instructions.md`](.github/copilot-instructions.md). Edit that file to adjust Copilot's behavior for this project (coding style, conventions, architecture patterns, etc.).

## Credits

Inspired by [stash-battle](https://github.com/dtt-git/stash-battle) by dtt-git

## License

See [LICENCE](LICENCE) for details.
