import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTideAt, estimatedTideRows, displayTideAt } from '../src/domain.js';
import { conditionsTimeline } from '../src/timeline.js';
const events = [
  { time: -3600, type: 'L', value: 1 },
  { time: 18000, type: 'H', value: 7 },
  { time: 39600, type: 'L', value: 2 },
];
test('estimate hits NOAA extrema, stays bounded, and follows rise/fall', () => {
  assert.equal(estimateTideAt(events, -3600).value, 1);
  assert.equal(estimateTideAt(events, 18000).value, 7);
  assert.equal(estimateTideAt(events, 39600).value, 2);
  assert.ok(Math.abs(estimateTideAt(events, 7200).value - 4) < 1e-10);
  for (let t = -3600; t <= 39600; t += 60) {
    const r = estimateTideAt(events, t);
    assert.ok(r.estimated && r.value >= 1 && r.value <= 7);
  }
  assert.equal(estimateTideAt(events, 0).rising, true);
  assert.equal(estimateTideAt(events, 20000).rising, false);
});
test('estimate never extrapolates or bridges malformed/missing extrema', () => {
  assert.equal(estimateTideAt(events, -3601), null);
  assert.equal(estimateTideAt(events, 39601), null);
  assert.equal(estimateTideAt([events[0], events[2]], 1000), null);
  assert.equal(estimateTideAt([{ ...events[0], value: null }, events[1]], 1000), null);
  assert.equal(estimateTideAt([events[0], { ...events[1], time: 100000 }], 1000), null);
  const rows = estimatedTideRows(events, 0, 43200);
  assert.ok(rows.find((r) => r.time === 18000 && r.value === 7));
  assert.equal(rows.at(-1).value, null);
});
test('estimated chart and scrubbed height agree and full predictions remain unchanged', () => {
  const detail = { tides: { status: 'events-only' }, highLow: { value: events } };
  assert.deepEqual(displayTideAt(detail, 7200), estimateTideAt(events, 7200));
  assert.equal(
    displayTideAt({ tides: { status: 'unavailable' }, highLow: { value: events } }, 7200),
    null,
  );
  const hours = Array.from({ length: 24 }, (_, i) => ({ time: i * 3600, wind: 4, gust: 6 }));
  const html = conditionsTimeline({
    hours,
    highLow: events,
    tideStatus: 'events-only',
    highLowStatus: 'stale',
    selected: 7200,
    limit: 10,
    width: 700,
  });
  assert.match(html, /estimated-tide-line/);
  assert.match(html, /tide-event-dot/);
  assert.match(html, /ESTIMATED · CACHED/);
  assert.ok(!html.includes('NaN'));
  const full = conditionsTimeline({
    hours,
    tides: [
      { time: 0, value: 2 },
      { time: 360, value: 3 },
    ],
    selected: 0,
    limit: 10,
    width: 700,
  });
  assert.ok(!full.includes('estimated-tide-line'));
});
