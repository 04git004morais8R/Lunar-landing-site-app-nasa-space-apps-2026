# make_demo_data.py — writes SYNTHETIC (invented) data in the same format as the real files:
#   python make_demo_data.py
#
# Why it exists: a standard development trick. The front end only needs files with the right
# SHAPE, so you can build and debug the whole interface before the real data pipeline works.
# The numbers are crude approximations of the Moon's motions: fine for testing the app,
# NOT valid for any real analysis. The app shows a warning banner when it sees this data.
# Running fetch_ephemeris.py and make_sites.py replaces these files with the real ones.

import json, math, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'data')
os.makedirs(OUT, exist_ok=True)

N = 24 * 365 * 3                                   # three years, hourly
eph = {"synthetic": True, "start": "2027-01-01T00:00:00Z", "stepHours": 1,
       "sunLon": [], "sunLat": [], "earthLon": [], "earthLat": [], "distKm": []}
for h in range(N):
    d = h / 24.0                                   # days since the start
    eph["sunLon"].append(round((360 - 360 * d / 29.53059) % 360, 3))       # sub-solar longitude drifts west once per lunar day
    eph["sunLat"].append(round(1.54 * math.sin(2 * math.pi * d / 346.62), 3))      # +-1.54 deg: the Moon's axial tilt
    eph["earthLon"].append(round(7.9 * math.sin(2 * math.pi * d / 27.5546), 3))    # libration in longitude
    eph["earthLat"].append(round(6.7 * math.sin(2 * math.pi * d / 27.2122 + 1), 3))  # libration in latitude
    eph["distKm"].append(384400.0)

mask = [round(1.5 + 1.2 * math.sin(j / 180 * 2 * math.pi * 3), 2) for j in range(180)]
sites = [
    {"name": "Apollo 11 (demo, flat horizon)", "lat": 0.674, "lon": 23.473, "mask": None},
    {"name": "Polar example A (demo)", "lat": -88.0, "lon": 30.0, "mask": mask},
    {"name": "Polar example B (demo)", "lat": -89.5, "lon": 0.0, "mask": [round(v * 0.2, 2) for v in mask]},
]

json.dump(eph, open(os.path.join(OUT, 'ephemeris.json'), 'w'))
json.dump(sites, open(os.path.join(OUT, 'sites.json'), 'w'))
print('wrote synthetic demo data to', OUT)
