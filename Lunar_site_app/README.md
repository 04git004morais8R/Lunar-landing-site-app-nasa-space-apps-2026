# Lunar Landing Site Navigator

Compare lunar landing sites and dates by when the Sun (power) and Earth (direct link) are above the horizon.

## Run it

```
cd web
python -m http.server 8000
```

Open http://localhost:8000. (Do not double-click index.html: the browser blocks loading the JSON files that way.)

The folder ships with **synthetic demo data** so the interface works immediately; the page shows a warning banner while it is in use.

## Replace the demo data with real data

```
pip install astroquery numpy rasterio pyproj
cd scripts
python fetch_ephemeris.py     # Sun/Earth positions from JPL Horizons -> web/data/ephemeris.json
python make_sites.py          # LOLA terrain -> horizon masks        -> web/data/sites.json
```

`make_sites.py` expects a LOLA south-polar elevation GeoTIFF in `raw/` (see the filename at the top of the script).
Both Python scripts are untested against the live services; each has a "check these" note at the top.

## Map of the project

| File | Runs | Role |
|---|---|---|
| scripts/fetch_ephemeris.py | once, offline | hourly Sun/Earth sub-points + distance from Horizons |
| scripts/make_sites.py | once, offline | terrain horizon mask per site from LOLA |
| scripts/make_demo_data.py | once, offline | synthetic stand-ins for the two data files |
| web/data/ephemeris.json, sites.json | generated | the data the browser reads |
| web/geometry.js | browser | Sun/Earth azimuth + elevation for any site and hour |
| web/events.js | browser | margins, sunset/Earthset times, % usable, longest dark |
| web/app.js | browser | controls, state, SVG sky view, timeline, comparison table |
| web/index.html, style.css | browser | structure and appearance |

## Limitations to state in your submission

- The Moon is treated as a sphere; terrain comes from a coarse (tens of metres per pixel) elevation model.
- Positions are hourly samples with linear interpolation, so event times are approximate (about an hour or better).
- Sites outside the terrain model's coverage assume a flat horizon, which is optimistic.
- The table's colour thresholds are illustrative, not mission requirements.
