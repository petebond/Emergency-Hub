"""Builds demo/demo-data.json: a made-up church contact list for demonstrations.

Nothing in it belongs to a real person:
  - names are random pairings of common first names and surnames
  - street names are invented
  - postcodes use letters that UK postcodes never use in the last two places (C, I, K, M, O, V),
    so none of them can be a real address
  - phone numbers come from the ranges Ofcom keeps for TV and film (07700 900xxx, 01632 960xxx)
  - email addresses use example.com, which is reserved for examples
  - positions are scattered around village and town centres, not placed on real houses

Run:  python tools/make_demo.py
"""
import json
import math
import os
import random

R = random.Random(20261114)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "demo", "demo-data.json")

FIRST = ["Alice", "Amira", "Ben", "Bethany", "Callum", "Carys", "Daniel", "Deborah", "Eddie", "Eleanor", "Faith",
         "Felix", "Gemma", "George", "Hannah", "Harvey", "Imogen", "Isaac", "Jasmine", "Joel", "Karen", "Kofi",
         "Leah", "Liam", "Maggie", "Marcus", "Naomi", "Nathan", "Olive", "Owen", "Patricia", "Priya", "Quentin",
         "Rachel", "Reuben", "Ruth", "Samuel", "Sophie", "Tessa", "Theo", "Ursula", "Victor", "Wendy", "Will",
         "Yvonne", "Zach", "Agnes", "Barry", "Cecily", "Dennis", "Elsie", "Frank", "Gwen", "Harold", "Iris",
         "Jean", "Kenneth", "Lorna", "Malcolm", "Nora", "Percy", "Rosa", "Stanley", "Thelma", "Vera", "Walter"]
OLDER = ["Agnes", "Barry", "Cecily", "Dennis", "Elsie", "Frank", "Gwen", "Harold", "Iris", "Jean", "Kenneth",
         "Lorna", "Malcolm", "Nora", "Percy", "Rosa", "Stanley", "Thelma", "Vera", "Walter"]
SURNAMES = ["Ashdown", "Baverstock", "Brindley", "Carraway", "Dunmore", "Elphick", "Fennimore", "Gadsby",
            "Hartwell", "Ingleby", "Jessop", "Kettering", "Lanyon", "Merriweather", "Nettleford", "Oakhill",
            "Pendle", "Quartermain", "Rookwood", "Sallowfield", "Thackeray", "Underhill", "Vellacott",
            "Whitlock", "Yardley", "Abernethy", "Blackmore", "Coldridge", "Drayford", "Eastleigh", "Farthing",
            "Greenhalgh", "Holloway", "Ivesley", "Kimberley", "Lockyer", "Mapperton", "Northcott", "Pargeter",
            "Rendell", "Stickland", "Tolley", "Upwood", "Wellstead"]
STREETS = ["Bramblewick Lane", "Tansy Row", "Pennyroyal Close", "Thistledown Way", "Kestrel Rise", "Larkspur Gardens",
           "Old Tannery Yard", "Wrenfield Road", "Cobblers Walk", "Hazelbrook Drive", "Saddlers Mead",
           "Quillstone Court", "Foxglove Crescent", "Millpond Path", "Coppice End", "Weavers Green",
           "Sorrel Lane", "Brookhaven Terrace", "Juniper Hollow", "Rushmere Avenue", "Orchard Byre",
           "Lantern Close", "Withy Bed Lane", "Chalkpit Row", "Owlsmoor Way", "Damson Drive"]

# (town, county, postcode district + sector digit, centre lat, centre lon, spread in metres, households)
PLACES = [
    ("Gillingham", "Dorset", "SP8 4", 51.0365, -2.2745, 650, 30),
    ("Motcombe", "Dorset", "SP7 9", 51.0245, -2.2195, 220, 5),
    ("Shaftesbury", "Dorset", "SP7 8", 51.0060, -2.1960, 400, 6),
    ("Mere", "Wiltshire", "BA12 6", 51.0900, -2.2675, 300, 5),
    ("Zeals", "Wiltshire", "BA12 6", 51.0845, -2.3150, 180, 2),
    ("Bourton", "Dorset", "SP8 5", 51.0790, -2.3240, 200, 3),
    ("Milton on Stour", "Dorset", "SP8 5", 51.0560, -2.2850, 180, 3),
    ("East Stour", "Dorset", "SP8 5", 50.9990, -2.2760, 180, 2),
    ("Kington Magna", "Dorset", "SP8 5", 51.0000, -2.3180, 150, 2),
    ("Stour Provost", "Dorset", "SP8 5", 50.9930, -2.3000, 150, 2),
    ("Silton", "Dorset", "SP8 5", 51.0640, -2.3060, 120, 1),
]
NEVER = "CIKMOV"      # never used in the last two letters of a real UK postcode

VULN_NOTES = ["Uses oxygen at home - needs power", "Limited mobility - ground floor only", "Hard of hearing - text first",
              "No car", "Carer visits each morning", "Uses a wheelchair", "Needs medication from the chemist weekly",
              "Lives on a farm track - can be cut off in floods", "Partially sighted", ""]

used_names = set()


def name(older=False, surname=None):
    while True:
        fn = R.choice(OLDER if older else FIRST)
        sn = surname or R.choice(SURNAMES)
        if (fn, sn) not in used_names:
            used_names.add((fn, sn))
            return fn, sn


def jitter(lat, lon, metres):
    r = metres * math.sqrt(R.random())
    a = R.random() * 2 * math.pi
    return (round(lat + r * math.cos(a) / 111320, 6),
            round(lon + r * math.sin(a) / (111320 * math.cos(math.radians(lat))), 6))


phone_n = iter(R.sample(range(0, 1000), 400))
mob_n = iter(R.sample(range(0, 1000), 400))
ids = iter("%012x" % R.getrandbits(48) for _ in range(1000))


def landline():
    return "01632 960%03d" % next(phone_n)


def mobile():
    return "07700 900%03d" % next(mob_n)


contacts = []
hh_n = 0
for town, county, district, clat, clon, spread, n_hh in PLACES:
    for _ in range(n_hh):
        hh_n += 1
        size = R.choices([1, 2, 3, 4], weights=[38, 36, 14, 12])[0]
        older = R.random() < 0.35
        lat, lon = jitter(clat, clon, spread)
        street = "%d %s" % (R.randint(1, 60), R.choice(STREETS))
        R.randint(1, 9)        # (kept so the same people are generated as before)
        pc = "%s%s%s" % (district, R.choice(NEVER), R.choice(NEVER))
        tel = landline() if R.random() < 0.7 else ""
        surname = R.choice(SURNAMES)
        for i in range(size):
            fn, sn = name(older=older and i < 2, surname=surname)
            contacts.append({
                "first_name": fn, "last_name": sn, "address1": street, "address2": "", "town": town,
                "county": county, "postcode": pc, "country": "United Kingdom", "telephone": tel,
                "mobile": mobile() if (R.random() < 0.8 and not (older and R.random() < 0.5)) else "",
                "email": ("%s.%s@example.com" % (fn, sn)).lower() if R.random() < 0.6 else "",
                "statuses": [], "notes": "", "lat": lat, "lon": lon, "_hh": hh_n, "_size": size, "_older": older,
                "_town": town,
            })

# statuses
for c in contacts:
    if c["_size"] == 1:
        c["statuses"].append("single")
pool = [c for c in contacts if c["_older"]] + R.sample(contacts, 4)
for c in R.sample(pool, 14):
    if "vulnerable" not in c["statuses"]:
        c["statuses"].append("vulnerable")
        c["notes"] = R.choice(VULN_NOTES)
able = [c for c in contacts if "vulnerable" not in c["statuses"]]
for c in R.sample(able, 6):
    c["statuses"].append("leader")
for c in R.sample(able, 9):
    if "small_group_leader" not in c["statuses"]:
        c["statuses"].append("small_group_leader")
for c in R.sample(able, 7):
    if "first_aider" not in c["statuses"]:
        c["statuses"].append("first_aider")


# hub coordinators: one or two per area, chosen from people who are not vulnerable
def pick_hub(town, level=1, note=""):
    cands = [c for c in able if c["_town"] == town and "hub_coordinator" not in c["statuses"]]
    c = R.choice(cands)
    c["statuses"].append("hub_coordinator")
    c["hub_level"] = level
    if note:
        c["notes"] = note
    return c


pick_hub("Gillingham")
pick_hub("Gillingham")
pick_hub("Gillingham", 2)
pick_hub("Shaftesbury")
pick_hub("Motcombe", 2)
pick_hub("Mere")
pick_hub("Zeals", 2, "Has a generator")
pick_hub("Bourton", 2)
pick_hub("East Stour", 2)

# two people the map cannot place, to show the "Not on map" list
for c in R.sample([c for c in contacts if "hub_coordinator" not in c["statuses"] and c["_size"] > 1], 2):
    c["lat"] = c["lon"] = None
    c["postcode"] = ""
    c["notes"] = "Address incomplete - check with the office"

out_contacts = {}
for c in contacts:
    cid = next(ids)
    rec = {k: c[k] for k in ("first_name", "last_name", "address1", "address2", "town", "county", "postcode",
                             "country", "telephone", "mobile", "email")}
    rec.update({
        "id": cid, "key": "%s|%s" % (c["first_name"].lower(), c["last_name"].lower()),
        "statuses": c["statuses"], "hub_override": None, "notes": c["notes"],
        "added_at": "2026-11-01T10:00:00", "updated_at": "2026-11-01T10:00:00",
        "lat": c["lat"], "lon": c["lon"],
        "geo": ({"status": "ok", "source": "demo", "note": ""} if c["lat"] is not None
                else {"status": "none", "source": "", "note": "No postcode"}),
    })
    if c.get("hub_level"):
        rec["hub_level"] = c["hub_level"]
    out_contacts[cid] = rec

located = [c for c in out_contacts.values() if c["lat"] is not None]


# ---- upload history: a first import, then a later update with a few typical changes
def full(c):
    return "%s %s" % (c["first_name"], c["last_name"])


def km(a, b):
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lon"] - a["lon"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


hubs = [c for c in located if "hub_coordinator" in c["statuses"]]


def nearest_hub(c):
    if c["lat"] is None:
        return None, None
    h = min((x for x in hubs if x["id"] != c["id"]), key=lambda x: km(c, x))
    return full(h), km(c, h)


def addr(c):
    return ", ".join(x for x in (c["address1"], c["town"], c["postcode"]) if x)


all_c = list(out_contacts.values())
plain = [c for c in located if "hub_coordinator" not in c["statuses"]]
newcomers = R.sample(plain, 3)
phone_changes = R.sample([c for c in plain if c not in newcomers and c["mobile"]], 3)
mover = R.choice([c for c in plain if c not in newcomers and c not in phone_changes and c["town"] == "Gillingham"])
mover_old_hub = R.choice([h for h in hubs if full(h) != nearest_hub(mover)[0]])
not_located = [{"id": c["id"], "name": full(c), "note": "No postcode"} for c in all_c if c["lat"] is None]

first = {
    "id": "demo000001", "timestamp": "2026-09-14T19:30:00", "filename": "church-list-september.csv",
    "rows": len(all_c) - 1, "before": 0, "after": len(all_c) - 1,
    "added": [{"id": c["id"], "name": full(c), "hub": None, "hub_km": None, "located": c["lat"] is not None, "note": ""}
              for c in all_c if c not in newcomers] + [{"id": "demo-gone-1", "name": "Edith Marlowe", "hub": None, "hub_km": None,
                                                         "located": True, "note": ""},
                                                        {"id": "demo-gone-2", "name": "Ronald Marlowe", "hub": None, "hub_km": None,
                                                         "located": True, "note": ""}],
    "removed": [], "updated": [], "hub_changes": [], "not_located": not_located, "approx": [],
    "warnings": ["No hub coordinators are set yet - tick 'Hub Coordinator' on people's contact cards"],
}
first["added"] = first["added"][: first["rows"]]
second = {
    "id": "demo000002", "timestamp": "2026-11-01T10:15:00", "filename": "church-list-november.csv",
    "rows": len(all_c), "before": len(all_c) - 1, "after": len(all_c),
    "added": [dict(zip(("id", "name", "hub", "hub_km", "located", "note"),
                       (c["id"], full(c)) + nearest_hub(c) + (True, ""))) for c in newcomers],
    "removed": [{"name": "Edith Marlowe", "statuses": ["vulnerable", "single"], "address": "3 Weavers Green, Gillingham, SP8 4KC",
                 "assigned_count": 0},
                {"name": "Ronald Marlowe", "statuses": ["first_aider"], "address": "18 Hazelbrook Drive, Mere, BA12 6VI",
                 "assigned_count": 0}],
    "updated": [{"id": c["id"], "name": full(c), "changes": [{"field": "Mobile", "old": "07700 900%03d" % R.randint(0, 999),
                                                               "new": c["mobile"]}]} for c in phone_changes]
               + [{"id": mover["id"], "name": full(mover), "changes": [
                   {"field": "Address 1", "old": "%d %s" % (R.randint(1, 60), R.choice(STREETS)), "new": mover["address1"]},
                   {"field": "Postcode", "old": "SP8 4%s%s" % (R.choice(NEVER), R.choice(NEVER)), "new": mover["postcode"]}]}],
    "hub_changes": [{"id": mover["id"], "name": full(mover), "old_hub": full(mover_old_hub), "new_hub": nearest_hub(mover)[0],
                     "why": "Address changed - a different hub coordinator is now nearest"}],
    "not_located": not_located, "approx": [], "warnings": [],
}
db = {
    "version": 1,
    "demo": True,
    "contacts": out_contacts,
    "uploads": [first, second],
    "centre": {"name": "Riverside Hall", "postcode": "SP84KV", "postcode_display": "SP8 4KV", "lat": 51.0378, "lon": -2.2712,
               "landline": "01632 960999", "mobile": "07700 900999", "email": "office@example.com",
               "other": "Demo only - every name, address and number here is made up."},
    "settings": {
        "org_name": "Riverside Community Church (demo)",
        "accent_color": "#0F5C6E",
        "grouping_levels": 2,
        "statuses": [{"key": "leader", "label": "Leader"}, {"key": "small_group_leader", "label": "Small group leader"},
                     {"key": "vulnerable", "label": "Vulnerable"}, {"key": "single", "label": "Single occupancy"},
                     {"key": "first_aider", "label": "First aider"}, {"key": "hub_coordinator", "label": "Hub Coordinator"}],
        "status_colors": {"leader": "#7B2CBF", "small_group_leader": "#1D6FD8", "vulnerable": "#D62828",
                          "single": "#F28C28", "first_aider": "#C2185B", "hub_coordinator": "#1A9E77", "none": "#8C8C8C"},
        "dp_lead_name": "Demo Data Lead", "dp_lead_contact": "privacy@example.com",
    },
    "images": {},
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(db, f, indent=1, ensure_ascii=False)
print("Wrote %d people in %d households (%d on the map) to %s" % (len(out_contacts), hh_n, len(located), OUT))
