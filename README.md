# Hengelen
A local shore-fishing field atlas for San Francisco Bay and the coast from Stinson Beach to Half Moon Bay.

Run `npm run dev`, then open http://127.0.0.1:4317 . Requires Node 22+ and internet for new forecasts. There are no package dependencies, API keys, or hosted services to configure. The server binds to loopback only.

## Conditions
- Open-Meteo: seven-day hourly wind, gusts, wind direction, rain chance, air temperature, sunrise/sunset and daylight; knots and °F. Forecast grid coordinates are disclosed. Open-Meteo free access is for personal/noncommercial use; data attribution CC BY 4.0.
- NOAA CO-OPS: predictions in feet MLLW, six-minute tide curves at harmonic stations, separate high/low events, and regional current max/slack events. Subordinate stations show events only. Stinson uses the Ocean Beach outer-coast reference, not Bolinas Lagoon. No artificial curves or tide-to-current inferences.
- NOAA Torpedo Wharf: recent wind, water level, and temperature where available. All are explicitly regional observations with their own timestamps. Missing sensors stay unavailable.
- Open-Meteo Marine / DWD: offshore waves and swell for ocean-facing pins, converted from meters to feet. Not beach breaker heights or a bay surf model.
- NWS: active point alerts. Retrieval failure is distinct from an empty alert list. Alerts are current, not a promise about a future date.

Source failures never substitute sample data. Cache records retain retrieval timestamps and are marked stale when refresh fails. Weather is cached for 30 minutes, marine for one hour, tide/current predictions for six hours, observations for five minutes, alerts for ten minutes. A manual Refresh checks these caches; it does not bypass provider-friendly cache intervals. Local files in data/cache let the server retain the last successful result across restarts.

## Guidance
Wind windows require at least two consecutive daylight hours, forecast wind at/below the user limit, and gusts no more than three knots above it. They are casting-comfort windows, not fish-activity scores or wading clearance. Tide/current timing remains contextual. Shore-facing bearings are approximate and casting guidance is explicitly conditional on the actual direction cast.

Access notes link to official NPS, State Parks and EBRPD sources, reviewed 2026-09-21. The East Bay exploratory locations are labeled Scout first where the source does not establish a shore fly-casting entry. Check the linked sources for changing closures, rules and water-quality conditions.

## Local records
Pins, notes, trip journal and wind preference are stored in data/state.json. Writes are atomic, with the previous revision in data/state.json.bak. Concurrent window conflicts reject the save rather than overwrite changes. The journal Export link downloads a JSON backup. Old browser-only prototype records are imported once into an empty local store; the browser originals are left intact. Keep using the same localhost origin to reach those prototype records during migration.

Custom pins choose a tide/current reference area and bay/ocean exposure. Weather uses the pin coordinates. Saved data is not uploaded; forecasting requests send location coordinates to weather services. The atlas limits pins to its regional bounds.

## Map
Natural Earth 1:10m land (public domain). Terrain: Mapzen Terrain Tiles on AWS, USGS 3DEP, accessed 2026-09-21; resampled and generalized into 50 m contours (100 m overview). Roads/bridges © OpenStreetMap contributors, ODbL. Sources: https://registry.opendata.aws/terrain-tiles/ , https://github.com/tilezen/joerd/blob/master/docs/attribution.md , https://www.openstreetmap.org/copyright . Shoreline bands are decorative, not bathymetry. Orientation labels and geometry are generalized; this is not a navigation chart.

Visual inspiration: inkboard/system-atlas (MIT), adapted to a geographical atlas. Plex fonts copied from the local Kritiek reference project. Drag or arrow keys on the focused map to pan; zoom reveals finer contours; Refit resets.

## Verification
`npm run check` checks JS syntax. `npm test` checks unit conversions, missing-data behavior, tide interpolation boundaries, wind-window criteria, and state validation. API smoke checks cover forecast sources and local storage persistence/error handling.

### Session planning

The central timeline aligns tide height (feet MLLW), wind/gusts (knots), and discrete reference current events on the same Pacific time axis. Night and candidate sessions are shaded. Events-only tide references display a dashed half-cosine estimate between valid alternating NOAA high/low predictions. Dots show the NOAA events; interpolated heights are explicitly approximate. No extrapolation or bridging missing events is performed. Session ranking still treats these stations as lacking a full NOAA curve.

Sessions are two complete daylight hours within the wind/gust preferences. Explicit starting heuristics favor proximity to sunrise/sunset, changing tide height in either direction, smaller offshore swell, and casting direction. Current events are explanatory context, not a proxy for current speed at the shore. Missing/stale references make a session provisional; fresh weather is required. Suggestions are ranked within the selected day and do not overlap. These preferences are not calibrated catch predictions or safety ratings.

“Compare spots at this time” loads detailed references with three concurrent requests and compares the same two-hour interval. New journal entries include an explicit session date and time, a clearly labeled matching forecast snapshot, free-text notes, and optional structured observations for casting comfort, actual wind, water clarity, bait activity, and fish encounters. Dates outside forecast coverage are recorded as unavailable instead of borrowing unrelated conditions. Location pages show recent comparable trips and sample counts. Existing entries are preserved, and journal observations do not change the ranking.

### Navigation and task tracking

The home page is an atlas overview. Selecting a map marker or sidebar location opens a dedicated page (`#spot/<id>`) with a mini-map, conditions timeline, session suggestions, and shore notes. The location selector and browser back button support navigation; returning to the atlas restores its map position.

Track work in [GitHub Issues](https://github.com/ademey/hengelen/issues). Link substantive changes to an issue, record validation, and close completed tasks when delivered. See `AGENTS.md` for the project workflow.
