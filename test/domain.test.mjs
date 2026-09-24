import test from 'node:test';
import assert from 'node:assert/strict';
import {
  number,
  epoch,
  normalizeWeather,
  normalizeMarine,
  atTime,
  tideAt,
  windWindows,
  validateState,
  distanceMiles,
  forecastTimeFor,
  observationSummary,
} from '../dist/domain.js';
test('missing readings remain unavailable, never zero', () => {
  for (const v of [null, undefined, '', 'bad']) assert.equal(number(v), null);
  assert.equal(number('0'), 0);
  const w = normalizeWeather({
    hourly: { time: [100], wind_speed_10m: [null], wind_gusts_10m: [null] },
  });
  assert.equal(w.hours[0].wind, null);
  assert.equal(w.hours[0].gust, null);
});
test('marine meters convert to feet while gaps remain gaps', () => {
  const m = normalizeMarine({
    hourly: {
      time: [0, 3600],
      wave_height: [1, null],
      swell_wave_height: [2, null],
      swell_wave_period: [12, null],
    },
  });
  assert.equal(m.hours[0].wave, 3.28084);
  assert.equal(m.hours[0].swell, 6.56168);
  assert.equal(m.hours[1].swell, null);
});
test('NOAA GMT times use explicit UTC, including around DST changes', () => {
  assert.equal(epoch('2026-11-01 09:00'), Date.parse('2026-11-01T09:00:00Z') / 1000);
});
test('tides interpolate only within supported six-minute coverage', () => {
  const r = [
    { time: 0, value: 1 },
    { time: 360, value: 2 },
    { time: 720, value: 3 },
  ];
  assert.equal(tideAt(r, 180).value, 1.5);
  assert.equal(tideAt(r, -1), null);
  assert.equal(tideAt(r, 800), null);
  assert.equal(
    tideAt(
      [
        { time: 0, value: 1 },
        { time: 5000, value: 5 },
      ],
      2000,
    ),
    null,
  );
});
test('nearest forecast refuses out-of-range hours', () => {
  assert.equal(atTime([{ time: 0, wind: 5 }], 3600), null);
  assert.equal(atTime([{ time: 0, wind: 5 }], 0).wind, 5);
});
test('wind windows need two contiguous daylight hours and acceptable gusts', () => {
  const row = (time, extra = {}) => ({ time, wind: 8, gust: 11, rain: 0, day: true, ...extra });
  const rows = [
    row(0),
    row(3600),
    row(7200, { gust: 17 }),
    row(10800),
    row(14400, { day: false }),
    row(18000, { wind: null }),
    row(21600),
    row(28800),
  ];
  const out = windWindows(rows, 10, 0);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { start: 0, end: 7200, wind: 8, gust: 11, rain: 0 });
  assert.equal(windWindows(rows, 10, 8000).length, 0);
});
test('valid records keep only expected fields; invalid locations and duplicates reject', () => {
  const input = {
    spots: [
      {
        id: 'pin-a',
        name: 'Test',
        lat: 37.8,
        lon: -122.4,
        notes: 'Note',
        referenceId: 'crissy',
        unexpected: 'remove',
      },
    ],
    entries: [],
    prefs: { windLimit: 10 },
  };
  assert.equal(validateState(input).spots[0].unexpected, undefined);
  assert.throws(() => validateState({ ...input, spots: [{ ...input.spots[0], lat: 0 }] }));
  assert.throws(() => validateState({ ...input, spots: [input.spots[0], input.spots[0]] }));
  assert.throws(() => validateState({ ...input, prefs: { windLimit: 99 } }));
});
test('distance is zero for identical coordinates', () => {
  assert.equal(distanceMiles({ lat: 37.8, lon: -122.4 }, { lat: 37.8, lon: -122.4 }), 0);
});

test('calendar-invalid trip dates reject without normalizing into another day', () => {
  assert.throws(() =>
    validateState({
      spots: [],
      entries: [{ id: 'bad-date', spot: 'Crissy', date: '2026-02-30', catch: '', notes: '' }],
      prefs: { windLimit: 10 },
    }),
  );
});
test('journal session time validation preserves old entries and rejects malformed times', () => {
  const old = validateState({
    spots: [],
    entries: [{ id: 'old', spot: 'Crissy', date: '2026-09-22', catch: '', notes: 'saved' }],
    prefs: { windLimit: 10 },
  });
  assert.equal(old.entries[0].time, '');
  assert.throws(() =>
    validateState({
      spots: [],
      entries: [
        { id: 'bad-time', spot: 'Crissy', date: '2026-09-22', time: '25:00', catch: '', notes: '' },
      ],
      prefs: { windLimit: 10 },
    }),
  );
});
test('forecast session matching stays on the requested Pacific date and coverage', () => {
  const rows = [Date.parse('2026-09-22T14:00:00Z'), Date.parse('2026-09-22T15:00:00Z')].map(
    (time) => ({ time: time / 1000 }),
  );
  assert.equal(forecastTimeFor(rows, '2026-09-22', '07:20'), rows[0].time);
  assert.equal(forecastTimeFor(rows, '2026-09-22', '09:00'), null);
  assert.equal(forecastTimeFor(rows, '2026-09-21', '07:00'), null);
});
test('structured observations are optional, validated, and summarized by location', () => {
  const base = {
      id: 'trip',
      spot: 'Crissy',
      date: '2026-09-22',
      time: '07:00',
      catch: 'follow',
      notes: 'saved',
    },
    input = {
      spots: [],
      entries: [
        {
          ...base,
          observations: {
            comfort: 'manageable',
            actualWind: '8',
            clarity: 'clear',
            bait: 'some',
            encounters: '2',
          },
        },
        { ...base, id: 'other', spot: 'Baker', observations: {} },
      ],
      prefs: { windLimit: 10 },
    },
    state = validateState(input);
  assert.deepEqual(state.entries[0].observations, {
    comfort: 'manageable',
    actualWind: 8,
    clarity: 'clear',
    bait: 'some',
    encounters: 2,
  });
  const summary = observationSummary(state.entries, 'Crissy');
  assert.equal(summary.trips, 1);
  assert.equal(summary.observed, 1);
  assert.equal(summary.averageWind, 8);
  assert.throws(() =>
    validateState({ ...input, entries: [{ ...base, observations: { comfort: 'perfect' } }] }),
  );
  assert.throws(() =>
    validateState({ ...input, entries: [{ ...base, observations: { encounters: 1.5 } }] }),
  );
});
