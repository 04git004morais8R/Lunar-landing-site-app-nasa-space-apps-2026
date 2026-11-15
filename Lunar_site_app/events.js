// events.js — from raw positions to meaning.
//
// geometry.js answers "where is the Sun right now?". Mission planners ask other
// questions: "for how much of the month is it up? how long is the longest night?
// how long until sunset?". This file turns a stretch of hourly positions into
// those answers. Still no drawing code here.
//
// Key idea: for each hour compute a MARGIN in degrees:
//        margin = body elevation − (terrain horizon + minimum elevation we require)
// margin > 0 means "usable", margin ≤ 0 means "not usable". Every metric below is
// just a different way of reading a list of margins.

// Build the hourly series for one site over a window of n hours starting at table index i0.
//   minSunEl / minEarthEl = extra elevation (degrees) the body must clear
//   (e.g. a minimum useful sun angle, or the lowest angle the antenna can track)
function buildSeries(site, i0, n, eph, minSunEl, minEarthEl) {
  const s = {
    site, i0, stepH: eph.stepHours, len: 0,
    sunAz: [], sunEl: [], sunLimit: [], sunMargin: [],
    earthAz: [], earthEl: [], earthLimit: [], earthMargin: []
  };
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    if (i >= eph.sunLon.length) break;               // ran off the end of the table
    const p = skyPos(site, i, eph);

    const sunLimit = horizonAt(site, p.sun.az) + minSunEl;
    const earthLimit = horizonAt(site, p.earth.az) + minEarthEl;

    s.sunAz.push(p.sun.az);       s.sunEl.push(p.sun.el);
    s.sunLimit.push(sunLimit);    s.sunMargin.push(p.sun.el - sunLimit);
    s.earthAz.push(p.earth.az);   s.earthEl.push(p.earth.el);
    s.earthLimit.push(earthLimit); s.earthMargin.push(p.earth.el - earthLimit);
    s.len++;
  }
  return s;
}

// Hours from sample k0 until the margin next changes sign (sunset/Earthset if it is
// positive now, sunrise/Earthrise if not). Returns null if nothing changes in the window.
// Between two samples the margin is assumed to change in a straight line, so the
// crossing time is found by linear interpolation: finer than the hourly step.
function hoursToChange(v, stepH, k0) {
  const nowUp = v[k0] > 0;
  for (let k = k0 + 1; k < v.length; k++) {
    if ((v[k] > 0) !== nowUp) {
      const frac = v[k - 1] / (v[k - 1] - v[k]);     // where in the step the line hits zero
      return ((k - 1 - k0) + frac) * stepH;
    }
  }
  return null;
}

// Summary of one body (Sun or Earth). v = its margins, el = its elevations.
function statsOne(v, el, stepH, k0) {
  let up = 0, run = 0, longestDark = 0, maxEl = -90;
  for (let k = 0; k < v.length; k++) {
    if (v[k] > 0) { up++; run = 0; }
    else { run++; if (run > longestDark) longestDark = run; }   // run of consecutive "not usable" hours
    if (el[k] > maxEl) maxEl = el[k];
  }
  return {
    fractionUp: up / v.length,            // share of the window the body is usable
    longestDarkH: longestDark * stepH,    // longest unbroken unusable stretch (cut off at the window edges)
    maxEl,                                // highest elevation reached (a proxy for power quality)
    isUpNow: v[k0] > 0,
    hoursToChange: hoursToChange(v, stepH, k0)
  };
}

// All metrics for a series. k0 = the "current" sample (the time cursor).
function stats(s, k0) {
  let both = 0;
  for (let k = 0; k < s.len; k++) if (s.sunMargin[k] > 0 && s.earthMargin[k] > 0) both++;
  return {
    sun: statsOne(s.sunMargin, s.sunEl, s.stepH, k0),
    earth: statsOne(s.earthMargin, s.earthEl, s.stepH, k0),
    bothFraction: both / s.len            // power AND direct-to-Earth link at the same time
  };
}

// Consecutive stretches where margin > 0, as [startIndex, endIndex] pairs.
// Used to shade the "Sun up" / "Earth up" bands under the timeline.
function usableRuns(v) {
  const runs = [];
  let start = -1;
  for (let k = 0; k < v.length; k++) {
    if (v[k] > 0 && start < 0) start = k;
    if (v[k] <= 0 && start >= 0) { runs.push([start, k - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, v.length - 1]);
  return runs;
}

if (typeof module !== 'undefined') {
  module.exports = { buildSeries, hoursToChange, statsOne, stats, usableRuns };
}
