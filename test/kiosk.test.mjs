import test from 'node:test';
import assert from 'node:assert/strict';
import { SCRUB_THRESHOLD_PX, kioskEnabled, kioskHomeHref, scrubEngaged } from '../src/kiosk.js';

test('kiosk mode enables only on ?kiosk=1', () => {
  assert.equal(kioskEnabled('?kiosk=1'), true);
  assert.equal(kioskEnabled('?foo=1&kiosk=1'), true);
  for (const s of ['', '?kiosk=0', '?kiosk=', '?kiosk=2', '?KIOSK=1']) {
    assert.equal(kioskEnabled(s), false);
  }
});

test('kiosk home link preserves the kiosk parameter', () => {
  assert.equal(kioskHomeHref(), '/?kiosk=1');
});

test('scrub engages only after enough horizontal travel', () => {
  assert.equal(scrubEngaged(100, 100 + SCRUB_THRESHOLD_PX - 1), false);
  assert.equal(scrubEngaged(100, 100 + SCRUB_THRESHOLD_PX), true);
  // Dragging left scrubs too.
  assert.equal(scrubEngaged(100, 100 - SCRUB_THRESHOLD_PX - 5), true);
});

test('vertical-only movement never engages scrubbing', () => {
  // A swipe straight down keeps the same x: the page must scroll, not scrub.
  assert.equal(scrubEngaged(100, 100), false);
  assert.equal(scrubEngaged(100, 104), false);
});

test('a tap (down and up with no travel) never engages scrubbing', () => {
  assert.equal(scrubEngaged(250, 250), false);
});
