"""Builds the files for a release (run by the GitHub Action when a version tag is pushed).

  python tools/build_release.py --python-zip python-embed.zip --shortcut "Emergency Hub.lnk" --out dist
  python tools/build_release.py --notes 1.2.0        prints that version's section of CHANGELOG.md

Creates in --out:
  EmergencyHub-<version>-windows.zip   Emergency Hub Coordinator\\ with the "Emergency Hub" shortcut and app\\ (including Python)
  EmergencyHub-<version>-update.zip    the app folder's program files, used by the app's own updater
  update.json                          version, file name, size and SHA-256 fingerprint of the update zip
  SHA256SUMS.txt                       fingerprints of both zips
"""
import argparse
import ast
import hashlib
import io
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")

# Must match UPDATE_FILES / UPDATE_DIRS in app/server.py: an update zip may only contain these (paths inside app\).
PROGRAM_FILES = ("VERSION", "server.py", "README.md", "CHANGELOG.md", "LICENSE", "contacts-template.csv")
PROGRAM_DIRS = ("static", "demo", "tools")
DOCS = ("README.md", "CHANGELOG.md", "LICENSE")       # kept at the top of the repository, shipped inside app\
LAUNCHER = "Start Emergency Hub.bat"                  # in app\, never replaced by the updater (it's running)
SHORTCUT = "Emergency Hub.lnk"
FOLDER = "Emergency Hub Coordinator"
STAMP = (2026, 1, 1, 0, 0, 0)                         # fixed file times, so the same source always gives the same zip


def src(rel):
    """Where a program file (path inside app\\) lives in the repository."""
    return os.path.join(ROOT, rel) if rel in DOCS else os.path.join(APP, rel)


def read(path):
    with open(path, "rb") as f:
        return f.read()


def program_files():
    out = [f for f in PROGRAM_FILES if os.path.isfile(src(f))]
    for d in PROGRAM_DIRS:
        for dp, dns, fns in os.walk(os.path.join(APP, d)):
            dns[:] = sorted(x for x in dns if x != "__pycache__")
            for fn in sorted(fns):
                if not fn.endswith(".pyc"):
                    out.append(os.path.relpath(os.path.join(dp, fn), APP).replace(os.sep, "/"))
    return sorted(out)


def add(zf, arcname, data):
    info = zipfile.ZipInfo(arcname, STAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    zf.writestr(info, data)


def changelog_section(version):
    text = read(os.path.join(ROOT, "CHANGELOG.md")).decode("utf-8")
    m = re.search(r"^## \[?%s\]?[^\n]*\n(.*?)(?=^## |\Z)" % re.escape(version), text, re.S | re.M)
    return (m.group(1).strip() if m else "Version %s" % version) + "\n"


def check_matches_server():
    """The updater in server.py must allow exactly the files this script ships."""
    tree = ast.parse(read(os.path.join(APP, "server.py")))
    found = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and getattr(node.targets[0], "id", "") in ("UPDATE_FILES", "UPDATE_DIRS"):
            found[node.targets[0].id] = tuple(ast.literal_eval(node.value))
    if found.get("UPDATE_FILES") != PROGRAM_FILES or found.get("UPDATE_DIRS") != PROGRAM_DIRS:
        sys.exit("UPDATE_FILES / UPDATE_DIRS in server.py don't match PROGRAM_FILES / PROGRAM_DIRS here")


def build(python_zip, shortcut, out):
    check_matches_server()
    version = read(os.path.join(APP, "VERSION")).decode("utf-8").strip()
    if not re.match(r"^\d+\.\d+\.\d+$", version):
        sys.exit("VERSION must look like 1.2.3")
    files = program_files()
    os.makedirs(out, exist_ok=True)

    # the update zip: the app folder's program files at the top level
    upd_name = "EmergencyHub-%s-update.zip" % version
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for rel in files:
            add(zf, rel, read(src(rel)))
    upd = buf.getvalue()
    with open(os.path.join(out, upd_name), "wb") as f:
        f.write(upd)

    # the full Windows zip: the shortcut, and app\ with the launcher and Python
    full_name = "EmergencyHub-%s-windows.zip" % version
    with zipfile.ZipFile(os.path.join(out, full_name), "w") as zf:
        if shortcut:
            add(zf, "%s/%s" % (FOLDER, SHORTCUT), read(shortcut))
        for rel in files + [LAUNCHER]:
            add(zf, "%s/app/%s" % (FOLDER, rel), read(src(rel)))
        if python_zip:
            with zipfile.ZipFile(python_zip) as pz:
                for info in pz.infolist():
                    if not info.filename.endswith("/"):
                        add(zf, "%s/app/python/%s" % (FOLDER, info.filename), pz.read(info))

    sha = hashlib.sha256(upd).hexdigest()
    with open(os.path.join(out, "update.json"), "w", encoding="utf-8") as f:
        json.dump({"version": version, "file": upd_name, "size": len(upd), "sha256": sha}, f, indent=1)
    with open(os.path.join(out, "SHA256SUMS.txt"), "w", encoding="utf-8") as f:
        for name in (full_name, upd_name):
            f.write("%s  %s\n" % (hashlib.sha256(read(os.path.join(out, name))).hexdigest(), name))
    print("Built version %s: %d program files%s%s" % (version, len(files), ", with Python" if python_zip else "",
                                                      ", with the shortcut" if shortcut else ""))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--python-zip", help="the Windows embeddable Python zip to include")
    ap.add_argument("--shortcut", help="the Emergency Hub.lnk to put next to the app folder")
    ap.add_argument("--out", default="dist")
    ap.add_argument("--notes", metavar="VERSION", help="print the CHANGELOG section for VERSION and stop")
    a = ap.parse_args()
    if a.notes:
        # write bytes, so arrows and accents survive the Windows console's default code page
        sys.stdout.buffer.write(changelog_section(a.notes).encode("utf-8"))
    else:
        build(a.python_zip, a.shortcut, a.out)
