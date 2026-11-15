// geometry.js — the physics core.
//
// Job: given a site on the Moon (latitude, longitude) and an hour index into the
// ephemeris table, say where the Sun and the Earth are in that site's sky
// (azimuth + elevation), and what the local terrain horizon is in any direction.
//
// This file knows nothing about the screen (no document, no SVG). That is on
// purpose: pure calculation code is easy to test on its own and to reuse.

const R_MOON_KM = 1737.4;          // mean lunar radius, the Moon is treated as a sphere
const D2R = Math.PI / 180;         // degrees → radians

// ---- tiny vector helpers (a vector is just [x, y, z]) ----------------------
const dot  = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = v => Math.hypot(v[0], v[1], v[2]);

// Unit vector pointing at (lon, lat) on a sphere, in the Moon-fixed frame.
// Used for "the spot where the Sun is overhead" and "the spot where Earth is overhead".
function unitFromLonLat(lonDeg, latDeg) {
  const lon = lonDeg * D2R, lat = latDeg * D2R;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

// The three directions that define "the sky" at a site:
//   up    = straight overhead (away from the Moon's centre)
//   north = along the local meridian, towards increasing latitude
//   east  = towards increasing longitude
function localFrame(site) {
  // Exactly at a pole "north" is undefined, so nudge the latitude a hair.
  const lat = Math.max(-89.999, Math.min(89.999, site.lat)) * D2R;
  const lon = site.lon * D2R;
  return {
    up:    [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)],
    north: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)],
    east:  [-Math.sin(lon), Math.cos(lon), 0]
  };
}

// Turn a direction vector v (pointing from the site towards a body) into
// elevation (angle above the local horizontal) and azimuth (compass bearing,
// clockwise from north).
function azEl(v, frame) {
  const n = norm(v);
  const s = Math.max(-1, Math.min(1, dot(v, frame.up) / n));   // guard against rounding past ±1
  return {
    el: Math.asin(s) / D2R,
    az: (Math.atan2(dot(v, frame.east), dot(v, frame.north)) / D2R + 360) % 360
  };
}

// Where are the Sun and the Earth in this site's sky at hour i of the table?
//   eph = the object loaded from ephemeris.json
function skyPos(site, i, eph) {
  const frame = localFrame(site);
  const up = frame.up;

  // Directions as seen from the Moon's centre, in the Moon-fixed frame.
  const sunDir   = unitFromLonLat(eph.sunLon[i],   eph.sunLat[i]);
  const earthDir = unitFromLonLat(eph.earthLon[i], eph.earthLat[i]);

  // The Sun is so far away that standing on the surface instead of at the centre
  // changes its direction by ~0.0007°: ignore. Earth is only ~384,000 km away, so
  // the same offset shifts it by ~0.26°: not negligible when Earth sits a few
  // degrees above the horizon. So build the exact vector site → Earth:
  //     d = D * earthDir  −  R * up      (D = Earth distance, R = lunar radius)
  const D = eph.distKm[i];
  const toEarth = [0, 1, 2].map(k => earthDir[k] * D - R_MOON_KM * up[k]);

  return { sun: azEl(sunDir, frame), earth: azEl(toEarth, frame) };
}

// Elevation of the terrain horizon in compass direction az (degrees).
// site.mask is a list of horizon elevations at equally spaced azimuths starting
// at north (made by make_sites.py from LOLA). Between listed azimuths, interpolate.
// No mask (terrain not modelled) → flat horizon at 0°.
function horizonAt(site, az) {
  if (!site.mask) return 0;
  const n = site.mask.length;
  const pos = (az / 360) * n;
  const i0 = Math.floor(pos) % n;
  const i1 = (i0 + 1) % n;
  const frac = pos - Math.floor(pos);
  return site.mask[i0] * (1 - frac) + site.mask[i1] * frac;
}

// Lets Node.js load this file for testing; ignored in the browser.
if (typeof module !== 'undefined') {
  module.exports = { unitFromLonLat, localFrame, azEl, skyPos, horizonAt, R_MOON_KM };
}
