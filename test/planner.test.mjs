import test from 'node:test';
import assert from 'node:assert/strict';
import { fishingWindows, distinctWindows } from '../src/planner.js';
import { conditionsTimeline } from '../src/timeline.js';
const weather = {
  hours: Array.from({ length: 12 }, (_, i) => ({
    time: i * 3600,
    day: true,
    wind: 5,
    gust: 7,
    direction: 270,
  })),
  days: [{ sunrise: 0, sunset: 43200 }],
};
const detail = {
  tides: {
    status: 'ok',
    value: Array.from({ length: 121 }, (_, i) => ({ time: i * 360, value: i / 20 })),
  },
  highLow: { status: 'ok', value: [] },
  currents: {
    status: 'ok',
    value: [
      { time: 0, type: 'slack' },
      { time: 43200, type: 'slack' },
    ],
  },
  alerts: { status: 'ok', value: [] },
};
const input = {
  weather,
  detail,
  spot: { exposure: 'Bay shoreline', bearing: 0 },
  limit: 10,
  now: 0,
};
test('sessions cover two complete daylight hours and respect missing/gapped forecasts', () => {
  const windows = fishingWindows(input);
  assert.ok(windows.length);
  assert.ok(windows.every((w) => w.end <= 43200 && w.end - w.start === 7200));
  assert.equal(fishingWindows({ ...input, weatherStatus: 'stale' }).length, 0);
  assert.equal(
    fishingWindows({
      ...input,
      weather: { ...weather, hours: [weather.hours[0], weather.hours[2]] },
    }).length,
    0,
  );
  assert.equal(
    fishingWindows({
      ...input,
      weather: { ...weather, hours: weather.hours.map((r) => ({ ...r, gust: null })) },
    }).length,
    0,
  );
  assert.equal(
    fishingWindows({ ...input, weather: { ...weather, days: [{ sunrise: 0, sunset: 3500 }] } })
      .length,
    0,
  );
});
test('missing references are provisional and stale tide is not used for ranking', () => {
  const missing = fishingWindows({ ...input, detail: undefined });
  assert.ok(missing.every((w) => w.provisional && w.missing.length));
  const stale = fishingWindows({
    ...input,
    detail: { ...detail, tides: { ...detail.tides, status: 'stale' } },
  });
  assert.ok(stale.every((w) => !w.reasons.some((r) => r.startsWith('Tide '))));
  const good = fishingWindows(input);
  assert.ok(good.every((w) => !w.provisional));
  assert.ok(good[0].lowLight);
});
test('suggestions do not overlap and ocean swell gaps remain explicit', () => {
  const windows = distinctWindows(fishingWindows(input));
  assert.equal(windows.length, 3);
  for (let i = 0; i < windows.length; i++)
    for (let j = i + 1; j < windows.length; j++)
      assert.ok(windows[i].end <= windows[j].start || windows[i].start >= windows[j].end);
  const coast = fishingWindows({ ...input, spot: { exposure: 'Open coast', bearing: 0 } });
  assert.ok(coast.every((w) => w.missing.includes('Fresh offshore swell unavailable')));
});
test('session ranking does not assume casting handedness or shore orientation', () => {
  const north = fishingWindows({ ...input, spot: { ...input.spot, bearing: 0 } });
  const south = fishingWindows({ ...input, spot: { ...input.spot, bearing: 180 } });
  assert.deepEqual(north, south);
  assert.ok(
    north.every(
      (w) =>
        ![...w.reasons, ...w.cautions, ...w.missing].some((line) =>
          /casting-arm|wind from your left|headwind|following wind/i.test(line),
        ),
    ),
  );
});
test('tide and wind share time coordinates and events-only tide without events stays unavailable', () => {
  const html = conditionsTimeline({
    hours: weather.hours,
    tides: detail.tides.value,
    currents: [
      { time: 3600, type: 'flood', speed: 1.2 },
      { time: 7200, type: 'slack', speed: 0 },
    ],
    currentStation: 'Golden Gate Bridge',
    selected: 3600,
    limit: 10,
    width: 800,
    sun: weather.days,
  });
  assert.match(html, /TIDE · FT/);
  assert.match(html, /WIND · KN/);
  assert.match(html, /Current markers: Golden Gate Bridge/);
  assert.match(html, /data-current-event="MAX FLOOD" data-tide-height="0.50"/);
  assert.match(html, /data-current-event="SLACK" data-tide-height="1.00"/);
  assert.doesNotMatch(html, /CURRENT EVENTS · REFERENCE STATION/);
  assert.ok(!html.includes('NaN'));
  const noCurve = conditionsTimeline({
    hours: weather.hours,
    tideStatus: 'events-only',
    selected: 0,
    limit: 10,
    width: 400,
    sun: weather.days,
  });
  assert.ok(!noCurve.includes('class="tide-line"'));
  assert.match(noCurve, /Not enough high\/low data/);
});
test('current events without supported tide data do not receive invented vertical positions', () => {
  const html = conditionsTimeline({
    hours: weather.hours,
    currents: [{ time: 3600, type: 'ebb', speed: -1.4 }],
    currentStation: 'Reference',
    selected: 0,
    limit: 10,
    width: 500,
    sun: weather.days,
  });
  assert.doesNotMatch(html, /data-current-event=/);
  assert.match(html, /tide height unavailable for overlay/);
});
