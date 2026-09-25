import { estimatedTideRows, tideAt } from './domain.js';
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const clock = (t) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(t * 1000));
export function conditionsTimeline({
  hours,
  tides = [],
  highLow = [],
  currents = [],
  sun = [],
  windows = [],
  selected,
  limit,
  width = 700,
  tideStatus,
  highLowStatus,
  currentStatus,
  weatherStatus,
  currentStation,
}) {
  if (!hours.length)
    return '<p class="empty-chart">Waiting for the hourly forecast to set the day’s timeline.</p>';
  const start = hours[0].time,
    end = hours.at(-1).time + 3600,
    H = 380,
    L = 44,
    R = width - 12,
    x = (t) => L + ((t - start) / (end - start)) * (R - L);
  const inDay = (r) => r.time >= start && r.time < end;
  const estimated = tideStatus === 'events-only';
  const tideRows = estimated ? estimatedTideRows(highLow, start, end) : tides.filter(inDay),
    events = highLow.filter(inDay).filter((e) => Number.isFinite(e.value)),
    current = currents.filter(inDay);
  const finite = tideRows.filter((r) => Number.isFinite(r.value)),
    range = [...finite, ...events],
    lo = range.length ? Math.floor(Math.min(...range.map((r) => r.value))) - 1 : 0,
    hi = range.length ? Math.ceil(Math.max(...range.map((r) => r.value))) + 1 : 6;
  const currentOnTide = current
    .map((event) => ({ event, tide: tideAt(tideRows, event.time) }))
    .filter((row) => row.tide);
  const currentName = currentStation || 'reference station';
  const currentLabel = (type) => {
    const value = String(type ?? '').toLowerCase();
    return value.includes('flood') ? 'MAX FLOOD' : value.includes('ebb') ? 'MAX EBB' : 'SLACK';
  };
  const currentMarker = (row, i) => {
    const { event, tide } = row,
      cx = x(event.time),
      cy = ty(tide.value),
      label = currentLabel(event.type),
      speed =
        Number.isFinite(event.speed) && label !== 'SLACK'
          ? ` ${Math.abs(event.speed).toFixed(1)} kn`
          : '';
    const labelY = Math.max(45, Math.min(188, cy + (i % 2 ? -13 : 17)));
    const anchor = cx > R - 85 ? 'end' : 'start',
      textX = cx + (anchor === 'end' ? -7 : 7);
    const symbol =
      label === 'MAX FLOOD'
        ? `<path d="M${cx - 4} ${cy + 3}l4 -7 4 7Z" class="current-event-symbol"/>`
        : label === 'MAX EBB'
          ? `<path d="M${cx - 4} ${cy - 3}l4 7 4 -7Z" class="current-event-symbol"/>`
          : `<rect x="${cx - 3.5}" y="${cy - 3.5}" width="7" height="7" class="current-event-symbol slack"/>`;
    return `<g data-current-event="${esc(label)}" data-tide-height="${tide.value.toFixed(2)}">${symbol}<path d="M${cx} ${cy}V${labelY + (labelY < cy ? 4 : -8)}" class="current-event-leader"/><text x="${textX}" y="${labelY}" text-anchor="${anchor}" class="current-event-label">${label}${speed}<title>${clock(event.time)} · ${label}${speed ? ` · ${speed.trim()}` : ''} at ${currentName}; marker height is tide ${tide.value.toFixed(1)} ft MLLW, not current speed</title></text></g>`;
  };
  const maxWind =
    Math.max(limit + 3, ...hours.flatMap((r) => [r.wind, r.gust]).filter(Number.isFinite)) + 2;
  const ty = (v) => 194 - ((v - lo) / (hi - lo)) * 140,
    wy = (v) => 330 - (v / maxWind) * 82;
  const path = (rows, key, y, gap) => {
    let previous = null;
    return rows
      .map((r) => {
        if (!Number.isFinite(r[key])) {
          previous = null;
          return '';
        }
        const cmd = previous && r.time - previous.time <= gap ? 'L' : 'M';
        previous = r;
        return `${cmd}${x(r.time).toFixed(1)},${y(r[key]).toFixed(1)}`;
      })
      .join(' ');
  };
  const grids = (values, y) =>
    values
      .map(
        (v) =>
          `<path d="M${L} ${y(v)}H${R}" class="timeline-grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(Number.isInteger(v) ? 0 : 1)}</text>`,
      )
      .join('');
  const daylight = sun
    .filter((d) => d.sunset > start && d.sunrise < end)
    .map((d) => [Math.max(start, d.sunrise), Math.min(end, d.sunset)])
    .sort((a, b) => a[0] - b[0]);
  let cursor = start,
    night = '';
  for (const [a, b] of [...daylight, [end, end]]) {
    if (a > cursor)
      night += `<rect x="${x(cursor)}" y="35" width="${x(a) - x(cursor)}" height="305" class="night-band"/>`;
    cursor = b;
  }
  const bands = windows
    .filter((w) => w.start < end && w.end > start)
    .map(
      (w) =>
        `<rect x="${x(Math.max(start, w.start))}" y="35" width="${x(Math.min(end, w.end)) - x(Math.max(start, w.start))}" height="305" class="window-band ${w.provisional ? 'provisional' : ''}"><title>${w.provisional ? 'Provisional session' : 'Suggested session'} · ${clock(w.start)}–${clock(w.end)}</title></rect>`,
    )
    .join('');
  const ticks = hours.filter((r, i) => i % 6 === 0).map((r) => r.time);
  ticks.push(end);
  return `${estimated ? '<p class="estimated-tide-caption">Dashed curve: estimated between NOAA high/low predictions (dots). Heights between dots are approximate.</p>' : ''}${current.length ? `<p class="current-overlay-caption">Current markers: ${esc(currentName)}. Marker height follows the tide curve; current speed is written beside flood and ebb events.</p>` : ''}<svg viewBox="0 0 ${width} ${H}" class="conditions-chart-svg" role="img" aria-label="${estimated ? 'Estimated tide curve between NOAA high and low predictions. ' : ''}Tide height in feet with reference current events placed at the tide height for their time, plus wind and gusts in knots. Current marker height does not represent current speed. Shaded bands mark night and suggested sessions.">${night}${bands}
 <text x="${L}" y="20" class="track-title">TIDE · FT / MLLW${estimated ? ' · ESTIMATED' : ''}${tideStatus === 'stale' || (estimated && highLowStatus === 'stale') ? ' · CACHED' : ''}</text>${grids([lo, (lo + hi) / 2, hi], ty)}
 ${finite.length ? `<path d="${path(tideRows, 'value', ty, 900)}" class="tide-line${estimated ? ' estimated-tide-line' : ''}"/>` : `<text x="${L + 8}" y="125">${tideStatus === 'events-only' ? 'Not enough high/low data to estimate' : 'Tide curve unavailable'}</text>`}
 ${currentOnTide.map(currentMarker).join('')}
 ${events.map((e) => `<g><circle cx="${x(e.time)}" cy="${ty(e.value)}" r="3.5" class="tide-event-dot"><title>NOAA ${e.type === 'H' ? 'high' : 'low'} prediction · ${clock(e.time)} · ${e.value.toFixed(1)} ft</title></circle><path d="M${x(e.time)} 199v6" class="event-tick"/><text x="${x(e.time)}" y="218" text-anchor="${x(e.time) < L + 45 ? 'start' : x(e.time) > R - 45 ? 'end' : 'middle'}">${e.type === 'H' ? 'H' : 'L'} ${Number(e.value).toFixed(1)}′<title>${clock(e.time)} · ${e.type === 'H' ? 'High' : 'Low'} tide</title></text></g>`).join('')}
 <text x="${L}" y="242" class="track-title">WIND · KN${weatherStatus === 'stale' ? ' · CACHED' : ''}</text>${grids([0, Math.round(maxWind / 2), maxWind], wy)}<path d="M${L} ${wy(limit)}H${R}" class="comfort-line"/><path d="${path(hours, 'gust', wy, 3600)}" class="gust-line"/><path d="${path(hours, 'wind', wy, 3600)}" class="wind-line"/>
 ${current.length && !currentOnTide.length ? `<text x="${L}" y="222">Current times available in details; tide height unavailable for overlay</text>` : ''}
 ${selected >= start && selected < end ? `<path d="M${x(selected)} 32V350" class="selected-time"/>` : ''}
 ${ticks.map((t, i) => `<text x="${x(t)}" y="371" text-anchor="${i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}">${i === ticks.length - 1 ? 'Midnight' : clock(t)}</text>`).join('')}</svg>`;
}
