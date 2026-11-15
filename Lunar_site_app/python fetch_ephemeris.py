# scripts/fetch_ephemeris.py   (run:  python fetch_ephemeris.py)
import json
from astroquery.jplhorizons import Horizons

AU_KM = 149597870.7
out = {"start": "2027-01-01T00:00:00Z", "stepHours": 1,
       "sunLon": [], "sunLat": [], "earthLon": [], "earthLat": [], "distKm": []}

for yr in (2027, 2028, 2029):
    obj = Horizons(id='301', location='500',        # the Moon, seen from Earth's centre
                   epochs={'start': f'{yr}-01-01', 'stop': f'{yr+1}-01-01', 'step': '1h'})
    eph = obj.ephemerides(quantities='13,14,20')
    if yr == 2027:
        print(eph.colnames)                         # [Check] confirm the names used below
    n = len(eph) if yr == 2029 else len(eph) - 1    # the stop epoch is included: drop duplicate
    out["earthLon"] += [round(float(v), 3) for v in eph['PDObsLon'][:n]]   # sub-Earth point
    out["earthLat"] += [round(float(v), 3) for v in eph['PDObsLat'][:n]]
    out["sunLon"]   += [round(float(v), 3) for v in eph['PDSunLon'][:n]]   # sub-solar point
    out["sunLat"]   += [round(float(v), 3) for v in eph['PDSunLat'][:n]]
    out["distKm"]   += [round(float(v) * AU_KM, 1) for v in eph['delta'][:n]]

json.dump(out, open('../web/data/ephemeris.json', 'w'))