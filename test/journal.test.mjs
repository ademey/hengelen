import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function setup() {
  const fields = {
    '#trip-notes': { value: 'Black Sands forecast\n\nON THE WATER\nSaw bait near rocks.' },
    '#trip-spot': { value: 'Crissy' },
    '#trip-date': { value: '2026-09-22' },
    '#trip-time': { value: '07:00' },
    '#trip-dialog': { open: true },
  };
  const pending = new Map(),
    loaded = new Set(),
    requests = [];
  const context = vm.createContext({
    $: (s) => fields[s],
    spots: [
      { id: 'crissy', name: 'Crissy' },
      { id: 'coyote', name: 'Coyote' },
    ],
    tripSnapshotPrefix: 'Black Sands forecast\n\n',
    tripDraftVersion: 0,
    editingTrip: null,
    tripForecastNote: (s, date, time) => {
      requests.push({ spot: s.id, date, time });
      return `${s.name}${loaded.has(s.id) ? ' loaded' : ''} forecast\n\nON THE WATER\n`;
    },
    loadDetails: (id) =>
      new Promise((resolve) =>
        pending.set(id, () => {
          loaded.add(id);
          resolve();
        }),
      ),
  });
  vm.runInContext(
    app.slice(app.indexOf('function forecastPrefix('), app.indexOf("$('#new-entry').onclick")),
    context,
  );
  return { fields, pending, requests, context };
}
test('changing a new trip location replaces the forecast and preserves typed observations', async () => {
  const { fields, pending } = setup();
  const done = fields['#trip-spot'].onchange();
  assert.equal(
    fields['#trip-notes'].value,
    'Crissy forecast\n\nON THE WATER\nSaw bait near rocks.',
  );
  fields['#trip-notes'].value += ' More observations.';
  pending.get('crissy')();
  await done;
  assert.equal(
    fields['#trip-notes'].value,
    'Crissy loaded forecast\n\nON THE WATER\nSaw bait near rocks. More observations.',
  );
});
test('late location responses do not replace the current draft', async () => {
  const { fields, pending } = setup();
  const first = fields['#trip-spot'].onchange();
  fields['#trip-spot'].value = 'Coyote';
  const second = fields['#trip-spot'].onchange();
  pending.get('coyote')();
  await second;
  pending.get('crissy')();
  await first;
  assert.match(fields['#trip-notes'].value, /^Coyote loaded forecast/);
});
test('changing the session date or time refreshes context and preserves observations', async () => {
  const { fields, pending, requests } = setup();
  fields['#trip-date'].value = '2026-09-24';
  fields['#trip-time'].value = '16:30';
  const done = fields['#trip-time'].onchange();
  assert.equal(
    fields['#trip-notes'].value,
    'Crissy forecast\n\nON THE WATER\nSaw bait near rocks.',
  );
  pending.get('crissy')();
  await done;
  assert.deepEqual(requests.at(-1), { spot: 'crissy', date: '2026-09-24', time: '16:30' });
  assert.match(fields['#trip-notes'].value, /Saw bait near rocks/);
});
test('saved journal notes and manually rewritten snapshot text are preserved', async () => {
  const { fields, pending, context } = setup();
  context.editingTrip = 'saved';
  const before = fields['#trip-notes'].value;
  await fields['#trip-spot'].onchange();
  assert.equal(fields['#trip-notes'].value, before);
  assert.equal(pending.size, 0);
  context.editingTrip = null;
  fields['#trip-notes'].value = 'My own notes';
  const done = fields['#trip-spot'].onchange();
  pending.get('crissy')();
  await done;
  assert.equal(fields['#trip-notes'].value, 'My own notes');
});
