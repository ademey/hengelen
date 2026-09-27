# Public hosting architecture and rollout

Status: proposal only. This document does not authorize or provision a deployment.

## Decision

Publish the forecast atlas as a static site backed by a small edge API. Exclude journals, custom pins, accounts, and backup/import from the first public release. Keep small preferences such as the wind-comfort limit in browser `localStorage`. Continue shipping the current loopback Node application and its personal features for local use.

The recommended first host is Cloudflare Pages plus a Worker:

- Pages serves the existing HTML, CSS, fonts, and map data.
- The Worker exposes read-only forecast endpoints, validates every parameter, combines provider responses, and applies shared caching and request limits.
- The browser stores only small preferences in `localStorage`; there is no public personal-record store.
- The public Worker has no journal, state, pin, import, or export endpoint and no database containing personal fishing locations.

This keeps the initial public system small and prevents the current `data/state.json` from becoming shared web state. It also avoids adding accounts before there is a clear need for cross-device sync. A later sync feature would require authentication, per-user authorization, encryption and retention decisions, and a separate threat review.

## Product boundary

| Capability | Local application | Public application |
| --- | --- | --- |
| Preset atlas and forecast browsing | Current Node server | Static site plus read-only edge API |
| Journal | `data/state.json` with backup | Excluded |
| Preferences | `data/state.json` with backup | Browser `localStorage` |
| Custom pins | Local state; server resolves forecast | Excluded |
| Backup | `/api/export` downloads local state | Excluded |
| Accounts and cross-device sync | None | None in the first release |

The repository should expose a forecast interface so both runtimes use the same UI and domain logic:

```text
UI and domain logic
├── Forecast source
│   ├── Local HTTP adapter → current Node server
│   └── Public HTTP adapter → read-only Worker
└── Preferences
    ├── Local HTTP adapter → state.json
    └── Public browser adapter → localStorage
```

The public build must never contain a fallback URL for `/api/state` or `/api/export`. Deploy validation should fail if either route is present in the Worker route table.

## Public API shape

Start with two GET endpoints for preset locations:

- `GET /api/overview` returns the batched regional weather forecast.
- `GET /api/spot/:presetId` returns tides, current events, marine forecast, observations, and active alerts for one allowlisted preset.

Both responses should keep the current resource envelope: `status`, `value`, `fetchedAt`, and optional `error`. Do not replace missing data with zeros or sample records. Add explicit schema versions and return only fields the UI consumes.

The Worker should:

- allow only known preset IDs; do not accept arbitrary upstream URLs, station IDs, or date ranges;
- cap URL and response sizes, reject non-GET methods, and set short execution timeouts;
- cache successful upstream results by normalized request key and coalesce concurrent misses;
- serve a last successful result as `stale` when a provider is unavailable;
- apply per-IP and global request limits, with a stricter limit for cache misses;
- return `429` with `Retry-After` instead of continuing upstream calls;
- strip request headers before upstream calls and use a named application User-Agent with a monitored contact address where required;
- log counts, latency, cache status, provider status, and coarse route names without query coordinates or client identifiers.

The initial public release should not support custom-coordinate forecasts. When that work is scheduled, round coordinates to a documented grid, constrain them to the atlas bounds, cache by the rounded grid, rate-limit aggressively, and disclose that the coordinate is sent to forecast providers. Do not place a custom pin in URLs, analytics, or logs.

## Caching and provider review

Retain the current starting TTLs: weather 30 minutes, marine one hour, tides and currents six hours, observations five minutes, and alerts ten minutes. Add stale-if-error windows and bounded cache retention. The browser may cache responses briefly for navigation, but the Worker remains the source of provider-friendly request consolidation.

Before preview traffic is invited, record the expected daily upstream calls at 1, 10, 100, and 1,000 active users and verify the chosen tier against current terms:

- [Open-Meteo terms](https://open-meteo.com/en/terms) currently limit the free API to non-commercial use and publish minute, hourly, and daily call limits. A site with advertising, subscriptions, sponsorship, or other commercial use needs a commercial plan or a different compliant source. Attribution remains required.
- [Open-Meteo pricing](https://open-meteo.com/en/pricing) describes the customer endpoint, API key, volume, and service targets. Keep its key only in Worker secrets.
- [NWS API documentation](https://www.weather.gov/documentation/services-web-api) requires an identifying User-Agent and applies reasonable, unpublished rate limits. Its guidance notes that proxies are more likely to reach those limits, so alert caching and backoff are required.
- [NOAA CO-OPS API documentation](https://api.tidesandcurrents.noaa.gov/api/dev) documents request-length limits and throttling under load. Request only the displayed range and reuse station responses across nearby spots.

Recheck these pages immediately before launch and record the date and result in the release issue. Attribution in the UI must name Open-Meteo and its underlying marine data source, NOAA CO-OPS, NWS, Natural Earth, USGS/Mapzen, and OpenStreetMap as applicable.

## Privacy and local migration

The first public version needs a short privacy page that says:

- wind comfort and other small preferences remain in this browser and are not synced;
- clearing site data resets those preferences;
- forecast requests reveal the selected preset region to the hosting provider and upstream data providers;
- no advertising or behavioral analytics are enabled for the initial release;
- operational logs exclude journals, custom pin coordinates, request query strings, and response bodies;
- forecasts, tide estimates, current references, and session suggestions are planning aids rather than safety or catch predictions.

The public edition does not import local journals or custom pins. Local backups remain usable only by the local edition unless a later product decision adds a reviewed migration path.

## Security and operations

Before public preview:

1. Remove public write routes and verify a request cannot reach filesystem code.
2. Add a strict Content Security Policy, frame protection, MIME sniffing protection, a conservative referrer policy, and permissions policy.
3. Lock CORS to the production and preview origins. Reject unrecognized hosts and methods.
4. Store provider keys only as deployment secrets. Scan built assets and source maps for secrets in CI.
5. Configure edge request limits, upstream timeouts, exponential backoff, and a global kill switch for each provider.
6. Add error-budget alerts for elevated `unavailable`, `stale`, `429`, and `5xx` rates. Do not alert on individual user activity.
7. Pin deployment tooling, require reviewed pull requests, and keep an immediate rollback to the previous static and Worker versions.

The current Node server remains bound to loopback. Do not expose it directly to the internet: its host/origin checks, shared filesystem state, and process-local write queue were designed for one local user.

## Preview validation

Use a private preview URL before production. Record results for:

- atlas selection, marker preview, detail navigation, browser back, and restored map position;
- all preset locations with fresh, stale, unavailable, events-only, and not-applicable resources;
- keyboard-only navigation, visible focus, dialog focus behavior, headings, labels, and chart text alternatives;
- screen-reader announcements for changing location and forecast status;
- laptop and large desktop viewports, then phone widths at 320, 375, and 430 CSS pixels;
- English and non-English browser preferences, confirming the Dutch name remains `lang="nl"` and `translate="no"` while the document stays English;
- localStorage failure, private browsing behavior, and clearing site data;
- cache-hit load, cold-cache load, rate limiting, provider timeouts, stale fallback, and rollback;
- the absence of `/api/state`, `/api/export`, journal content, pins, and provider secrets in public responses and logs.

Do not describe mobile as supported until the phone checks pass. Until then, label the preview as desktop-first.

## Rollout

1. **Adapter refactor:** isolate the forecast interface and public preference storage without changing the local UI. Add contract tests for both forecast adapters.
2. **Read-only preview:** deploy static assets and preset-only forecast endpoints behind preview access. Enable only browser-local preferences.
3. **Public launch:** remove preview access after provider terms, budgets, accessibility, mobile scope, monitoring, and rollback are signed off in a release issue.
4. **Post-launch review:** inspect aggregate provider and error metrics after 24 hours, seven days, and 30 days. Reduce traffic or disable a provider when limits or terms require it.

Success for the first release means forecast browsing works without access to anyone's personal records, the local application and backups continue to work, provider usage stays within an explicitly approved tier, and every unavailable or estimated condition remains clear to the user.
