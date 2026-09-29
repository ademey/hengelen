// Kiosk mode for the 1024x600 Raspberry Pi touchscreen (?kiosk=1).
// Pure helpers kept separate from app.js so the gesture and navigation
// decisions have regression coverage in test/kiosk.test.mjs.

// Pixels of horizontal pointer travel before a chart touch becomes a scrub.
// Below this, the gesture is a tap (handled by the chart's click handler) or
// the start of a vertical page scroll.
export const SCRUB_THRESHOLD_PX = 10;

export function kioskEnabled(search) {
  return new URLSearchParams(search).get('kiosk') === '1';
}

// Home link target while kiosk mode is on: keep ?kiosk=1 so tapping the
// brand doesn't silently exit the touchscreen layout.
export function kioskHomeHref() {
  return '/?kiosk=1';
}

// True once the pointer has moved far enough horizontally from its
// down-position to count as a scrub. Vertical-only movement never engages,
// so a swipe that starts on the chart still scrolls the page.
export function scrubEngaged(startX, x, threshold = SCRUB_THRESHOLD_PX) {
  return Math.abs(x - startX) >= threshold;
}
