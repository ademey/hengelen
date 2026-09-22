# Hengelen project workflow

This is a local-only web app. Preserve the khaki/black atlas design and the user's personal data in `data/`.

## Task tracking

Use GitHub Issues in `ademey/hengelen` as the task backlog. Before starting a substantive change, look for a matching issue; create one for new requested work if none exists. Keep scope, decisions, and validation in the relevant issue. Reference its number in the implementation commit or PR, and close it when the change is delivered. Do not create issues for ordinary questions or duplicate existing tasks.

Use `codex/` prefixes for new working branches. Never commit personal journal/pin data, forecast caches, environment secrets, or logs. Publishing further changes still follows the user's instructions for the task.

## Validation

Run `npm run check` and `npm test` for behavioral changes. Use focused regression coverage for data integrity, forecasting semantics, and navigation. Clearly distinguish observations, NOAA predictions, and app-generated estimates.
