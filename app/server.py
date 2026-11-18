#!/usr/bin/env python3
"""
Emergency Hub Coordinator - local web server.

Uses only the Python standard library (no pip installs needed).
Run:  python server.py      then open http://127.0.0.1:8765

Data is kept in ./data (contacts.json, geocache.json, backups/).
Settings are in ./config.json (created on first run).
"""
import copy
import csv
import io
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))      # the "app" folder: program files only
STATIC = os.path.join(BASE, "static")
# Layout from 1.1.0:  Emergency Hub Coordinator\  Emergency Hub.lnk, app\ (this file), data\ (incl. config.json)
# Copies from 1.0.0 kept everything in one folder (data\ and config.json next to server.py). Keep using that
# layout if it's what is on disk, so an update installed from 1.0.0 still finds its data.
LEGACY_LAYOUT = os.path.isdir(os.path.join(BASE, "data")) or os.path.isfile(os.path.join(BASE, "config.json"))
HOME_DIR = BASE if LEGACY_LAYOUT else os.path.dirname(BASE)      # the folder that holds "data"
CONFIG_PATH = os.environ.get("EHC_CONFIG") or (os.path.join(BASE, "config.json") if LEGACY_LAYOUT
                                               else os.path.join(HOME_DIR, "data", "config.json"))


def read_app_version():
    try:
        with open(os.path.join(BASE, "VERSION"), "r", encoding="utf-8") as f:
            return f.read().strip() or "0.0.0"
    except OSError:
        return "0.0.0"


APP_VERSION = read_app_version()      # the version this running server was started as
SCHEMA_VERSION = 1                    # the layout of contacts.json this version reads and writes

DEFAULT_CONFIG = {
    "host": "127.0.0.1",          # use "0.0.0.0" to allow other devices on your network
    "port": 8765,
    "open_browser": True,
    "centre_name": "Our church",  # only used the first time; afterwards it is set on the Settings page
    "centre_postcode": "",
    "centre_lat": None,
    "centre_lon": None,
    "address_fallback": True,     # try the full address (OpenStreetMap Nominatim) when the postcode fails
    "data_dir": "data",
    "update_repo": "petebond/Emergency-Hub",   # where new versions are published (GitHub releases)
}

# Priority order (highest first) - decides a dot's colour when someone has several statuses
STATUSES = [
    ("leader", "Leader"),
    ("small_group_leader", "Small group leader"),
    ("vulnerable", "Vulnerable"),
    ("single", "Single occupancy"),
    ("hub_coordinator", "Hub Coordinator"),
]
STATUS_KEYS = [s[0] for s in STATUSES]

FIELDS = [
    ("first_name", "First Name"), ("last_name", "Last Name"),
    ("address1", "Address 1"), ("address2", "Address 2"),
    ("town", "Town/City"), ("county", "County"), ("postcode", "Postcode"),
    ("country", "Country"), ("telephone", "Telephone"), ("mobile", "Mobile"),
    ("email", "Email"),
]
FIELD_LABEL = dict(FIELDS)
ADDRESS_FIELDS = ["address1", "address2", "town", "county", "postcode", "country"]

HEADER_ALIASES = {
    "firstname": "first_name", "forename": "first_name", "forenames": "first_name", "givenname": "first_name",
    "lastname": "last_name", "surname": "last_name", "familyname": "last_name",
    "address1": "address1", "addressline1": "address1", "address": "address1", "street": "address1",
    "address2": "address2", "addressline2": "address2",
    "towncity": "town", "town": "town", "city": "town", "towncity1": "town",
    "county": "county", "postcode": "postcode", "postalcode": "postcode", "zip": "postcode",
    "country": "country",
    "telephone": "telephone", "phone": "telephone", "homephone": "telephone", "tel": "telephone", "landline": "telephone",
    "mobile": "mobile", "mobilephone": "mobile", "cell": "mobile", "mobilenumber": "mobile",
    "email": "email", "emailaddress": "email", "email1": "email",
}

UK_COUNTRIES = {"", "uk", "unitedkingdom", "england", "scotland", "wales", "northernireland",
                "gb", "greatbritain", "britain", "gbr"}
POSTCODE_RE = re.compile(r"^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$")
USER_AGENT = "EmergencyHubCoordinator/1.0 (local church emergency planning tool)"

LOCK = threading.RLock()


# --------------------------------------------------------------------------- config / storage
def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception as e:  # keep running on a bad config
            print("WARNING: could not read config.json:", e)
    else:
        os.makedirs(os.path.dirname(os.path.abspath(CONFIG_PATH)), exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
    for k, env in (("host", "EHC_HOST"), ("port", "EHC_PORT"), ("data_dir", "EHC_DATA_DIR")):
        if os.environ.get(env):
            cfg[k] = int(os.environ[env]) if k == "port" else os.environ[env]
    if os.environ.get("EHC_NO_BROWSER"):
        cfg["open_browser"] = False
    return cfg


CFG = load_config()
DATA_DIR = CFG["data_dir"] if os.path.isabs(CFG["data_dir"]) else os.path.join(HOME_DIR, CFG["data_dir"])
DB_PATH = os.path.join(DATA_DIR, "contacts.json")
GEO_PATH = os.path.join(DATA_DIR, "geocache.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
IMAGE_DIR = os.path.join(DATA_DIR, "images")
TILE_DIR = os.path.join(DATA_DIR, "tiles")
os.makedirs(BACKUP_DIR, exist_ok=True)

# --------------------------------------------------------------------------- demo mode
# The demo uses its own folder (data/demo) with made-up people, so it can be shown to anyone.
# The real data is never touched while the demo is on, and stays locked if it is encrypted.
DEMO_SEED = os.path.join(BASE, "demo", "demo-data.json")
DEMO_DIR = os.path.join(DATA_DIR, "demo")
MODE_PATH = os.path.join(DATA_DIR, "mode.json")
REAL_PATHS = {"DB_PATH": DB_PATH, "GEO_PATH": GEO_PATH, "BACKUP_DIR": BACKUP_DIR, "IMAGE_DIR": IMAGE_DIR}
DEMO_PATHS = {"DB_PATH": os.path.join(DEMO_DIR, "contacts.json"), "GEO_PATH": os.path.join(DEMO_DIR, "geocache.json"),
              "BACKUP_DIR": os.path.join(DEMO_DIR, "backups"), "IMAGE_DIR": os.path.join(DEMO_DIR, "images")}
MODE = {"demo": False}


def _use_paths(demo):
    g = globals()
    g.update(DEMO_PATHS if demo else REAL_PATHS)
    os.makedirs(g["BACKUP_DIR"], exist_ok=True)


def _is_demo_path(path):
    return os.path.abspath(path).startswith(os.path.abspath(DEMO_DIR) + os.sep)


def _save_mode():
    tmp = MODE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"demo": MODE["demo"]}, f)
    os.replace(tmp, MODE_PATH)


def _initial_demo():
    """A brand-new system starts in demo mode; an existing one keeps whatever was chosen last."""
    if os.path.exists(MODE_PATH):
        try:
            with open(MODE_PATH, "r", encoding="utf-8") as f:
                return bool(json.load(f).get("demo"))
        except Exception:
            return False
    if os.path.exists(os.path.join(DATA_DIR, "vault.json")):
        return False
    try:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            return not json.load(f).get("contacts")
    except FileNotFoundError:
        return True
    except Exception:
        return False


def _install_demo_data(overwrite=False):
    os.makedirs(os.path.join(DEMO_DIR, "backups"), exist_ok=True)
    target = DEMO_PATHS["DB_PATH"]
    if overwrite or not os.path.exists(target):
        if not os.path.exists(DEMO_SEED):
            raise ValueError("The demo data file (demo/demo-data.json) is missing")
        import shutil
        shutil.copyfile(DEMO_SEED, target + ".tmp")
        os.replace(target + ".tmp", target)


MODE["demo"] = DEMO_SEED and os.path.exists(DEMO_SEED) and _initial_demo()
if MODE["demo"]:
    _install_demo_data()
    _use_paths(True)
_save_mode()


# --------------------------------------------------------------------------- encryption at rest
# Files in the data folder can be encrypted with a key derived from a passphrase.
#   key derivation: PBKDF2-HMAC-SHA256 (600,000 rounds, random 16-byte salt) -> 64 bytes
#   cipher:         ChaCha20 (RFC 8439), random 12-byte nonce per file
#   integrity:      HMAC-SHA256 over header + nonce + ciphertext (encrypt-then-MAC)
# Only the standard library is used, so nothing extra has to be installed.
import hashlib
import hmac as _hmac
import secrets
import struct

VAULT_PATH = os.path.join(DATA_DIR, "vault.json")
ENC_MAGIC = b"EHCENC1\n"
KDF_ROUNDS = 600000
_KEY = {"enc": None, "mac": None}
_VAULT = {"info": None, "last_activity": time.time()}


class Locked(Exception):
    pass


def _chacha20_xor(key, nonce, data, counter=1):
    """ChaCha20 stream cipher (RFC 8439): XOR data with the keystream."""
    k = struct.unpack("<8I", key)
    n = struct.unpack("<3I", nonce)
    out = bytearray()
    M = 0xffffffff
    for off in range(0, len(data), 64):
        st = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, *k, counter & M, *n]
        x = st[:]
        for _ in range(10):
            for a, b, c, d in ((0, 4, 8, 12), (1, 5, 9, 13), (2, 6, 10, 14), (3, 7, 11, 15),
                               (0, 5, 10, 15), (1, 6, 11, 12), (2, 7, 8, 13), (3, 4, 9, 14)):
                x[a] = (x[a] + x[b]) & M; x[d] ^= x[a]; x[d] = ((x[d] << 16) | (x[d] >> 16)) & M
                x[c] = (x[c] + x[d]) & M; x[b] ^= x[c]; x[b] = ((x[b] << 12) | (x[b] >> 20)) & M
                x[a] = (x[a] + x[b]) & M; x[d] ^= x[a]; x[d] = ((x[d] << 8) | (x[d] >> 24)) & M
                x[c] = (x[c] + x[d]) & M; x[b] ^= x[c]; x[b] = ((x[b] << 7) | (x[b] >> 25)) & M
        ks = struct.pack("<16I", *[(x[i] + st[i]) & M for i in range(16)])
        chunk = data[off:off + 64]
        out += (int.from_bytes(chunk, "little") ^ int.from_bytes(ks[:len(chunk)], "little")).to_bytes(len(chunk), "little")
        counter += 1
    return bytes(out)


def _derive(passphrase, salt, rounds=KDF_ROUNDS):
    k = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, rounds, dklen=64)
    return k[:32], k[32:]


def _encrypt(plain, enc=None, mac=None):
    enc, mac = enc or _KEY["enc"], mac or _KEY["mac"]
    nonce = secrets.token_bytes(12)
    ct = _chacha20_xor(enc, nonce, plain)
    tag = _hmac.new(mac, ENC_MAGIC + nonce + ct, hashlib.sha256).digest()
    return ENC_MAGIC + nonce + ct + tag


def _decrypt(blob, enc=None, mac=None):
    enc, mac = enc or _KEY["enc"], mac or _KEY["mac"]
    if enc is None:
        raise Locked()
    nonce, ct, tag = blob[len(ENC_MAGIC):len(ENC_MAGIC) + 12], blob[len(ENC_MAGIC) + 12:-32], blob[-32:]
    if not _hmac.compare_digest(tag, _hmac.new(mac, ENC_MAGIC + nonce + ct, hashlib.sha256).digest()):
        raise ValueError("A data file could not be decrypted - it may be damaged or the passphrase is wrong")
    return _chacha20_xor(enc, nonce, ct)


def encryption_on():
    return _VAULT["info"] is not None


def is_locked():
    return encryption_on() and _KEY["enc"] is None


def _read_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "rb") as f:
        raw = f.read()
    if raw.startswith(ENC_MAGIC):
        raw = _decrypt(raw)
    return json.loads(raw.decode("utf-8-sig"))


def _write_json(path, obj):
    data = json.dumps(obj, indent=1, ensure_ascii=False).encode("utf-8")
    if encryption_on() and os.path.abspath(path) != os.path.abspath(VAULT_PATH) and not _is_demo_path(path):
        if _KEY["enc"] is None:
            raise Locked()
        data = _encrypt(data)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _plain_read(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


_VAULT["info"] = _plain_read(VAULT_PATH) if os.path.exists(VAULT_PATH) else None
EMPTY_DB = {"version": SCHEMA_VERSION, "contacts": {}, "uploads": []}


class NewerDataError(ValueError):
    pass


# Changes to the layout of contacts.json: {old version: function that upgrades DB in place to old version + 1}
MIGRATIONS = {}


def upgrade_db(db, path_hint=""):
    """Bring data saved by an older version up to date. Refuses data saved by a newer version."""
    v = int(db.get("version") or 1)
    if v > SCHEMA_VERSION:
        raise NewerDataError("This data was saved by a newer version of Emergency Hub Coordinator. "
                             "Install that version (or newer) to open it.")
    return v < SCHEMA_VERSION
if encryption_on() and not MODE["demo"]:
    DB = copy.deepcopy(EMPTY_DB)       # loaded when the passphrase is entered
    GEOCACHE = {}
else:
    DB = _read_json(DB_PATH, copy.deepcopy(EMPTY_DB))
    GEOCACHE = _read_json(GEO_PATH, {})
_PENDING_UPGRADE = {"needed": False}


def apply_upgrades():
    """Run any data upgrades for the data currently loaded (called once it can be read)."""
    if not DB.get("contacts") and not DB.get("uploads"):
        DB["version"] = SCHEMA_VERSION
        return
    if upgrade_db(DB):
        backup_db("before-upgrade-to-%s" % APP_VERSION)
        v = int(DB.get("version") or 1)
        while v < SCHEMA_VERSION:
            MIGRATIONS[v](DB)
            v += 1
            DB["version"] = v
        save_db()


def save_db():
    _write_json(DB_PATH, DB)


def save_geocache():
    _write_json(GEO_PATH, GEOCACHE)


def backup_db(tag):
    if not DB["contacts"]:
        return
    name = "contacts-%s-%s.json" % (datetime.now().strftime("%Y%m%d-%H%M%S"), tag)
    _write_json(os.path.join(BACKUP_DIR, name), DB)
    files = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith("contacts-"))
    for old in files[:-30]:
        try:
            os.remove(os.path.join(BACKUP_DIR, old))
        except OSError:
            pass


# --------------------------------------------------------------------------- helpers
def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def digits(s):
    return re.sub(r"\D", "", s or "")


def norm_postcode(pc):
    return re.sub(r"[^A-Z0-9]", "", (pc or "").upper())


def pretty_postcode(pc):
    p = norm_postcode(pc)
    return p[:-3] + " " + p[-3:] if len(p) > 3 else p


ADDR_ABBR = {"road": "rd", "street": "st", "avenue": "ave", "lane": "ln", "close": "cl", "drive": "dr",
             "crescent": "cres", "court": "ct", "place": "pl", "gardens": "gdns", "terrace": "ter",
             "square": "sq", "flat": "flat", "apartment": "flat", "apt": "flat"}


def addr_norm(s):
    return "".join(ADDR_ABBR.get(w, w) for w in re.findall(r"[a-z0-9]+", (s or "").lower()))


def household_key(c):
    """People with exactly the same address (ignoring case, punctuation and Road/Rd etc.) share a household."""
    a1, a2 = addr_norm(c.get("address1")), addr_norm(c.get("address2"))
    area = norm_postcode(c.get("postcode")) or addr_norm(c.get("town"))
    if not (a1 or a2) or not area:
        return "p:" + c["id"]
    return "h:%s|%s|%s" % (a1, a2, area)


def full_name(c):
    return ("%s %s" % (c.get("first_name", ""), c.get("last_name", ""))).strip() or "(no name)"


def haversine_km(a_lat, a_lon, b_lat, b_lon):
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def located(c):
    return c.get("lat") is not None and c.get("lon") is not None


def http_json(url, data=None, timeout=20):
    body = None
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# --------------------------------------------------------------------------- geocoding
class GeoNetworkError(Exception):
    pass


def lookup_postcodes(pcs):
    """Bulk-lookup normalised UK postcodes via postcodes.io. Fills GEOCACHE.
    Raises GeoNetworkError if the service can't be reached."""
    todo = sorted({p for p in pcs if ("pc:" + p) not in GEOCACHE})
    for i in range(0, len(todo), 100):
        chunk = todo[i:i + 100]
        try:
            res = http_json("https://api.postcodes.io/postcodes", {"postcodes": chunk})
        except Exception as e:
            raise GeoNetworkError(str(e))
        for item in res.get("result", []):
            q = norm_postcode(item.get("query"))
            r = item.get("result")
            GEOCACHE["pc:" + q] = [r["latitude"], r["longitude"]] if r and r.get("latitude") is not None else None
    # Postcodes that no longer exist: try the terminated-postcode register
    for p in todo:
        if GEOCACHE.get("pc:" + p) is None and ("pct:" + p) not in GEOCACHE:
            try:
                res = http_json("https://api.postcodes.io/terminated_postcodes/" + urllib.parse.quote(p))
                r = res.get("result") or {}
                GEOCACHE["pct:" + p] = [r["latitude"], r["longitude"]] if r.get("latitude") is not None else None
            except urllib.error.HTTPError:
                GEOCACHE["pct:" + p] = None
            except Exception as e:
                raise GeoNetworkError(str(e))
    save_geocache()


_last_nominatim = [0.0]


def lookup_address(c, uk):
    parts = [c.get(k, "").strip() for k in ("address1", "address2", "town", "county")]
    if POSTCODE_RE.match(norm_postcode(c.get("postcode"))):
        parts.append(pretty_postcode(c.get("postcode")))
    parts = [p for p in parts if p]
    # Only try when there is a real-looking street and a town
    if not (re.search(r"[A-Za-z]{3,}", c.get("address1", "")) and re.search(r"[A-Za-z]{3,}", c.get("town", ""))):
        return None
    country = c.get("country", "").strip() or "United Kingdom"
    q = ", ".join(parts + [country])
    key = "addr:" + q.lower()
    if key in GEOCACHE:
        return GEOCACHE[key]
    wait = 1.1 - (time.time() - _last_nominatim[0])
    if wait > 0:
        time.sleep(wait)
    params = {"q": q, "format": "json", "limit": 1}
    if uk:
        params["countrycodes"] = "gb"
    try:
        res = http_json("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params))
    except Exception as e:
        raise GeoNetworkError(str(e))
    finally:
        _last_nominatim[0] = time.time()
    val = [float(res[0]["lat"]), float(res[0]["lon"])] if res else None
    GEOCACHE[key] = val
    save_geocache()
    return val


def geocode_contacts(contacts):
    """Set lat/lon/geo on each contact dict in the list."""
    pcs = []
    for c in contacts:
        pc = norm_postcode(c.get("postcode"))
        if POSTCODE_RE.match(pc) and norm(c.get("country")) in UK_COUNTRIES:
            pcs.append(pc)
    network_error = None
    try:
        lookup_postcodes(pcs)
    except GeoNetworkError as e:
        network_error = e

    for c in contacts:
        c["lat"] = c["lon"] = None
        uk = norm(c.get("country")) in UK_COUNTRIES
        pc = norm_postcode(c.get("postcode"))
        reason = None
        if not uk:
            reason = "Address is outside the UK (%s)" % c.get("country")
        elif not pc:
            reason = "No postcode"
        elif not POSTCODE_RE.match(pc):
            reason = "Postcode '%s' is not a valid UK postcode" % c.get("postcode", "").strip()
        else:
            hit = GEOCACHE.get("pc:" + pc)
            if hit is None:
                hit = GEOCACHE.get("pct:" + pc)
                if hit:
                    c["lat"], c["lon"] = hit
                    c["geo"] = {"status": "ok", "source": "postcode",
                                "note": "Postcode %s has been retired - located using its old position" % pretty_postcode(pc)}
                    continue
            else:
                c["lat"], c["lon"] = hit
                c["geo"] = {"status": "ok", "source": "postcode", "note": ""}
                continue
            if ("pc:" + pc) not in GEOCACHE:
                reason = "Could not reach the postcode service - try 'Retry locating' later"
            else:
                reason = "Postcode %s was not recognised" % pretty_postcode(pc)

        if CFG.get("address_fallback") and network_error is None:
            try:
                hit = lookup_address(c, uk)
            except GeoNetworkError:
                hit = None
            if hit:
                c["lat"], c["lon"] = hit
                c["geo"] = {"status": "approx", "source": "address",
                            "note": reason + " - position estimated from the street address, please check"}
                continue
        if not any(c.get(k, "").strip() for k in ("address1", "address2", "town", "postcode")):
            reason = "No address"
        elif not c.get("address1", "").strip() and reason in ("No postcode",):
            reason = "Incomplete address (no street or postcode)"
        c["geo"] = {"status": "none", "source": "", "note": reason}


DEFAULT_SETTINGS = {
    "status_colors": {"leader": "#7B2CBF", "small_group_leader": "#1D6FD8", "vulnerable": "#D62828",
                      "single": "#F28C28", "hub_coordinator": "#1A9E77", "none": "#8C8C8C"},
    "dot_size": 16,
    "centre_line_color": "#1D2330",
    "centre_line_width": 3.5,
    "spoke_width": 1.6,
    "spoke_manual_width": 2.2,
    "spoke_opacity": 0.7,
    "spoke_color_mode": "per_hub",      # "per_hub" or "single"
    "spoke_color": "#1A9E77",
    "hub_palette": ["#1A9E77", "#E7298A", "#1F78B4", "#D95F02", "#66A61E", "#7570B3",
                    "#E6AB02", "#A6761D", "#17BECF", "#BC3F8F", "#386CB0", "#8C564B"],
    "org_name": "",
    "show_org_name": True,
    "show_org_logo": True,
    "theme": "light",                   # interface: "light" or "dark"
    "map_theme": "auto",                # map: "auto" (same as the interface), "light" or "dark"
    "centre_color": "#1D2330",          # circle colour of the central hub marker
    "centre_symbol": "star",            # "star", "org_logo" or "image"
    "centre_star_color": "#FFD400",
    "centre_size": 34,
    "statuses": [{"key": k, "label": l} for k, l in STATUSES],   # in priority order (highest first)
    "accent_color": "#23395D",          # title bar, window headings and sidebar cards
    "auto_lock_minutes": 30,            # with encryption on: lock after this long unused (0 = never)
    "dp_lead_name": "",                 # data protection lead, used in the Data Protection Pack
    "dp_lead_contact": "",
    "grouping_levels": 1,               # how many layers of hub coordinators
    "subhub_line_width": 2.5,           # line from a hub coordinator to a hub coordinator in their group
}
MAX_LEVELS = 5
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def current_settings():
    out = copy.deepcopy(DEFAULT_SETTINGS)
    saved = DB.get("settings") or {}
    for k, v in saved.items():
        if k == "status_colors" and isinstance(v, dict):
            out[k].update(v)
        elif k in out:
            out[k] = v
    if not any(x.get("key") == "hub_coordinator" for x in out["statuses"]):
        out["statuses"].append({"key": "hub_coordinator", "label": "Hub Coordinator"})
    for x in out["statuses"]:
        out["status_colors"].setdefault(x["key"], "#8C8C8C")
    return out


def status_list():
    """[(key, label)] in priority order, highest first."""
    return [(x["key"], x["label"]) for x in current_settings()["statuses"]]


def status_keys():
    return [k for k, _ in status_list()]


def clean_settings(new):
    """Validate settings sent from the Settings page."""
    s = current_settings()

    def colour(v, name):
        if not isinstance(v, str) or not HEX_RE.match(v):
            raise ValueError("%s must be a colour like #1A9E77" % name)
        return v.upper()

    def number(v, name, lo, hi):
        try:
            f = float(v)
        except (TypeError, ValueError):
            raise ValueError("%s must be a number" % name)
        if not lo <= f <= hi:
            raise ValueError("%s must be between %s and %s" % (name, lo, hi))
        return round(f, 2)

    if "statuses" in new:
        out, seen = [], set()
        for x in (new["statuses"] or [])[:15]:
            key = str((x or {}).get("key") or "").strip()
            label = str((x or {}).get("label") or "").strip()[:40]
            if not re.match(r"^[a-z0-9_]{1,40}$", key) or key in seen or key == "none":
                raise ValueError("Invalid status")
            if not label:
                raise ValueError("Every status needs a name")
            seen.add(key)
            out.append({"key": key, "label": label})
        if "hub_coordinator" not in seen:
            raise ValueError("The Hub Coordinator status can be renamed but not removed - the hub network depends on it")
        labels = [x["label"].lower() for x in out]
        if len(set(labels)) != len(labels):
            raise ValueError("Two statuses have the same name")
        s["statuses"] = out
    sc = new.get("status_colors", {})
    keys = [x["key"] for x in s["statuses"]] + ["none"]
    for k in keys:
        if k in sc:
            s["status_colors"][k] = colour(sc[k], "Status colour")
        s["status_colors"].setdefault(k, "#8C8C8C")
    s["status_colors"] = {k: s["status_colors"][k] for k in keys}
    if "accent_color" in new:
        s["accent_color"] = colour(new["accent_color"], "Accent colour")
    if "dot_size" in new:
        s["dot_size"] = int(number(new["dot_size"], "Dot size", 8, 32))
    if "centre_line_color" in new:
        s["centre_line_color"] = colour(new["centre_line_color"], "Centre line colour")
    for k, label in (("centre_line_width", "Centre line width"), ("spoke_width", "Line width"),
                     ("spoke_manual_width", "Chosen-hub line width")):
        if k in new:
            s[k] = number(new[k], label, 0.5, 12)
    if "spoke_opacity" in new:
        s["spoke_opacity"] = number(new["spoke_opacity"], "Line opacity", 0.1, 1)
    if new.get("spoke_color_mode") in ("per_hub", "single"):
        s["spoke_color_mode"] = new["spoke_color_mode"]
    if "spoke_color" in new:
        s["spoke_color"] = colour(new["spoke_color"], "Line colour")
    if "hub_palette" in new:
        pal = [colour(c, "Hub colour") for c in new["hub_palette"]][:24]
        if not pal:
            raise ValueError("At least one hub colour is needed")
        s["hub_palette"] = pal
    if "org_name" in new:
        s["org_name"] = str(new["org_name"] or "").strip()[:100]
    for k in ("show_org_name", "show_org_logo"):
        if k in new:
            s[k] = bool(new[k])
    if new.get("theme") in ("light", "dark"):
        s["theme"] = new["theme"]
    if new.get("map_theme") in ("auto", "light", "dark"):
        s["map_theme"] = new["map_theme"]
    if "centre_color" in new:
        s["centre_color"] = colour(new["centre_color"], "Central hub colour")
    if "centre_star_color" in new:
        s["centre_star_color"] = colour(new["centre_star_color"], "Star colour")
    if new.get("centre_symbol") in ("star", "org_logo", "image"):
        s["centre_symbol"] = new["centre_symbol"]
    if "grouping_levels" in new:
        s["grouping_levels"] = int(number(new["grouping_levels"], "Grouping levels", 1, MAX_LEVELS))
    if "subhub_line_width" in new:
        s["subhub_line_width"] = number(new["subhub_line_width"], "Hub-to-hub line width", 0.5, 12)
    if "auto_lock_minutes" in new:
        s["auto_lock_minutes"] = int(number(new["auto_lock_minutes"], "Auto-lock time", 0, 1440))
    for k, lim in (("dp_lead_name", 100), ("dp_lead_contact", 200)):
        if k in new:
            s[k] = str(new[k] or "").strip()[:lim]
    if "centre_size" in new:
        s["centre_size"] = int(number(new["centre_size"], "Central hub size", 20, 80))
    return s


# --------------------------------------------------------------------------- uploaded images
IMAGE_KINDS = ("org_logo", "centre_image")
IMAGE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml"}


def sniff_image(raw):
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    head = raw[:2048].lstrip().lower()
    if (head.startswith(b"<?xml") or head.startswith(b"<svg") or head.startswith(b"<!--")) and b"<svg" in raw[:4096].lower():
        return "svg"
    return None


def save_image(kind, raw):
    if kind not in IMAGE_KINDS:
        raise ValueError("Unknown image")
    if not raw:
        raise ValueError("The file is empty")
    if len(raw) > 3 * 1024 * 1024:
        raise ValueError("Please use an image smaller than 3 MB")
    ext = sniff_image(raw)
    if not ext:
        raise ValueError("Please choose a PNG, JPG, GIF, WebP or SVG image")
    with LOCK:
        os.makedirs(IMAGE_DIR, exist_ok=True)
        remove_image(kind, save=False)
        with open(os.path.join(IMAGE_DIR, "%s.%s" % (kind, ext)), "wb") as f:
            f.write(raw)
        DB.setdefault("images", {})[kind] = {"ext": ext, "v": int(time.time())}
        save_db()
        refresh_vault_branding()


def remove_image(kind, save=True):
    with LOCK:
        info = DB.get("images", {}).pop(kind, None)
        if info:
            try:
                os.remove(os.path.join(IMAGE_DIR, "%s.%s" % (kind, info["ext"])))
            except OSError:
                pass
        if save:
            save_db()
            refresh_vault_branding()


def image_urls():
    out = {}
    for kind in IMAGE_KINDS:
        info = DB.get("images", {}).get(kind)
        ok = info and os.path.exists(os.path.join(IMAGE_DIR, "%s.%s" % (kind, info["ext"])))
        out[kind] = "/api/image/%s?v=%s" % (kind, info["v"]) if ok else None
    return out


def lookup_one_postcode(pc_raw):
    pc = norm_postcode(pc_raw)
    if not POSTCODE_RE.match(pc):
        raise ValueError("'%s' is not a valid UK postcode" % pc_raw)
    try:
        lookup_postcodes([pc])
    except GeoNetworkError:
        raise ValueError("Could not reach the postcode service - enter the position by hand or pick it on the map")
    hit = GEOCACHE.get("pc:" + pc) or GEOCACHE.get("pct:" + pc)
    if not hit:
        raise ValueError("Postcode %s was not found" % pretty_postcode(pc))
    return pc, hit


def save_settings(body):
    with LOCK:
        if "settings" in body:
            before = set(status_keys())
            DB["settings"] = clean_settings(body["settings"] or {})
            removed = before - set(status_keys())
            if removed:      # a status was deleted: take it off everyone who had it
                for ct in DB["contacts"].values():
                    ct["statuses"] = [x for x in ct.get("statuses", []) if x not in removed]
        c = body.get("centre")
        if c:
            name = str(c.get("name") or "").strip()[:80]
            if not name:
                raise ValueError("The central hub needs a name")
            pc = norm_postcode(c.get("postcode"))
            lat, lon = c.get("lat"), c.get("lon")
            if lat in (None, "") or lon in (None, ""):
                if not pc:
                    raise ValueError("Give the central hub a postcode or a position")
                pc, (lat, lon) = lookup_one_postcode(pc)
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                raise ValueError("Latitude and longitude must be numbers")
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError("That position is not on the map")
            old = DB.get("centre") or {}
            contact = {}
            for k, lim in (("landline", 40), ("mobile", 40), ("email", 120), ("other", 1000)):
                contact[k] = str(c.get(k, old.get(k, "")) or "").strip()[:lim]
            if contact["email"] and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", contact["email"]):
                raise ValueError("The central hub email address doesn't look right")
            DB["centre"] = {"name": name, "postcode": pc, "postcode_display": pretty_postcode(pc) if pc else "",
                            "lat": lat, "lon": lon, **contact}
        save_db()
        refresh_vault_branding()


def ensure_centre():
    """Set up the central hub from config.json the first time; afterwards it is changed on the Settings page."""
    if DB.get("centre"):
        return
    pc = norm_postcode(CFG.get("centre_postcode") or "")
    lat, lon = CFG.get("centre_lat"), CFG.get("centre_lon")
    if pc:
        try:
            lookup_postcodes([pc])
            if GEOCACHE.get("pc:" + pc):
                lat, lon = GEOCACHE["pc:" + pc]
        except GeoNetworkError:
            pass
    DB["centre"] = {"name": CFG.get("centre_name") or "Our church", "postcode": pc,
                    "postcode_display": pretty_postcode(pc) if pc else "", "lat": lat, "lon": lon}
    save_db()


# --------------------------------------------------------------------------- hub assignment
def grouping_levels():
    try:
        return max(1, min(MAX_LEVELS, int(current_settings().get("grouping_levels", 1))))
    except (TypeError, ValueError):
        return 1


def compute_hubs(contacts):
    """Works out who reports to whom.

    Returns {contact_id: {"hub": id|None, "auto": bool, "km": float|None, "level": int|None}}.
    - Everyone who is not a hub coordinator joins the nearest hub coordinator of any level
      (or the one chosen by hand on their card).
    - With more than one grouping level, a level-N hub coordinator (N > 1) belongs to the
      group of the nearest level N-1 hub coordinator (or one chosen by hand with a lower level).
      Level-1 hub coordinators report to the central hub.
    """
    max_level = grouping_levels()
    is_hub = lambda c: "hub_coordinator" in c.get("statuses", [])

    def level(c):
        try:
            return max(1, min(max_level, int(c.get("hub_level") or 1)))
        except (TypeError, ValueError):
            return 1

    def dist(a, b):
        return haversine_km(a["lat"], a["lon"], b["lat"], b["lon"]) if located(a) and located(b) else None

    hubs = [c for c in contacts.values() if is_hub(c)]
    located_hubs = [h for h in hubs if located(h)]
    out = {}
    for c in contacts.values():
        if is_hub(c):
            my = level(c)
            res = {"hub": None, "auto": True, "km": None, "level": my}
            if my > 1:
                ov = c.get("hub_override")
                if ov and ov != c["id"] and ov in contacts and is_hub(contacts[ov]) and level(contacts[ov]) < my:
                    res.update(hub=ov, auto=False, km=dist(c, contacts[ov]))
                elif located(c):
                    cands = [h for h in located_hubs if h["id"] != c["id"] and level(h) == my - 1] or \
                            [h for h in located_hubs if h["id"] != c["id"] and level(h) < my]
                    if cands:
                        best = min(cands, key=lambda h: dist(c, h))
                        res.update(hub=best["id"], km=dist(c, best))
            out[c["id"]] = res
            continue
        ov = c.get("hub_override")
        if ov and ov in contacts and "hub_coordinator" in contacts[ov].get("statuses", []):
            h = contacts[ov]
            km = haversine_km(c["lat"], c["lon"], h["lat"], h["lon"]) if located(c) and located(h) else None
            out[c["id"]] = {"hub": ov, "auto": False, "km": km, "level": None}
        elif located(c) and located_hubs:
            best = min(located_hubs, key=lambda h: haversine_km(c["lat"], c["lon"], h["lat"], h["lon"]))
            out[c["id"]] = {"hub": best["id"], "auto": True,
                            "km": haversine_km(c["lat"], c["lon"], best["lat"], best["lon"]), "level": None}
        else:
            out[c["id"]] = {"hub": None, "auto": True, "km": None, "level": None}
    return out


CALLSHEET_FIELDS = ("first_name", "last_name", "telephone", "mobile", "address1", "address2", "town",
                    "postcode", "statuses", "notes", "hub", "hub_level")


def callsheet_fingerprint(lst, centre):
    """A hash of everything that appears on the printed call lists, so we can tell when they go out of date."""
    rows = sorted([[str(d.get("id"))] + [d.get(k) for k in CALLSHEET_FIELDS] for d in lst], key=lambda r: r[0])
    cen = {k: (centre or {}).get(k) for k in ("name", "landline", "mobile", "email", "other")}
    blob = json.dumps({"c": rows, "centre": cen, "s": status_list()}, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def confirm_calls_printed():
    with LOCK:
        st = public_state()
        DB["calls_printed"] = {"at": datetime.now().isoformat(timespec="seconds"),
                               "fp": callsheet_fingerprint(st["contacts"], st["centre"])}
        save_db()
        return public_state()


def public_state():
    contacts = DB["contacts"]
    hubs = compute_hubs(contacts)
    centre = DB.get("centre", {})
    lst = []
    for c in contacts.values():
        d = {k: c.get(k, "") for k, _ in FIELDS}
        d.update({
            "id": c["id"], "statuses": c.get("statuses", []), "notes": c.get("notes", ""),
            "hub_override": c.get("hub_override"), "lat": c.get("lat"), "lon": c.get("lon"),
            "household": household_key(c),
            "geo": c.get("geo", {"status": "none", "note": "Not yet located"}),
            "hub": hubs[c["id"]]["hub"], "hub_auto": hubs[c["id"]]["auto"], "hub_km": hubs[c["id"]]["km"],
            "hub_level": hubs[c["id"]]["level"],
            "centre_km": haversine_km(c["lat"], c["lon"], centre["lat"], centre["lon"])
            if located(c) and centre and centre.get("lat") is not None else None,
        })
        lst.append(d)
    lst.sort(key=lambda d: (norm(d["last_name"]), norm(d["first_name"])))
    last = DB["uploads"][-1] if DB["uploads"] else None
    cp = DB.get("calls_printed") or None
    return {
        "demo": MODE["demo"],
        "calls_printed": {"at": cp["at"], "changed": cp.get("fp") != callsheet_fingerprint(lst, centre)} if cp else None,
        "centre": centre,
        "statuses": [{"key": k, "label": l} for k, l in status_list()],
        "contacts": lst,
        "last_upload": {"id": last["id"], "timestamp": last["timestamp"], "filename": last["filename"]} if last else None,
        "upload_count": len(DB["uploads"]),
        "settings": current_settings(),
        "default_settings": DEFAULT_SETTINGS,
        "app_version": APP_VERSION,
        "update": update_public(),
        "images": image_urls(),
        "churchsuite": cs_public(),
        "security": security_state(),
    }


# --------------------------------------------------------------------------- CSV import
def decode_bytes(raw):
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_csv(raw):
    text = decode_bytes(raw)
    sample = text[:5000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    rows = list(reader)
    if not rows:
        raise ValueError("The file is empty.")
    header = rows[0]
    mapping = {}
    for i, h in enumerate(header):
        f = HEADER_ALIASES.get(norm(h))
        if f and f not in mapping.values():
            mapping[i] = f
    missing = [FIELD_LABEL[f] for f in ("first_name", "last_name") if f not in mapping.values()]
    if missing:
        raise ValueError("Could not find column(s): %s. Columns found: %s" % (", ".join(missing), ", ".join(header)))
    unmapped = [FIELD_LABEL[f] for f, _ in FIELDS if f not in mapping.values()]
    out, blank = [], 0
    for r in rows[1:]:
        d = {f: "" for f, _ in FIELDS}
        for i, f in mapping.items():
            if i < len(r):
                d[f] = (r[i] or "").strip()
        if not d["first_name"] and not d["last_name"]:
            if any(v for v in d.values()):
                blank += 1
            continue
        out.append(d)
    return out, blank, unmapped


def name_key(d):
    return norm(d["first_name"]) + "|" + norm(d["last_name"])


def process_upload(raw, filename):
    rows, blank, unmapped = parse_csv(raw)
    if not rows:
        raise ValueError("No people found in the file.")
    warnings = []
    if unmapped:
        warnings.append("Columns not found in this file (left blank): " + ", ".join(unmapped))
    if blank:
        warnings.append("%d row(s) had no first or last name and were skipped" % blank)
    return import_rows(rows, filename, warnings)


class NeedsConfirm(Exception):
    """Raised when an import would remove a large share of the current contacts."""
    def __init__(self, removing, keeping, adding):
        super().__init__("confirm")
        self.removing, self.keeping, self.adding = removing, keeping, adding


def import_rows(rows, source, warnings, guard_removals=False):
    """Treat `rows` as the complete, current list of people.

    Each row is a dict of the FIELDS, optionally with "_ext": {"cs_id": .., "lat": .., "lon": ..}
    from a connected system such as ChurchSuite."""

    # Unique keys within this file (duplicate names are told apart by postcode/email)
    counts = {}
    for d in rows:
        counts[name_key(d)] = counts.get(name_key(d), 0) + 1
    seen = {}
    for d in rows:
        base = name_key(d)
        key = base
        if counts[base] > 1:
            key = base + "|" + (norm(d["postcode"]) or norm(d["email"]) or "x")
            n = seen.get(key, 0)
            seen[key] = n + 1
            if n:
                key += "|%d" % n
            if n == 0 and seen.get("_warned_" + base) is None:
                seen["_warned_" + base] = True
                warnings.append("%s %s appears %d times - told apart by postcode/email"
                                % (d["first_name"], d["last_name"], counts[base]))
        d["_key"] = key

    with LOCK:
        old_contacts = copy.deepcopy(DB["contacts"])
        old_hubs = compute_hubs(old_contacts)

        existing_by_key = {c["key"]: c["id"] for c in old_contacts.values()}
        matched = {}  # new row index -> old id
        unmatched_old = set(old_contacts)
        # Pass 0: the connected system's own record ID (most reliable)
        by_cs = {c["cs_id"]: c["id"] for c in old_contacts.values() if c.get("cs_id")}
        for i, d in enumerate(rows):
            cs = (d.get("_ext") or {}).get("cs_id")
            cid = by_cs.get(cs) if cs else None
            if cid in unmatched_old:
                matched[i] = cid
                unmatched_old.discard(cid)
        # Pass 1: exact key
        for i, d in enumerate(rows):
            if i in matched:
                continue
            cid = existing_by_key.get(d["_key"])
            if cid in unmatched_old:
                matched[i] = cid
                unmatched_old.discard(cid)
        # Pass 2: same name (keys may differ because duplicates resolved differently)
        for i, d in enumerate(rows):
            if i in matched:
                continue
            cands = [cid for cid in unmatched_old if old_contacts[cid]["key"].split("|")[:2] == d["_key"].split("|")[:2]]
            if len(cands) == 1:
                matched[i] = cands[0]
                unmatched_old.discard(cands[0])
        # Pass 3: name change (same first name + same email or mobile)
        for i, d in enumerate(rows):
            if i in matched:
                continue
            for cid in list(unmatched_old):
                o = old_contacts[cid]
                if norm(o.get("first_name")) != norm(d["first_name"]):
                    continue
                if (d["email"] and norm(o.get("email")) == norm(d["email"])) or \
                   (digits(d["mobile"]) and digits(o.get("mobile")) == digits(d["mobile"])):
                    matched[i] = cid
                    unmatched_old.discard(cid)
                    break

        if guard_removals and old_contacts:
            removing = len(unmatched_old)
            if removing > max(5, 0.3 * len(old_contacts)):
                raise NeedsConfirm(removing, len(old_contacts) - removing, len(rows) - len(matched))
        backup_db("before-import")

        def use_ext_position(c, ext, addr_changed):
            """Use coordinates supplied by the connected system, unless the pin was placed by hand."""
            lat, lon = ext.get("lat"), ext.get("lon")
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                return False
            if (lat == 0 and lon == 0) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                return False
            if c.get("geo", {}).get("status") == "manual" and not addr_changed:
                return True
            c["lat"], c["lon"] = lat, lon
            c["geo"] = {"status": "ok", "source": "churchsuite", "note": ""}
            return True

        now = datetime.now().isoformat(timespec="seconds")
        new_contacts, to_geocode = {}, []
        added_ids, updated = [], []
        for i, d in enumerate(rows):
            key = d.pop("_key")
            ext = d.pop("_ext", None) or {}
            if i in matched:
                c = copy.deepcopy(old_contacts[matched[i]])
                changes = []
                for f, label in FIELDS:
                    if (c.get(f) or "") != d[f]:
                        changes.append({"field": label, "old": c.get(f) or "", "new": d[f]})
                addr_changed = any((c.get(f) or "") != d[f] for f in ADDRESS_FIELDS)
                c.update(d)
                c["key"] = key
                if ext.get("cs_id"):
                    c["cs_id"] = ext["cs_id"]
                if changes:
                    c["updated_at"] = now
                    updated.append({"id": c["id"], "name": full_name(c), "changes": changes})
                if use_ext_position(c, ext, addr_changed):
                    pass
                elif addr_changed or c.get("geo", {}).get("status") not in ("ok", "manual"):
                    to_geocode.append(c)
            else:
                c = dict(d)
                c.update({"id": uuid.uuid4().hex[:12], "key": key, "statuses": [], "hub_override": None,
                          "notes": "", "added_at": now, "updated_at": now, "lat": None, "lon": None})
                if ext.get("cs_id"):
                    c["cs_id"] = ext["cs_id"]
                added_ids.append(c["id"])
                if not use_ext_position(c, ext, True):
                    to_geocode.append(c)
            new_contacts[c["id"]] = c

        geocode_contacts(to_geocode)

        removed = []
        for cid in unmatched_old:
            o = old_contacts[cid]
            removed.append({"name": full_name(o), "statuses": o.get("statuses", []),
                            "address": ", ".join(o.get(k, "") for k in ("address1", "town", "postcode") if o.get(k)),
                            "assigned_count": sum(1 for h in old_hubs.values() if h["hub"] == cid)})

        # Clear overrides pointing at people who have gone
        hub_changes = []
        for c in new_contacts.values():
            if c.get("hub_override") and c["hub_override"] not in new_contacts:
                c["hub_override"] = None

        new_hubs = compute_hubs(new_contacts)

        def hub_name(cid, pool):
            return full_name(pool[cid]) if cid and cid in pool else None

        for cid, h in new_hubs.items():
            if cid in added_ids or cid not in old_hubs:
                continue
            before = old_hubs[cid]["hub"]
            if before != h["hub"]:
                if before and before not in new_contacts:
                    why = "Previous hub coordinator is no longer in the database"
                elif before is None:
                    why = "Now located on the map" if h["hub"] else ""
                elif h["hub"] is None:
                    why = "No longer located on the map"
                else:
                    why = "Address changed - a different hub coordinator is now nearest"
                hub_changes.append({"id": cid, "name": full_name(new_contacts[cid]),
                                    "old_hub": hub_name(before, old_contacts), "new_hub": hub_name(h["hub"], new_contacts),
                                    "why": why})

        added = []
        for cid in added_ids:
            c = new_contacts[cid]
            added.append({"id": cid, "name": full_name(c), "hub": hub_name(new_hubs[cid]["hub"], new_contacts),
                          "hub_km": new_hubs[cid]["km"], "located": c["geo"]["status"] != "none",
                          "note": c["geo"].get("note", "")})
        not_located = [{"id": c["id"], "name": full_name(c), "note": c["geo"].get("note", "")}
                       for c in new_contacts.values() if c["geo"]["status"] == "none"]
        approx = [{"id": c["id"], "name": full_name(c), "note": c["geo"].get("note", "")}
                  for c in new_contacts.values() if c["geo"]["status"] == "approx"]
        if not any("hub_coordinator" in c.get("statuses", []) for c in new_contacts.values()):
            warnings.append("No hub coordinators are set yet - tick 'Hub Coordinator' on people's contact cards")

        report = {
            "id": uuid.uuid4().hex[:10], "timestamp": now, "filename": source,
            "rows": len(rows), "before": len(old_contacts), "after": len(new_contacts),
            "added": sorted(added, key=lambda a: a["name"]),
            "removed": sorted(removed, key=lambda a: a["name"]),
            "updated": sorted(updated, key=lambda a: a["name"]),
            "hub_changes": sorted(hub_changes, key=lambda a: a["name"]),
            "not_located": sorted(not_located, key=lambda a: a["name"]),
            "approx": sorted(approx, key=lambda a: a["name"]),
            "warnings": warnings,
        }
        DB["contacts"] = new_contacts
        DB["uploads"].append(report)
        DB["uploads"] = DB["uploads"][-50:]
        save_db()
        return report


# --------------------------------------------------------------------------- ChurchSuite (API v2)
CS_TOKEN_URL = os.environ.get("EHC_CS_TOKEN_URL", "https://login.churchsuite.com/oauth2/token")
CS_API_URL = os.environ.get("EHC_CS_API_URL", "https://api.churchsuite.com/v2")
CS_PATH = os.path.join(DATA_DIR, "churchsuite.json")
_cs_token = {"value": None, "expires": 0, "key": None}


def cs_config():
    cfg = _read_json(CS_PATH, {})
    cfg.setdefault("client_id", "")
    cfg.setdefault("client_secret", "")
    cfg.setdefault("tags", ["Emergency Hub"])        # names (kept for display, and to find IDs the first time); the suggested opt-in tag
    cfg.setdefault("tag_ids", [])                     # the chosen tags, by ChurchSuite ID (survives renames)
    cfg.setdefault("catalog", [])                     # every tag in the ChurchSuite address book
    cfg.setdefault("catalog_updated", None)
    cfg.setdefault("last_sync", None)
    return cfg


def cs_public():
    if MODE["demo"]:        # the real connection details stay out of the demo
        return {"client_id": "", "has_secret": False, "configured": False, "tags": [], "tag_ids": [], "catalog": [],
                "catalog_updated": None, "last_sync": None}
    cfg = cs_config()
    return {"client_id": cfg["client_id"], "has_secret": bool(cfg["client_secret"]),
            "configured": bool(cfg["client_id"] and cfg["client_secret"] and (cfg["tag_ids"] or cfg["tags"])),
            "tags": cfg["tags"], "tag_ids": cfg["tag_ids"], "catalog": cfg["catalog"],
            "catalog_updated": cfg["catalog_updated"], "last_sync": cfg["last_sync"]}


def cs_save_config(body):
    with LOCK:
        cfg = cs_config()
        if body.get("remove"):
            cfg.update(client_id="", client_secret="", last_sync=None, catalog=[], catalog_updated=None)
        else:
            if "client_id" in body:
                if str(body["client_id"] or "").strip() != cfg["client_id"]:
                    cfg["catalog"], cfg["catalog_updated"] = [], None   # different account: forget its tag list
                cfg["client_id"] = str(body["client_id"] or "").strip()[:200]
            if body.get("client_secret"):
                cfg["client_secret"] = str(body["client_secret"]).strip()[:500]
            if "tag_ids" in body:
                ids = []
                for t in body["tag_ids"] or []:
                    try:
                        ids.append(int(t))
                    except (TypeError, ValueError):
                        raise ValueError("Unknown tag")
                known = {t["id"]: t["name"] for t in cfg["catalog"]}
                cfg["tag_ids"] = [i for i in dict.fromkeys(ids) if not known or i in known][:50]
                cfg["tags"] = [known.get(i, str(i)) for i in cfg["tag_ids"]]
        _write_json(CS_PATH, cfg)
        _cs_token["value"] = None
        return cs_public()


class CSError(ValueError):
    pass


def _cs_http(url, data=None, headers=None, timeout=30):
    """One HTTP call with friendly errors and a polite wait if ChurchSuite says we are going too fast."""
    for attempt in range(4):
        req = urllib.request.Request(url, data=data, headers=dict({"User-Agent": USER_AGENT, "Accept": "application/json"}, **(headers or {})))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code == 429 and attempt < 3:
                try:
                    wait = min(30, int(e.headers.get("Retry-After") or 5))
                except ValueError:
                    wait = 5
                time.sleep(wait)
                continue
            try:
                j = json.loads(body)
            except ValueError:
                j = {}
            err = j.get("error")
            msg = err.get("message") if isinstance(err, dict) else (j.get("error_description") or err)
            raise CSError("ChurchSuite said: %s (HTTP %s)" % (msg or e.reason, e.code), e.code)
        except urllib.error.URLError as e:
            raise CSError("Could not reach ChurchSuite - check this PC's internet connection (%s)" % e.reason)
    raise CSError("ChurchSuite is busy - please try again in a minute")


def cs_token():
    cfg = cs_config()
    if not (cfg["client_id"] and cfg["client_secret"]):
        raise CSError("Add the ChurchSuite Client ID and Client Secret in Settings first")
    key = (cfg["client_id"], cfg["client_secret"])
    if _cs_token["value"] and _cs_token["key"] == key and time.time() < _cs_token["expires"] - 60:
        return _cs_token["value"]
    import base64
    basic = base64.b64encode(("%s:%s" % key).encode()).decode()
    # Ask specifically for read access to the Address Book (a token without a scope may not be allowed to read it)
    scope = "addressbook.read"
    attempts = [
        ({"grant_type": "client_credentials", "scope": scope}, {"Authorization": "Basic " + basic}),
        ({"grant_type": "client_credentials", "scope": scope, "client_id": key[0], "client_secret": key[1]}, {}),
        ({"grant_type": "client_credentials"}, {"Authorization": "Basic " + basic}),
        ({"grant_type": "client_credentials", "client_id": key[0], "client_secret": key[1]}, {}),
    ]
    last = None
    for form, hdrs in attempts:
        hdrs = dict(hdrs, **{"Content-Type": "application/x-www-form-urlencoded"})
        try:
            res = _cs_http(CS_TOKEN_URL, urllib.parse.urlencode(form).encode(), hdrs)
        except CSError as e:
            last = e
            if len(e.args) > 1 and e.args[1] in (400, 401):
                continue
            raise
        if res.get("access_token"):
            _cs_token.update(value=res["access_token"], expires=time.time() + int(res.get("expires_in") or 3600), key=key)
            return _cs_token["value"]
    raise CSError("ChurchSuite did not accept the Client ID and Secret - check them in Settings. (%s)" % (last.args[0] if last else ""))


CS_WHAT = {"/addressbook/tags": "the list of tags", "/addressbook/tag_categories": "the tag categories",
           "/addressbook/contacts": "the contacts"}


def cs_get(path, params=None):
    q = ""
    if params:
        q = "?" + urllib.parse.urlencode(params, doseq=True)
    try:
        return _cs_http(CS_API_URL + path + q, headers={"Authorization": "Bearer " + cs_token()})
    except CSError as e:
        if len(e.args) > 1 and e.args[1] == 403:
            raise CSError("ChurchSuite refused to let the API user read %s (HTTP 403 - not enough permission). "
                          "In ChurchSuite, check that the API user has access to the Address Book module, "
                          "including viewing contacts and tags." % CS_WHAT.get(path, path), 403)
        raise


def cs_all(path, params):
    """Fetch every page of a list endpoint."""
    out, page = [], 1
    while True:
        res = cs_get(path, dict(params, page=page, per_page=250))
        out.extend(res.get("data") or [])
        nxt = (res.get("pagination") or {}).get("next_page")
        if not nxt or page >= 200:
            return out
        page = nxt


def cs_refresh_catalog():
    """Download the full list of tags (and their categories) from ChurchSuite and line up the chosen tags.

    Returns (cfg, chosen [{id,name,is_smart}], renamed ["old -> new"], gone [names])."""
    all_tags = cs_all("/addressbook/tags", {})
    try:
        cats = {c["id"]: c.get("name") for c in cs_all("/addressbook/tag_categories", {})}
    except CSError:
        cats = {}
    catalog = sorted(({"id": t["id"], "name": str(t.get("name") or "").strip(), "is_smart": bool(t.get("is_smart")),
                       "category": cats.get(t.get("category_id")) or "", "colour": t.get("colour") or ""}
                      for t in all_tags if t.get("id")),
                     key=lambda t: (t["category"] == "", t["category"].lower(), t["name"].lower()))
    by_id = {t["id"]: t for t in catalog}
    with LOCK:
        cfg = cs_config()
        if not cfg["tag_ids"] and cfg["tags"]:
            # first connection: turn the tag names typed earlier (or the defaults) into IDs
            by_name = {t["name"].lower(): t for t in catalog}
            cfg["tag_ids"] = [by_name[n.strip().lower()]["id"] for n in cfg["tags"] if n.strip().lower() in by_name]
        renamed, gone, chosen = [], [], []
        old_names = dict(zip(cfg["tag_ids"], cfg["tags"])) if len(cfg["tags"]) == len(cfg["tag_ids"]) else {}
        for i in cfg["tag_ids"]:
            t = by_id.get(i)
            if not t:
                gone.append(old_names.get(i, "tag %s" % i))
                continue
            if old_names.get(i) and old_names[i] != t["name"]:
                renamed.append("%s is now called %s" % (old_names[i], t["name"]))
            chosen.append({"id": i, "name": t["name"], "is_smart": t["is_smart"]})
        cfg["catalog"] = catalog
        cfg["catalog_updated"] = datetime.now().isoformat(timespec="seconds")
        if not gone:
            cfg["tags"] = [t["name"] for t in chosen]
        _write_json(CS_PATH, cfg)
    return cfg, chosen, renamed, gone


def cs_test():
    """Connect, refresh the tag list and count who would be fetched."""
    cfg, chosen, renamed, gone = cs_refresh_catalog()
    for t in chosen:
        res = cs_get("/addressbook/contacts", {"tag_ids[]": [t["id"]], "status": "active", "per_page": 1})
        t["count"] = (res.get("pagination") or {}).get("num_results")
    total = None
    if chosen:
        res = cs_get("/addressbook/contacts", {"tag_ids[]": [t["id"] for t in chosen], "status": "active", "per_page": 1})
        total = (res.get("pagination") or {}).get("num_results")
    return {"ok": True, "chosen": chosen, "renamed": renamed, "gone": gone, "total": total, "churchsuite": cs_public()}


COUNTRY_NAMES = {"GB": "United Kingdom", "UK": "United Kingdom", "IE": "Ireland", "IM": "Isle of Man",
                 "JE": "Jersey", "GG": "Guernsey"}


def cs_contact_to_row(c):
    a = c.get("address") or {}
    line2 = ", ".join(x for x in (a.get("line_2"), a.get("line_3")) if x)
    country = (a.get("country") or "").strip()
    row = {
        "first_name": (c.get("first_name") or "").strip(), "last_name": (c.get("last_name") or "").strip(),
        "address1": (a.get("line_1") or "").strip(), "address2": line2.strip(),
        "town": (a.get("city") or "").strip(), "county": (a.get("county") or "").strip(),
        "postcode": (a.get("postcode") or "").strip(),
        "country": COUNTRY_NAMES.get(country.upper(), country),
        "telephone": (c.get("telephone") or "").strip(), "mobile": (c.get("mobile") or "").strip(),
        "email": (c.get("email") or "").strip(),
    }
    row["_ext"] = {"cs_id": c.get("id"), "lat": a.get("latitude"), "lon": a.get("longitude")}
    return row


def cs_sync(confirm=False):
    # refresh the tag list first, so new tags appear in Settings and renamed tags are followed
    cfg, chosen, renamed, gone = cs_refresh_catalog()
    if gone:
        raise CSError("These tags no longer exist in ChurchSuite: %s. Choose the tags again in Settings - nothing has been changed."
                      % ", ".join(gone))
    if not chosen:
        raise CSError("Choose a ChurchSuite tag in Settings (we suggest an opt-in tag called Emergency Hub)")
    contacts = cs_all("/addressbook/contacts", {"tag_ids[]": [t["id"] for t in chosen], "status": "active"})
    seen, rows = set(), []
    for c in contacts:
        if c.get("id") in seen:
            continue
        seen.add(c.get("id"))
        r = cs_contact_to_row(c)
        if r["first_name"] or r["last_name"]:
            rows.append(r)
    tag_names = ", ".join(t["name"] for t in chosen)
    if not rows:
        raise CSError("ChurchSuite returned nobody with the tags %s - nothing has been changed." % tag_names)
    warnings = ["Tag renamed in ChurchSuite: %s (still included)" % r for r in renamed]
    smart = [t["name"] for t in chosen if t["is_smart"]]
    if smart:
        warnings.append("Smart tag(s) used: %s. If anyone seems to be missing, compare the numbers with ChurchSuite."
                        % ", ".join(smart))
    with_pos = sum(1 for r in rows if r["_ext"].get("lat") not in (None, "", 0))
    report = import_rows(rows, "ChurchSuite sync (%s)" % tag_names, warnings, guard_removals=not confirm)
    report["source_detail"] = {"from_churchsuite": len(rows), "positions_from_churchsuite": with_pos}
    with LOCK:
        cfg = cs_config()
        cfg["last_sync"] = report["timestamp"]
        _write_json(CS_PATH, cfg)
    return report


def retry_geocoding():
    with LOCK:
        todo = [c for c in DB["contacts"].values() if c.get("geo", {}).get("status") not in ("ok", "manual")]
        # forget cached failures for these so they are looked up again
        for c in todo:
            pc = norm_postcode(c.get("postcode"))
            if GEOCACHE.get("pc:" + pc) is None:
                GEOCACHE.pop("pc:" + pc, None)
                GEOCACHE.pop("pct:" + pc, None)
        before = sum(1 for c in todo if c.get("geo", {}).get("status") == "none")
        geocode_contacts(todo)
        save_db()
        after = sum(1 for c in DB["contacts"].values() if c.get("geo", {}).get("status") == "none")
        return {"checked": len(todo), "still_not_located": after, "newly_located": max(0, before - after)}


def update_contact(cid, body):
    with LOCK:
        c = DB["contacts"].get(cid)
        if not c:
            raise KeyError(cid)
        if "statuses" in body:
            was_hub = "hub_coordinator" in c.get("statuses", [])
            c["statuses"] = [s for s in status_keys() if s in body["statuses"]]
            if "hub_coordinator" in c["statuses"] and not was_hub:
                c["hub_override"] = None      # a new hub coordinator starts with automatic placement
        if "hub_level" in body:
            try:
                lv = int(body["hub_level"])
            except (TypeError, ValueError):
                raise ValueError("Hub level must be a number")
            if not 1 <= lv <= MAX_LEVELS:
                raise ValueError("Hub level must be between 1 and %d" % MAX_LEVELS)
            if lv != c.get("hub_level", 1):
                c["hub_level"] = lv
                c["hub_override"] = None      # their old 'reports to' may no longer fit
        if "hub_override" in body:
            ov = body["hub_override"] or None
            if ov and (ov not in DB["contacts"] or ov == cid):
                raise ValueError("Unknown hub coordinator")
            c["hub_override"] = ov
        if "notes" in body:
            c["notes"] = str(body["notes"])[:5000]
        if "location" in body:  # manual pin {lat, lon} or null to re-locate from address
            loc = body["location"]
            if loc:
                c["lat"], c["lon"] = float(loc["lat"]), float(loc["lon"])
                c["geo"] = {"status": "manual", "source": "manual", "note": "Position set by hand on the map"}
            else:
                geocode_contacts([c])
        c["updated_at"] = datetime.now().isoformat(timespec="seconds")
        save_db()


def export_csv():
    contacts = DB["contacts"]
    hubs = compute_hubs(contacts)
    buf = io.StringIO()
    w = csv.writer(buf)
    sl = status_list()
    w.writerow([l for _, l in FIELDS] + [l for _, l in sl] + ["Hub level", "Hub coordinator / reports to", "Hub set by", "Notes",
                                                                    "On map", "Location note"])
    for c in sorted(contacts.values(), key=lambda c: (norm(c.get("last_name")), norm(c.get("first_name")))):
        h = hubs[c["id"]]
        w.writerow([c.get(f, "") for f, _ in FIELDS] +
                   ["Yes" if s in c.get("statuses", []) else "" for s, _ in sl] +
                   [h["level"] or "", full_name(contacts[h["hub"]]) if h["hub"] else "",
                    ("Nearest" if h["auto"] else "Manual") if h["hub"] else "",
                    c.get("notes", ""), "Yes" if located(c) else "No", c.get("geo", {}).get("note", "")])
    return buf.getvalue().encode("utf-8-sig")


# --------------------------------------------------------------------------- street-map tile cache
# Every street-map square the user views is kept on this PC and used first, so areas already looked at still
# work without internet. This follows the OpenStreetMap tile policy: only tiles actually viewed are fetched (no
# prefetching), requests carry an identifying User-Agent, at most two downloads run at once, and a cached tile is
# refreshed from the internet once it is more than 7 days old (when online). Satellite images are not cached.
OSM_TILE_URL = "https://tile.openstreetmap.org/%d/%d/%d.png"
TILE_MAX_AGE = 7 * 24 * 3600
TILE_CACHE_LIMIT = 500 * 1024 * 1024
_tile_sem = threading.Semaphore(2)
_tile_stats = {"bytes": None}


def _tile_path(z, x, y):
    return os.path.join(TILE_DIR, "osm", str(z), str(x), "%d.png" % y)


def tile_cache_size():
    if _tile_stats["bytes"] is None:
        total = count = 0
        for dp, _, fns in os.walk(os.path.join(TILE_DIR, "osm")):
            for fn in fns:
                try:
                    total += os.path.getsize(os.path.join(dp, fn)); count += 1
                except OSError:
                    pass
        _tile_stats.update(bytes=total, count=count)
    return {"bytes": _tile_stats["bytes"], "count": _tile_stats.get("count", 0), "limit": TILE_CACHE_LIMIT}


def _prune_tiles():
    files = []
    for dp, _, fns in os.walk(os.path.join(TILE_DIR, "osm")):
        for fn in fns:
            fp = os.path.join(dp, fn)
            try:
                st = os.stat(fp)
                files.append((st.st_atime, st.st_size, fp))
            except OSError:
                pass
    files.sort()                       # least recently used first
    total = sum(f[1] for f in files)
    for _, size, fp in files:
        if total <= TILE_CACHE_LIMIT * 0.85:
            break
        try:
            os.remove(fp); total -= size
        except OSError:
            pass
    _tile_stats["bytes"] = None


def get_tile(z, x, y):
    """Returns PNG bytes for a street-map tile (cached copy first), or None if unavailable."""
    fp = _tile_path(z, x, y)
    cached = None
    if os.path.isfile(fp):
        with open(fp, "rb") as f:
            cached = f.read()
        if time.time() - os.path.getmtime(fp) < TILE_MAX_AGE:
            return cached
    try:
        with _tile_sem:
            req = urllib.request.Request(OSM_TILE_URL % (z, x, y), headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
        if not data.startswith(b"\x89PNG"):
            return cached
        st = tile_cache_size()         # (measure before adding this tile)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        tmp = fp + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, fp)
        _tile_stats["bytes"] = st["bytes"] + len(data) - (len(cached) if cached else 0)
        _tile_stats["count"] = st["count"] + (0 if cached else 1)
        if _tile_stats["bytes"] > TILE_CACHE_LIMIT:
            _prune_tiles()
        return data
    except Exception:
        return cached                  # offline (or the server refused): use the stored copy if there is one


def clear_tile_cache():
    import shutil
    shutil.rmtree(os.path.join(TILE_DIR, "osm"), ignore_errors=True)
    _tile_stats.update(bytes=0, count=0)


# --------------------------------------------------------------------------- locking / unlocking
def _sensitive_files():
    """Every data file holding personal information (not vault.json, config.json or images)."""
    out = [p for p in (DB_PATH, GEO_PATH, CS_PATH) if os.path.exists(p)]
    if os.path.isdir(BACKUP_DIR):
        out += [os.path.join(BACKUP_DIR, f) for f in sorted(os.listdir(BACKUP_DIR)) if f.endswith(".json")]
    return out


def _load_all():
    DB.clear()
    DB.update(_read_json(DB_PATH, copy.deepcopy(EMPTY_DB)))
    GEOCACHE.clear()
    GEOCACHE.update(_read_json(GEO_PATH, {}))
    apply_upgrades()


def lock_screen_branding():
    """A few non-personal details shown on the lock screen."""
    st = current_settings()
    logo = DB.get("images", {}).get("org_logo")
    return {"org_name": st["org_name"] if st.get("show_org_name") else "",
            "accent_color": st.get("accent_color"), "theme": st.get("theme"),
            "logo": ("%s.%s" % ("org_logo", logo["ext"])) if logo and st.get("show_org_logo") else None}


def _save_vault_info(info):
    _VAULT["info"] = info
    tmp = VAULT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=1)
    os.replace(tmp, VAULT_PATH)


def refresh_vault_branding():
    if encryption_on() and not is_locked() and not MODE["demo"]:
        info = dict(_VAULT["info"])
        info["branding"] = lock_screen_branding()
        _save_vault_info(info)


def check_passphrase_strength(pp):
    if len(pp) < 12:
        raise ValueError("Use a passphrase of at least 12 characters - three or four random words works well")


def unlock(passphrase):
    with LOCK:
        info = _VAULT["info"]
        if not info:
            return
        enc, mac = _derive(passphrase, bytes.fromhex(info["salt"]), info.get("rounds", KDF_ROUNDS))
        try:
            ok = _decrypt(bytes.fromhex(info["check"]), enc, mac) == b"EHC-VAULT-OK"
        except ValueError:
            ok = False
        if not ok:
            time.sleep(1)      # slow down guessing
            raise ValueError("That passphrase is not right")
        _KEY.update(enc=enc, mac=mac)
        _VAULT["last_activity"] = time.time()
        _load_all()
        ensure_centre()


def lock():
    with LOCK:
        if not encryption_on():
            return
        _KEY.update(enc=None, mac=None)
        _cs_token["value"] = None
        if MODE["demo"]:
            return          # the demo data is not encrypted; only the real data is locked away
        DB.clear()
        DB.update(copy.deepcopy(EMPTY_DB))
        GEOCACHE.clear()


def _rewrite_all(old_key, new_key):
    """Re-save every sensitive file, reading with old_key (None = plain) and writing with new_key (None = plain)."""
    contents = {}
    for path in _sensitive_files():
        with open(path, "rb") as f:
            raw = f.read()
        if raw.startswith(ENC_MAGIC):
            raw = _decrypt(raw, *old_key)
        contents[path] = raw
    for path, raw in contents.items():
        data = _encrypt(raw, *new_key) if new_key else raw
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)


def enable_encryption(passphrase):
    with LOCK:
        if encryption_on():
            raise ValueError("Encryption is already on")
        check_passphrase_strength(passphrase)
        salt = secrets.token_bytes(16)
        enc, mac = _derive(passphrase, salt)
        _rewrite_all(None, (enc, mac))
        _KEY.update(enc=enc, mac=mac)
        _save_vault_info({"version": 1, "kdf": "pbkdf2-sha256", "rounds": KDF_ROUNDS, "cipher": "chacha20+hmac-sha256",
                          "salt": salt.hex(), "check": _encrypt(b"EHC-VAULT-OK", enc, mac).hex(),
                          "created": datetime.now().isoformat(timespec="seconds")})
        refresh_vault_branding()
        _VAULT["last_activity"] = time.time()


def change_passphrase(old, new):
    with LOCK:
        info = _VAULT["info"]
        if not info:
            raise ValueError("Encryption is not on")
        o_enc, o_mac = _derive(old, bytes.fromhex(info["salt"]), info.get("rounds", KDF_ROUNDS))
        try:
            _decrypt(bytes.fromhex(info["check"]), o_enc, o_mac)
        except ValueError:
            raise ValueError("The current passphrase is not right")
        check_passphrase_strength(new)
        salt = secrets.token_bytes(16)
        enc, mac = _derive(new, salt)
        _rewrite_all((o_enc, o_mac), (enc, mac))
        _KEY.update(enc=enc, mac=mac)
        info = dict(info, salt=salt.hex(), rounds=KDF_ROUNDS, check=_encrypt(b"EHC-VAULT-OK", enc, mac).hex(),
                    changed=datetime.now().isoformat(timespec="seconds"))
        _save_vault_info(info)
        refresh_vault_branding()


def disable_encryption(passphrase):
    with LOCK:
        info = _VAULT["info"]
        if not info:
            return
        enc, mac = _derive(passphrase, bytes.fromhex(info["salt"]), info.get("rounds", KDF_ROUNDS))
        try:
            _decrypt(bytes.fromhex(info["check"]), enc, mac)
        except ValueError:
            raise ValueError("That passphrase is not right")
        _rewrite_all((enc, mac), None)
        os.remove(VAULT_PATH)
        _VAULT["info"] = None
        _KEY.update(enc=None, mac=None)


def set_demo(on):
    with LOCK:
        on = bool(on)
        if on == MODE["demo"]:
            return
        if on:
            _install_demo_data()
            if encryption_on():                 # lock the real data away while the demo is showing
                _KEY.update(enc=None, mac=None)
            _cs_token["value"] = None
            _use_paths(True)
            MODE["demo"] = True
            _load_all()
        else:
            _use_paths(False)
            MODE["demo"] = False
            if is_locked():
                DB.clear()
                DB.update(copy.deepcopy(EMPTY_DB))
                GEOCACHE.clear()
            else:
                _load_all()
                ensure_centre()
        _save_mode()


def reset_demo():
    with LOCK:
        if not MODE["demo"]:
            raise ValueError("The demo is not on")
        _install_demo_data(overwrite=True)
        _load_all()


DEMO_BLOCKED = ("/api/upload", "/api/churchsuite/config", "/api/churchsuite/test", "/api/churchsuite/sync",
                "/api/security/enable", "/api/security/change", "/api/security/disable", "/api/lock")


def security_state():
    return {"encrypted": encryption_on(), "locked": is_locked() and not MODE["demo"], "demo": MODE["demo"],
            "auto_lock_minutes": (current_settings().get("auto_lock_minutes") if not is_locked() else None),
            "branding": (_VAULT["info"] or {}).get("branding") if is_locked() and not MODE["demo"] else None}


def check_auto_lock():
    """Lock if nobody has used the app for the auto-lock time."""
    if encryption_on() and not is_locked():
        mins = current_settings().get("auto_lock_minutes") or 0
        if mins and time.time() - _VAULT["last_activity"] > mins * 60:
            lock()


def _auto_lock_loop():
    while True:
        time.sleep(30)
        try:
            check_auto_lock()
        except Exception:
            pass



# --------------------------------------------------------------------------- updates
# New versions are published as GitHub releases. Each release carries:
#   EmergencyHub-<version>-update.zip   the app folder's program files (never data, config.json, the launcher or python/)
#   update.json                         {"version", "file", "sha256", "size"} for the zip above
# The app checks the latest release, and on request downloads the zip, checks its SHA-256 fingerprint,
# keeps a copy of the current program files (so it can go back), puts the new files in place and restarts.
import shutil
import zipfile

UPDATE_API = os.environ.get("EHC_UPDATE_API", "https://api.github.com").rstrip("/")
UPDATE_STATE_PATH = os.path.join(DATA_DIR, "update.json")     # not personal, so never encrypted
UPDATE_DIR = os.path.join(BASE, ".update")                    # downloads and the copy of the previous version
RESTART_CODE = 3                                              # the launcher starts the server again on this exit code
# What an update may replace, inside the app folder. Everything else (data, config.json, the launcher, python/) is left alone.
UPDATE_FILES = ("VERSION", "server.py", "README.md", "CHANGELOG.md", "LICENSE", "contacts-template.csv")
UPDATE_DIRS = ("static", "demo", "tools")
_UPD = {"busy": False, "lock": threading.Lock(), "restart_pending": False}


def parse_version(v):
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)$", str(v or "").strip())
    return tuple(int(x) for x in m.groups()) if m else None


def self_update_mode():
    """'auto': can install and restart itself; 'manual': can install but needs restarting by hand;
    'off': only tells you about new versions (e.g. Docker, where the image is updated instead)."""
    if os.environ.get("EHC_NO_SELF_UPDATE"):
        return "off"
    return "auto" if os.environ.get("EHC_LAUNCHER") else "manual"


def _update_state():
    try:
        with open(UPDATE_STATE_PATH, "r", encoding="utf-8") as f:
            st = json.load(f)
            return st if isinstance(st, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_update_state(st):
    tmp = UPDATE_STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, indent=1)
    os.replace(tmp, UPDATE_STATE_PATH)


def _previous_version():
    try:
        with open(os.path.join(UPDATE_DIR, "previous", "VERSION"), "r", encoding="utf-8") as f:
            v = f.read().strip()
            return v if parse_version(v) else None
    except OSError:
        return None


def update_public():
    st = _update_state()
    latest = st.get("latest") or {}
    lv, cv = parse_version(latest.get("version")), parse_version(APP_VERSION)
    return {
        "current": APP_VERSION,
        "auto_check": st.get("auto_check", True),
        "last_check": st.get("last_check"),
        "error": st.get("error"),
        "latest": latest or None,
        "available": bool(lv and cv and lv > cv),
        "mode": self_update_mode(),
        "previous": _previous_version(),
        "restart_pending": _UPD["restart_pending"],
        "repo": CFG.get("update_repo", ""),
    }


def _http_get(url, limit, accept="application/octet-stream"):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT + " " + APP_VERSION, "Accept": accept})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError("The download was larger than expected")
    return data


def check_for_update():
    """Ask GitHub for the latest release. Saves and returns what update_public() reports."""
    st = _update_state()
    repo = CFG.get("update_repo", "")
    try:
        if not re.match(r"^[\w.-]+/[\w.-]+$", repo or ""):
            raise ValueError("No update source is set (update_repo in config.json)")
        rel = json.loads(_http_get("%s/repos/%s/releases/latest" % (UPDATE_API, repo), 2 * 1024 * 1024,
                                   "application/vnd.github+json").decode("utf-8"))
        assets = {a.get("name"): a.get("browser_download_url") for a in rel.get("assets") or []}
        if "update.json" not in assets:
            raise ValueError("The latest release has no update.json")
        man = json.loads(_http_get(assets["update.json"], 64 * 1024).decode("utf-8"))
        version = str(man.get("version") or "")
        if not parse_version(version) or parse_version(version) != parse_version(rel.get("tag_name")):
            raise ValueError("The latest release's version details don't match")
        if man.get("file") not in assets or not re.match(r"^[0-9a-f]{64}$", str(man.get("sha256") or "")):
            raise ValueError("The latest release's update file is missing")
        st["latest"] = {"version": version, "name": rel.get("name") or ("Version " + version),
                        "notes": (rel.get("body") or "")[:20000], "published": rel.get("published_at"),
                        "page": rel.get("html_url"), "url": assets[man["file"]], "sha256": man["sha256"],
                        "size": int(man.get("size") or 0)}
        st["error"] = None
    except urllib.error.HTTPError as e:
        st["error"] = ("No releases have been published yet" if e.code == 404
                       else "GitHub said: HTTP %s" % e.code)
    except (urllib.error.URLError, OSError) as e:
        st["error"] = "Could not reach GitHub - check the internet connection (%s)" % getattr(e, "reason", e)
    except (ValueError, KeyError, TypeError) as e:
        st["error"] = str(e)
    st["last_check"] = datetime.now().isoformat(timespec="seconds")
    _save_update_state(st)
    return update_public()


def set_auto_check(on):
    st = _update_state()
    st["auto_check"] = bool(on)
    _save_update_state(st)
    return update_public()


def _auto_update_loop():
    time.sleep(90)
    while True:
        try:
            st = _update_state()
            last = st.get("last_check")
            due = not last or (datetime.now() - datetime.fromisoformat(last)).total_seconds() > 20 * 3600
            if st.get("auto_check", True) and due:
                check_for_update()
        except Exception:
            pass
        time.sleep(3 * 3600)


def _safe_members(zf, version):
    """Check every file in an update zip goes somewhere an update is allowed to write."""
    names = []
    for info in zf.infolist():
        n = info.filename
        if n.endswith("/"):
            continue
        parts = n.split("/")
        if (n.startswith("/") or "\\" in n or ":" in n or any(p in ("", ".", "..") for p in parts)
                or (info.external_attr >> 16) & 0o170000 == 0o120000):      # symbolic link
            raise ValueError("The update contains a file with an unsafe name: %s" % n)
        if not (n in UPDATE_FILES or parts[0] in UPDATE_DIRS and len(parts) > 1):
            raise ValueError("The update contains a file it isn't allowed to replace: %s" % n)
        names.append(n)
    if "server.py" not in names or "VERSION" not in names or "static/index.html" not in names:
        raise ValueError("The update is incomplete")
    if parse_version(zf.read("VERSION").decode("utf-8").strip()) != parse_version(version):
        raise ValueError("The update's version number doesn't match")
    compile(zf.read("server.py"), "server.py", "exec")      # refuses a damaged or incompatible server.py
    return names


def _copy_program_files(src_root, dst_root):
    """Copy the replaceable program files from one folder to another (dst is created fresh)."""
    shutil.rmtree(dst_root, ignore_errors=True)
    os.makedirs(dst_root)
    for f in UPDATE_FILES:
        if os.path.isfile(os.path.join(src_root, f)):
            shutil.copy2(os.path.join(src_root, f), os.path.join(dst_root, f))
    for d in UPDATE_DIRS:
        if os.path.isdir(os.path.join(src_root, d)):
            shutil.copytree(os.path.join(src_root, d), os.path.join(dst_root, d),
                            ignore=shutil.ignore_patterns("__pycache__"))


def _put_in_place(src_root):
    """Replace the program files in BASE with those in src_root."""
    for d in UPDATE_DIRS:
        new = os.path.join(src_root, d)
        if not os.path.isdir(new):
            continue
        old = os.path.join(BASE, d)
        # copy over the top (Windows won't delete a file that's being read), then tidy away files that have gone
        shutil.copytree(new, old, dirs_exist_ok=True)
        keep = {os.path.relpath(os.path.join(dp, fn), new) for dp, _, fns in os.walk(new) for fn in fns}
        for dp, _, fns in os.walk(old):
            for fn in fns:
                rel = os.path.relpath(os.path.join(dp, fn), old)
                if rel not in keep and "__pycache__" not in rel:
                    try:
                        os.remove(os.path.join(dp, fn))
                    except OSError:
                        pass
    for f in UPDATE_FILES:
        new = os.path.join(src_root, f)
        if os.path.isfile(new):
            tmp = os.path.join(BASE, f + ".new")
            shutil.copy2(new, tmp)
            os.replace(tmp, os.path.join(BASE, f))


def _schedule_restart():
    _UPD["restart_pending"] = True
    if self_update_mode() != "auto":
        return

    def go():
        with LOCK:           # wait for any save in progress to finish
            sys.stdout.flush()
            os._exit(RESTART_CODE)
    threading.Timer(1.5, go).start()


def install_update():
    if self_update_mode() == "off":
        raise ValueError("This copy can't update itself - update it the way it was installed (for example the Docker image)")
    latest = (_update_state().get("latest") or {})
    if not update_public()["available"]:
        raise ValueError("There is no newer version to install")
    if not _UPD["lock"].acquire(blocking=False):
        raise ValueError("An update is already being installed")
    try:
        os.makedirs(UPDATE_DIR, exist_ok=True)
        size = int(latest.get("size") or 0)
        data = _http_get(latest["url"], max(size, 1) if size else 50 * 1024 * 1024)
        if size and len(data) != size:
            raise ValueError("the download was incomplete - please try again")
        if hashlib.sha256(data).hexdigest() != latest["sha256"]:
            raise ValueError("the download doesn't match its published fingerprint")
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            _safe_members(zf, latest["version"])
            staging = os.path.join(UPDATE_DIR, "new")
            shutil.rmtree(staging, ignore_errors=True)
            zf.extractall(staging)
        # keep the current version so it can be put back
        _copy_program_files(BASE, os.path.join(UPDATE_DIR, "previous-tmp"))
        shutil.rmtree(os.path.join(UPDATE_DIR, "previous"), ignore_errors=True)
        os.replace(os.path.join(UPDATE_DIR, "previous-tmp"), os.path.join(UPDATE_DIR, "previous"))
        try:
            _put_in_place(staging)
        except Exception:
            _put_in_place(os.path.join(UPDATE_DIR, "previous"))      # put everything back as it was
            raise
        shutil.rmtree(staging, ignore_errors=True)
        st = _update_state()
        st.setdefault("history", []).append({"from": APP_VERSION, "to": latest["version"],
                                              "at": datetime.now().isoformat(timespec="seconds")})
        st["history"] = st["history"][-20:]
        _save_update_state(st)
        print("Installed version %s - restarting" % latest["version"])
        _schedule_restart()
        return dict(update_public(), installed=latest["version"])
    finally:
        _UPD["lock"].release()


def roll_back_update():
    prev = _previous_version()
    if not prev:
        raise ValueError("There is no earlier version kept to go back to")
    if self_update_mode() == "off":
        raise ValueError("This copy can't change its own version")
    if not _UPD["lock"].acquire(blocking=False):
        raise ValueError("An update is already being installed")
    try:
        prev_dir = os.path.join(UPDATE_DIR, "previous")
        compile(open(os.path.join(prev_dir, "server.py"), "rb").read(), "server.py", "exec")
        _copy_program_files(BASE, os.path.join(UPDATE_DIR, "undone"))
        _put_in_place(prev_dir)
        shutil.rmtree(prev_dir, ignore_errors=True)
        st = _update_state()
        st.setdefault("history", []).append({"from": APP_VERSION, "to": prev, "rollback": True,
                                              "at": datetime.now().isoformat(timespec="seconds")})
        _save_update_state(st)
        print("Went back to version %s - restarting" % prev)
        _schedule_restart()
        return dict(update_public(), installed=prev)
    finally:
        _UPD["lock"].release()


# --------------------------------------------------------------------------- HTTP
MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
        ".ico": "image/x-icon", ".json": "application/json"}


class Handler(BaseHTTPRequestHandler):
    server_version = "EHC/1.0"

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s  %s\n" % (datetime.now().strftime("%H:%M:%S"), fmt % args))

    def send_json(self, obj, code=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_body(self, limit=30 * 1024 * 1024):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("File too large")
        return self.rfile.read(n)

    def gate(self, path):
        """Returns True if the request may go ahead; sends 423 Locked otherwise."""
        if not path.startswith("/api/") or path in ("/api/security", "/api/unlock", "/api/lock", "/api/lockscreen-logo",
                                                    "/api/demo", "/api/version"):
            return True
        check_auto_lock()
        if is_locked() and not MODE["demo"]:
            self.send_json({"locked": True, "error": "Locked - enter the passphrase to continue"}, 423)
            return False
        if path != "/api/touch":
            _VAULT["last_activity"] = time.time()
        return True

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if not self.gate(path):
            return
        try:
            if path == "/api/security":
                return self.send_json(security_state())
            if path == "/api/lockscreen-logo":
                b = (_VAULT["info"] or {}).get("branding") or {}
                fn = b.get("logo")
                fp = os.path.join(IMAGE_DIR, fn) if fn and re.match(r"^org_logo\.(png|jpg|gif|webp|svg)$", fn) else None
                if not fp or not os.path.isfile(fp):
                    self.send_response(404)
                    self.end_headers()
                    return
                with open(fp, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", IMAGE_TYPES[fn.rsplit(".", 1)[1]])
                self.send_header("Content-Length", str(len(data)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
                self.end_headers()
                return self.wfile.write(data)
            if path == "/api/version":
                return self.send_json({"version": APP_VERSION})
            if path == "/api/update":
                return self.send_json(update_public())
            if path == "/api/state":
                with LOCK:
                    return self.send_json(public_state())
            m = re.match(r"^/api/image/([a-z_]+)$", path)
            if m:
                info = DB.get("images", {}).get(m.group(1))
                fp = os.path.join(IMAGE_DIR, "%s.%s" % (m.group(1), info["ext"])) if info else None
                if not fp or m.group(1) not in IMAGE_KINDS or not os.path.isfile(fp):
                    self.send_response(404)
                    self.end_headers()
                    return
                with open(fp, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", IMAGE_TYPES[info["ext"]])
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "max-age=31536000")   # URL carries a version number
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
                self.end_headers()
                return self.wfile.write(data)
            if path == "/api/lookup":
                pc = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("postcode", [""])[0]
                try:
                    with LOCK:
                        p, (lat, lon) = lookup_one_postcode(pc)
                except ValueError as e:
                    return self.send_json({"error": str(e)}, 400)
                return self.send_json({"postcode": pretty_postcode(p), "lat": lat, "lon": lon})
            if path == "/api/churchsuite":
                return self.send_json(cs_public())
            if path == "/api/reports":
                with LOCK:
                    return self.send_json(list(reversed(DB["uploads"])))
            if path == "/api/export.csv":
                with LOCK:
                    data = export_csv()
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", 'attachment; filename="emergency-contacts-%s.csv"'
                                 % datetime.now().strftime("%Y-%m-%d"))
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                return self.wfile.write(data)
            m = re.match(r"^/tiles/osm/(\d{1,2})/(\d{1,7})/(\d{1,7})\.png$", path)
            if m:
                z, x, y = (int(v) for v in m.groups())
                data = get_tile(z, x, y) if z <= 19 and x < 2 ** z and y < 2 ** z else None
                if data is None:
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "max-age=86400")
                self.end_headers()
                return self.wfile.write(data)
            if path == "/api/tilecache":
                return self.send_json(tile_cache_size())
            return self.serve_static(path)
        except Exception as e:
            return self.send_json({"error": str(e)}, 500)

    def serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            self.send_response(404)
            self.end_headers()
            return
        with open(full, "rb") as f:
            data = f.read()
        if full.endswith("index.html"):
            # tag our own scripts and styles with the version on disk, so browsers never use old copies after an update
            v = read_app_version()
            data = re.sub(rb'((?:src|href)="(?!https?:|//)[^"?]+\.(?:js|css))"', lambda m: m.group(1) + b'?v=' + v.encode() + b'"', data)
            data = data.replace(b"<head>", b'<head>\n<meta name="ehc-version" content="' + v.encode() + b'">', 1)
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(os.path.splitext(full)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if not self.gate(u.path):
            return
        try:
            if MODE["demo"] and u.path in DEMO_BLOCKED:
                return self.send_json({"error": "Not available in the demo - turn the demo off in Settings to use your real data"}, 403)
            if u.path == "/api/update/check":
                return self.send_json(check_for_update())
            if u.path == "/api/update/settings":
                body = json.loads(self.read_body(64 * 1024) or b"{}")
                return self.send_json(set_auto_check(body.get("auto_check", True)))
            if u.path == "/api/update/install":
                try:
                    return self.send_json(install_update())
                except (ValueError, OSError, urllib.error.URLError, zipfile.BadZipFile) as e:
                    return self.send_json({"error": "The update wasn't installed: %s" % e}, 400)
            if u.path == "/api/update/rollback":
                try:
                    return self.send_json(roll_back_update())
                except (ValueError, OSError) as e:
                    return self.send_json({"error": str(e)}, 400)
            if u.path == "/api/demo":
                body = json.loads(self.read_body(64 * 1024) or b"{}")
                set_demo(body.get("on"))
                with LOCK:
                    return self.send_json(public_state() if not (is_locked() and not MODE["demo"]) else {"locked": True})
            if u.path == "/api/demo/reset":
                reset_demo()
                with LOCK:
                    return self.send_json(public_state())
            if u.path == "/api/unlock":
                body = json.loads(self.read_body(64 * 1024) or b"{}")
                unlock(str(body.get("passphrase") or ""))
                return self.send_json(security_state())
            if u.path == "/api/lock":
                lock()
                return self.send_json(security_state())
            if u.path == "/api/tilecache/clear":
                clear_tile_cache()
                return self.send_json(tile_cache_size())
            if u.path == "/api/touch":
                _VAULT["last_activity"] = time.time()
                return self.send_json({"ok": True})
            if u.path == "/api/security/enable":
                body = json.loads(self.read_body(64 * 1024) or b"{}")
                enable_encryption(str(body.get("passphrase") or ""))
                return self.send_json(security_state())
            if u.path == "/api/security/change":
                body = json.loads(self.read_body(64 * 1024) or b"{}")
                change_passphrase(str(body.get("old") or ""), str(body.get("new") or ""))
                return self.send_json(security_state())
            if u.path == "/api/security/disable":
                body = json.loads(self.read_body(64 * 1024) or b"{}")
                disable_encryption(str(body.get("passphrase") or ""))
                return self.send_json(security_state())
            if u.path == "/api/upload":
                fn = urllib.parse.parse_qs(u.query).get("filename", ["upload.csv"])[0]
                report = process_upload(self.read_body(), fn)
                return self.send_json(report)
            m = re.match(r"^/api/image/([a-z_]+)$", u.path)
            if m:
                if m.group(1) not in IMAGE_KINDS:
                    return self.send_json({"error": "Unknown image"}, 404)
                if urllib.parse.parse_qs(u.query).get("remove"):
                    remove_image(m.group(1))
                else:
                    save_image(m.group(1), self.read_body(4 * 1024 * 1024))
                with LOCK:
                    return self.send_json(public_state())
            if u.path == "/api/churchsuite/config":
                return self.send_json(cs_save_config(json.loads(self.read_body(64 * 1024) or b"{}")))
            if u.path == "/api/churchsuite/test":
                try:
                    return self.send_json(cs_test())
                except CSError as e:
                    return self.send_json({"error": e.args[0]}, 400)
            if u.path == "/api/churchsuite/sync":
                body = json.loads(self.read_body(64 * 1024) or b"{}")
                try:
                    return self.send_json(cs_sync(confirm=bool(body.get("confirm"))))
                except NeedsConfirm as e:
                    return self.send_json({"needs_confirm": True, "removing": e.removing, "keeping": e.keeping,
                                           "adding": e.adding}, 409)
                except CSError as e:
                    return self.send_json({"error": e.args[0]}, 400)
            if u.path == "/api/settings":
                save_settings(json.loads(self.read_body(1024 * 1024) or b"{}"))
                with LOCK:
                    return self.send_json(public_state())
            if u.path == "/api/calls-printed":
                return self.send_json(confirm_calls_printed())
            if u.path == "/api/regeocode":
                return self.send_json(retry_geocoding())
            m = re.match(r"^/api/contacts/([0-9a-f]+)$", u.path)
            if m:
                body = json.loads(self.read_body(1024 * 1024) or b"{}")
                update_contact(m.group(1), body)
                with LOCK:
                    return self.send_json(public_state())
            self.send_json({"error": "Not found"}, 404)
        except Locked:
            self.send_json({"locked": True, "error": "Locked - enter the passphrase to continue"}, 423)
        except KeyError:
            self.send_json({"error": "Contact not found"}, 404)
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_json({"error": "Server error: %s" % e}, 500)


def explain_port_in_use(url, port):
    """Something is already using our port: usually another copy of the app left running in another window."""
    other = None
    try:
        with urllib.request.urlopen(url + "api/version", timeout=3) as r:
            other = json.loads(r.read().decode("utf-8")).get("version")
    except Exception:
        pass
    print("=" * 60)
    if other == APP_VERSION:
        print(" Emergency Hub Coordinator is already running in another window.")
        print(" Opening it in your browser - you can close this window.")
        if CFG.get("open_browser"):
            webbrowser.open(url)
    elif other:
        print(" An older copy of Emergency Hub Coordinator (version %s) is still" % other)
        print(" running in another black window. Close that window, then start")
        print(" Emergency Hub again.")
    else:
        print(" Another program is already using port %d, so the app can't start." % port)
        print(" If an older Emergency Hub window is open, close it and try again.")
        print(" Otherwise, change \"port\" in data\\config.json to another number,")
        print(" for example 8766.")
    print("=" * 60)


def main():
    if MODE["demo"] or not is_locked():
        try:
            apply_upgrades()
        except NewerDataError as e:
            print("\n" + str(e) + "\n")
            sys.exit(1)
        ensure_centre()
    threading.Thread(target=_auto_lock_loop, daemon=True).start()
    host, port = CFG["host"], int(CFG["port"])
    url = "http://%s:%d/" % ("127.0.0.1" if host in ("0.0.0.0", "") else host, port)
    try:
        srv = ThreadingHTTPServer((host, port), Handler)
    except OSError:
        explain_port_in_use(url, port)
        sys.exit(1)
    threading.Thread(target=_auto_update_loop, daemon=True).start()
    print("=" * 60)
    print(" Emergency Hub Coordinator %s is running" % APP_VERSION)
    print(" Open:  " + url)
    print(" Data:  " + DATA_DIR + ("   (DEMO - made-up people)" if MODE["demo"] else ""))
    print(" Keep this window open while you use the app. Close it to stop.")
    print("=" * 60)
    if CFG.get("open_browser"):
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
