# scripts/make_sites.py
import json, math
import rasterio
from pyproj import Transformer

R = 1737400.0                 # m, as in the LOLA polar products
DEM = "../raw/LDEM_80S_80MPP_ADJ.TIF"     # [Check] exact name
RANGE_M, STEP_M, AZ_STEP, MAST = 30000, 80, 2, 2.0    # reach, spacing, azimuth step (deg), panel height (m)

sites = [{"name": "Site A (example)", "lat": -88.0, "lon": 30.0}]   # your curated list goes here

src = rasterio.open(DEM)
dem = src.read(1)
to_xy = Transformer.from_crs("+proj=longlat +R=1737400 +no_defs",
        "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs", always_xy=True)

def height_at(lat, lon):
    x, y = to_xy.transform(lon, lat)
    row, col = src.index(x, y)
    if 0 <= row < dem.shape[0] and 0 <= col < dem.shape[1]:
        return float(dem[row, col])
    return None

def destination(lat, lon, az, dist):      # the great-circle step from the derivation above
    d = dist / R
    la1, lo1, a = math.radians(lat), math.radians(lon), math.radians(az)
    la2 = math.asin(math.sin(la1)*math.cos(d) + math.cos(la1)*math.sin(d)*math.cos(a))
    lo2 = lo1 + math.atan2(math.sin(a)*math.sin(d)*math.cos(la1),
                           math.cos(d) - math.sin(la1)*math.sin(la2))
    return math.degrees(la2), math.degrees(lo2)

def horizon_mask(lat, lon):
    lat = min(lat, -89.999)               # avoid the undefined direction exactly at the pole
    h0 = height_at(lat, lon) + MAST
    mask = []
    for az in range(0, 360, AZ_STEP):
        best = 0.0                        # flat-sphere horizon as the floor (dip of ~0.1° ignored)
        for r in range(STEP_M, RANGE_M, STEP_M):
            h = height_at(*destination(lat, lon, az, r))
            if h is not None:
                best = max(best, math.degrees(math.atan2(h - h0 - r*r/(2*R), r)))
        mask.append(round(best, 2))
    return mask

for s in sites:
    s["mask"] = horizon_mask(s["lat"], s["lon"]) if s["lat"] < -80.5 else None
json.dump(sites, open("../web/data/sites.json", "w"))