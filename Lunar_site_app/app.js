// app.js — the glue and the drawing.
//
// Pattern used throughout: the whole screen is a function of a small amount of STATE
// (which site, which window, where the time cursor is). When the user changes a
// control we update the state, then re-run the drawing functions. Nothing on screen
// is ever "edited in place": it is redrawn from the state. This keeps the logic simple.
//
// Two levels of refresh:
//   update()  heavy: the site/date/window changed → recompute the series and the table
//   redraw()  light: only the time cursor moved   → redraw the pictures and readouts

const state = {
  eph: null,        // contents of ephemeris.json
  sites: [],        // contents of sites.json
  custom: null,     // the user's own coordinates, if any
  site: null,       // the site currently inspected
  c: null,          // current controls: { i0, n, minSun, minEarth }
  series: null,     // hourly series for the current site and window (from events.js)
  k: 0,             // time cursor: hour offset inside the window
  timer: null       // animation timer
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Illustrative colour thresholds for the table: [good if at least/at most, ok if at least/at most].
const THRESH = { sun: [0.9, 0.6], earth: [0.6, 0.3], both: [0.5, 0.25], darkH: [72, 200] };

// ---------------------------------------------------------------- small helpers
const allSites = () => state.sites.concat(state.custom ? [state.custom] : []);

const timeOfIndex = i => new Date(Date.parse(state.eph.start) + i * state.eph.stepHours * 3600e3);
const fmtUTC = d => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

function fmtHours(h) {
  if (h < 1) return Math.round(h * 60) + ' min';
  if (h < 48) return h.toFixed(1) + ' h';
  return (h / 24).toFixed(1) + ' days';
}

// scale(d0, d1, r0, r1) returns a function mapping data values in [d0, d1] onto pixels in [r0, r1].
// Every chart is built from two of these (one for x, one for y).
const scale = (d0, d1, r0, r1) => v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);

// "Nice" axis ticks: about `target` of them, at 1, 2 or 5 times a power of ten.
function niceTicks(lo, hi, target) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(f => f * mag).find(s => s >= raw);
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(Math.round(t / step) * step);
  return ticks;
}

// ---------------------------------------------------------------- startup
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
}

async function init() {
  try {
    state.eph = await loadJSON('data/ephemeris.json');
    state.sites = await loadJSON('data/sites.json');
  } catch (err) {
    $('status').textContent =
      'Could not load data/ephemeris.json or data/sites.json. Run fetch_ephemeris.py and make_sites.py first, ' +
      'then open this page through a local server (run "python -m http.server 8000" inside the web folder and visit ' +
      'http://localhost:8000) instead of double-clicking the file.';
    return;
  }

  const eph = state.eph;
  if (eph.synthetic) {                       // never let invented data pass as real
    $('status').textContent = 'DEMO DATA: these positions are synthetic placeholders for testing the interface. ' +
      'Run fetch_ephemeris.py and make_sites.py to replace them with real data.';
  }
  const last = timeOfIndex(eph.sunLon.length - 1).toISOString().slice(0, 16);
  $('start').min = eph.start.slice(0, 16);
  $('start').max = last;
  $('start').value = eph.start.slice(0, 16);

  fillSiteSelect(0);
  state.site = allSites()[0];

  ['start', 'days', 'minSun', 'minEarth'].forEach(id => $(id).addEventListener('change', update));
  $('site').addEventListener('change', () => { state.site = allSites()[Number($('site').value)]; update(); });
  $('useCustom').addEventListener('click', useCustomSite);
  $('cursor').addEventListener('input', () => { state.k = Number($('cursor').value); redraw(); });
  $('play').addEventListener('click', togglePlay);

  update();
}

function fillSiteSelect(selectedIndex) {
  $('site').innerHTML = allSites().map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
  $('site').value = String(selectedIndex);
}

function useCustomSite() {
  const lat = Number($('customLat').value), lon = Number($('customLon').value);
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 360)) {
    $('status').textContent = 'Latitude must be between −90 and 90, and longitude between −180 and 360 (degrees east).';
    return;
  }
  $('status').textContent = '';
  state.custom = { name: `Custom (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`, lat, lon, mask: null };
  fillSiteSelect(allSites().length - 1);
  state.site = state.custom;
  update();
}

function togglePlay() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; $('play').textContent = 'Play'; return; }
  $('play').textContent = 'Pause';
  state.timer = setInterval(() => {
    state.k = (state.k + 1) % state.series.len;
    $('cursor').value = state.k;
    redraw();
  }, 50);
}

// ---------------------------------------------------------------- controls → state
function readControls() {
  const eph = state.eph;
  const startMs = Date.parse($('start').value + ':00Z');                  // the input has no time zone: we declare it UTC
  let i0 = isNaN(startMs) ? 0 : Math.round((startMs - Date.parse(eph.start)) / (eph.stepHours * 3600e3));
  i0 = Math.max(0, Math.min(eph.sunLon.length - 2, i0));                  // keep inside the table
  const days = Number($('days').value);
  const n = Math.min(Math.round(days * 24 / eph.stepHours), eph.sunLon.length - i0);
  return { i0, n, minSun: Number($('minSun').value) || 0, minEarth: Number($('minEarth').value) || 0 };
}

function update() {                                                      // heavy refresh
  state.c = readControls();
  const c = state.c;
  state.series = buildSeries(state.site, c.i0, c.n, state.eph, c.minSun, c.minEarth);
  state.k = Math.min(state.k, state.series.len - 1);
  $('cursor').max = state.series.len - 1;
  $('cursor').value = state.k;
  drawTable();
  redraw();
}

function redraw() {                                                      // light refresh
  const s = state.series, k = state.k;
  drawSky(s, k);
  drawTimeline(s, k);
  writeReadouts(s, stats(s, k), k);
  $('cursorTime').textContent = fmtUTC(timeOfIndex(s.i0 + k));
}

// ---------------------------------------------------------------- sky view
// x = compass bearing (0° north … 360°), y = elevation. The grey shape is the terrain
// silhouette (the horizon mask); anything above it is visible from the site.
function drawSky(s, k) {
  const W = 760, H = 300, m = { l: 44, r: 12, t: 12, b: 30 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;

  // Vertical range: always show a little below the horizon and above the highest thing drawn,
  // but never more than 15° below (an equatorial night would otherwise squash everything).
  let maxEl = 10, minEl = -3;
  for (let j = 0; j < s.len; j++) {
    maxEl = Math.max(maxEl, s.sunEl[j] + 3, s.earthEl[j] + 3);
    minEl = Math.min(minEl, s.sunEl[j] - 1, s.earthEl[j] - 1);
  }
  if (s.site.mask) maxEl = Math.max(maxEl, Math.max(...s.site.mask) + 3);
  const lo = Math.max(-15, minEl), hi = maxEl;

  const X = scale(0, 360, m.l, m.l + pw);
  const Y = scale(hi, lo, m.t, m.t + ph);          // note the order: larger elevation → smaller pixel y (up the screen)

  let out = `<defs><clipPath id="skyclip"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></clipPath></defs>`;

  // grid and labels
  niceTicks(lo, hi, 6).forEach(t => {
    out += `<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/>`;
    out += `<text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${Number(t.toFixed(2))}°</text>`;
  });
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
  names.forEach((nm, i) => {
    out += `<line class="grid" x1="${X(i * 45)}" x2="${X(i * 45)}" y1="${m.t}" y2="${m.t + ph}"/>`;
    out += `<text x="${X(i * 45)}" y="${H - 10}" text-anchor="middle">${nm}</text>`;
  });

  // everything inside the plot area is clipped to it
  out += `<g clip-path="url(#skyclip)">`;

  // terrain silhouette (or a flat horizon if no terrain data)
  if (s.site.mask) {
    const n = s.site.mask.length, pts = [];
    for (let j = 0; j <= n; j++) pts.push(`${X(j / n * 360).toFixed(1)},${Y(s.site.mask[j % n]).toFixed(1)}`);
    out += `<polygon class="ground" points="${pts.join(' ')} ${X(360)},${Y(lo)} ${X(0)},${Y(lo)}"/>`;
  } else {
    out += `<rect class="ground" x="${X(0)}" y="${Y(0)}" width="${pw}" height="${Y(lo) - Y(0)}"/>`;
  }
  out += `<line class="zero" x1="${X(0)}" x2="${X(360)}" y1="${Y(0)}" y2="${Y(0)}"/>`;

  // paths followed over the whole window
  out += trailPaths(s.sunAz, s.sunEl, X, Y, 'suntrail');
  out += trailPaths(s.earthAz, s.earthEl, X, Y, 'earthtrail');

  // the bodies at the time cursor: filled = usable, hollow = not usable
  out += marker(s.sunAz[k], s.sunEl[k], s.sunMargin[k] > 0, 'sundot', 'sunlabel', 'Sun', X, Y, m, pw);
  out += marker(s.earthAz[k], s.earthEl[k], s.earthMargin[k] > 0, 'earthdot', 'earthlabel', 'Earth', X, Y, m, pw);
  out += `</g>`;

  out += `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="none" class="axis"/>`;
  $('sky').innerHTML = out;
}

// A path as a list of points, cut wherever the bearing wraps from ~360° to ~0° (otherwise a
// long line would be drawn straight across the whole plot).
function trailPaths(az, el, X, Y, cls) {
  let out = '', pts = [];
  const flush = () => { if (pts.length > 1) out += `<polyline class="${cls}" points="${pts.join(' ')}"/>`; pts = []; };
  for (let j = 0; j < az.length; j++) {
    if (j > 0 && Math.abs(az[j] - az[j - 1]) > 180) flush();
    pts.push(`${X(az[j]).toFixed(1)},${Y(el[j]).toFixed(1)}`);
  }
  flush();
  return out;
}

function marker(az, el, usable, cls, labelCls, label, X, Y, m, pw) {
  const x = X(az), y = Y(el);
  const right = x > m.l + pw - 60;                  // flip the label to the left near the right edge
  return `<circle class="${cls} ${usable ? 'up' : 'down'}" cx="${x}" cy="${y}" r="7"/>` +
         `<text class="${labelCls}" x="${right ? x - 12 : x + 12}" y="${y - 9}" text-anchor="${right ? 'end' : 'start'}">${label}</text>`;
}

// ---------------------------------------------------------------- timeline
// x = time through the window, y = elevation. Solid line = the body's elevation.
// Dashed line = the level it must clear (terrain horizon + your minimum). Where the solid
// line is above the dashed one the body is usable; the coloured bands underneath mark those periods.
function drawTimeline(s, k) {
  const W = 760, H = 300, m = { l: 62, r: 12, t: 12, b: 52 };   // wider left margin: room for the band labels
  const pw = W - m.l - m.r, ph = H - m.t - m.b;

  let lo = -1, hi = 1;
  for (let j = 0; j < s.len; j++) {
    lo = Math.min(lo, s.sunEl[j], s.earthEl[j], s.sunLimit[j], s.earthLimit[j]);
    hi = Math.max(hi, s.sunEl[j], s.earthEl[j], s.sunLimit[j], s.earthLimit[j]);
  }
  const pad = (hi - lo) * 0.06;
  lo -= pad; hi += pad;

  const X = scale(0, Math.max(1, s.len - 1), m.l, m.l + pw);
  const Y = scale(hi, lo, m.t, m.t + ph);
  const line = (arr, cls) => `<polyline class="${cls}" points="${arr.map((v, j) => `${X(j).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;

  let out = '';
  niceTicks(lo, hi, 6).forEach(t => {
    out += `<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/>`;
    out += `<text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${Number(t.toFixed(2))}°</text>`;
  });

  // time axis: ticks in days since the window start, labelled with the calendar date (MM-DD)
  const totalDays = (s.len - 1) * s.stepH / 24;
  niceTicks(0, totalDays, 6).forEach(d => {
    const j = d * 24 / s.stepH;
    out += `<line class="grid" x1="${X(j)}" x2="${X(j)}" y1="${m.t}" y2="${m.t + ph}"/>`;
    out += `<text x="${X(j)}" y="${m.t + ph + 14}" text-anchor="middle">${timeOfIndex(s.i0 + Math.round(j)).toISOString().slice(5, 10)}</text>`;
  });

  out += `<line class="zero" x1="${m.l}" x2="${m.l + pw}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  out += line(s.sunLimit, 'sunlimit') + line(s.earthLimit, 'earthlimit');
  out += line(s.sunEl, 'sunline') + line(s.earthEl, 'earthline');

  // usable-period bands under the plot
  const bandY = m.t + ph + 22;
  usableRuns(s.sunMargin).forEach(([a, b]) => {
    out += `<rect class="sunband" x="${X(a)}" y="${bandY}" width="${Math.max(1.5, X(b) - X(a))}" height="7"/>`;
  });
  usableRuns(s.earthMargin).forEach(([a, b]) => {
    out += `<rect class="earthband" x="${X(a)}" y="${bandY + 11}" width="${Math.max(1.5, X(b) - X(a))}" height="7"/>`;
  });
  out += `<text x="${m.l - 6}" y="${bandY + 7}" text-anchor="end">Sun up</text>`;
  out += `<text x="${m.l - 6}" y="${bandY + 18}" text-anchor="end">Earth up</text>`;

  out += `<text class="sunlabel" x="${m.l + 8}" y="${m.t + 14}">Sun elevation</text>`;
  out += `<text class="earthlabel" x="${m.l + 8}" y="${m.t + 28}">Earth elevation</text>`;
  out += `<text x="${m.l + pw - 8}" y="${m.t + 14}" text-anchor="end">dashed: level each must clear</text>`;

  out += `<line class="cursorline" x1="${X(k)}" x2="${X(k)}" y1="${m.t}" y2="${bandY + 18}"/>`;
  out += `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="none" class="axis"/>`;
  $('timeline').innerHTML = out;
}

// ---------------------------------------------------------------- readouts
function bodyBlock(label, cls, one, el, az, riseWord, setWord) {
  let next;
  if (one.hoursToChange === null) next = one.isUpNow ? 'stays up for the rest of this window' : 'stays down for the rest of this window';
  else next = (one.isUpNow ? setWord : riseWord) + ' in ' + fmtHours(one.hoursToChange);
  return `<p><span class="big ${cls}">${label}: ${one.isUpNow ? 'up' : 'down'}</span><br>` +
         `<span class="small">elevation ${el.toFixed(2)}°, azimuth ${az.toFixed(0)}°</span><br>${next}</p>`;
}

function writeReadouts(s, st, k) {
  const pct = x => Math.round(x * 100) + '%';
  $('readouts').innerHTML =
    `<h2>${esc(s.site.name)}</h2>` +
    bodyBlock('Sun', 'sunword', st.sun, s.sunEl[k], s.sunAz[k], 'sunrise', 'sunset') +
    bodyBlock('Earth', 'earthword', st.earth, s.earthEl[k], s.earthAz[k], 'Earthrise', 'Earthset') +
    `<p>Over this window: Sun usable ${pct(st.sun.fractionUp)}, Earth usable ${pct(st.earth.fractionUp)}, both together ${pct(st.bothFraction)}. ` +
    `Longest Sun-dark stretch ${fmtHours(st.sun.longestDarkH)}.</p>` +
    `<p class="small">"Up" means above the local horizon plus the minimum elevation you set.` +
    (s.site.mask ? '' : ' This site has no terrain data, so its horizon is assumed flat.') + `</p>`;
}

// ---------------------------------------------------------------- comparison table
const gradeHigh = (x, t) => x >= t[0] ? 'good' : x >= t[1] ? 'ok' : 'bad';
const gradeLow  = (x, t) => x <= t[0] ? 'good' : x <= t[1] ? 'ok' : 'bad';

function drawTable() {
  const c = state.c;
  const pct = x => Math.round(x * 100) + '%';
  let rows = '';
  allSites().forEach((site, idx) => {
    const st = stats(buildSeries(site, c.i0, c.n, state.eph, c.minSun, c.minEarth), 0);
    rows += `<tr data-i="${idx}" class="${site === state.site ? 'selected' : ''}">` +
      `<td>${esc(site.name)}${site.mask ? '' : ' *'}</td>` +
      `<td class="${gradeHigh(st.sun.fractionUp, THRESH.sun)}">${pct(st.sun.fractionUp)}</td>` +
      `<td class="${gradeLow(st.sun.longestDarkH, THRESH.darkH)}">${fmtHours(st.sun.longestDarkH)}</td>` +
      `<td class="${gradeHigh(st.earth.fractionUp, THRESH.earth)}">${pct(st.earth.fractionUp)}</td>` +
      `<td class="${gradeHigh(st.bothFraction, THRESH.both)}">${pct(st.bothFraction)}</td>` +
      `<td>${st.sun.maxEl.toFixed(1)}°</td></tr>`;
  });
  $('compare').innerHTML =
    `<thead><tr><th>Site</th><th>Sun up</th><th>Longest Sun-dark</th><th>Earth up</th><th>Both up</th><th>Max Sun elevation</th></tr></thead>` +
    `<tbody>${rows}</tbody>`;
  $('compare').querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = Number(tr.dataset.i);
      state.site = allSites()[idx];
      $('site').value = String(idx);
      update();
    });
  });
}

init();
