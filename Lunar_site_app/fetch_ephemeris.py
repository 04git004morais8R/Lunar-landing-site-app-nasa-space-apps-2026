# fetch_ephemeris.py — run ONCE on your computer:   python fetch_ephemeris.py
#
# Job: ask NASA/JPL Horizons, for every hour of several years, three things about the Moon:
#   - the point on the Moon where Earth is overhead   (sub-Earth point, "libration")
#   - the point on the Moon where the Sun is overhead (sub-solar point)
#   - the Earth–Moon distance
# and save them in web/data/ephemeris.json. The browser code (geometry.js) turns these
# into the Sun/Earth sky position for ANY site, so this is the only astronomy data needed.
#
# NOT TESTED against the live service (it could not be reached while writing it).
# Things to check if it errors:
#   - print(eph.colnames) shows the real column names: adjust the five names used below
#   - if step '1h' is rejected, try '60m'

import json, os
from astroquery.jplhorizons import Horizons

AU_KM = 149597870.7
OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'data', 'ephemeris.json')

out = {"start": "2027-01-01T00:00:00Z", "stepHours": 1,
       "sunLon": [], "sunLat": [], "earthLon": [], "earthLat": [], "distKm": []}

for yr in (2027, 2028, 2029):                       # one request per year keeps each query small
    obj = Horizons(id='301', location='500',        # target: the Moon; observer: Earth's centre
                   epochs={'start': f'{yr}-01-01', 'stop': f'{yr + 1}-01-01', 'step': '1h'})
    eph = obj.ephemerides(quantities='13,14,20')    # 13 sub-observer point, 14 sub-solar point, 20 range
    if yr == 2027:
        print(eph.colnames)                         # <- check these names against the five below
    n = len(eph) if yr == 2029 else len(eph) - 1    # the 'stop' time is included: drop it to avoid duplicates
    out["earthLon"] += [round(float(v), 3) for v in eph['PDObsLon'][:n]]
    out["earthLat"] += [round(float(v), 3) for v in eph['PDObsLat'][:n]]
    out["sunLon"]   += [round(float(v), 3) for v in eph['PDSunLon'][:n]]
    out["sunLat"]   += [round(float(v), 3) for v in eph['PDSunLat'][:n]]
    out["distKm"]   += [round(float(v) * AU_KM, 1) for v in eph['delta'][:n]]
    print(yr, 'done')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, 'w'))
print('wrote', OUT, '-', len(out["sunLon"]), 'hourly rows')
