"""Builds the files for a release (run by the GitHub Action when a version tag is pushed).

  python tools/build_release.py --python-zip python-embed.zip --out dist
  python tools/build_release.py --notes 1.2.0        prints that version's section of CHANGELOG.md

Creates in --out:
  EmergencyHub-<version>-windows.zip   everything needed on Windows, including Python, in one folder
  EmergencyHub-<version>-update.zip    the program files only, used by the app's own updater
  update.json                          version, file name, size and SHA-256 fingerprint of the update zip
  SHA256SUMS.txt                       fingerprints of both zips
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# Must match UPDATE_FILES / UPDATE_DIRS in server.py: an update zip may only contain these.
PROGRAM_FILES = ("VERSION", "server.py", "README.md", "CHANGELOG.md", "LICENSE", "Dockerfile", "contacts-template.csv")
PROGRAM_DIRS = ("static", "demo", "tools")
FULL_ONLY = ("start.bat",)          # never replaced by the updater
FOLDER = "Emergency Hub Coordinator"
STAMP = (2026, 1, 1, 0, 0, 0)       # fixed file times, so the same source always gives the same zip


def program_files():
    out = []
    for f in PROGRAM_FILES:
        if os.path.isfile(os.path.join(ROOT, f)):
            out.append(f)
    for d in PROGRAM_DIRS:
        for dp, dns, fns in os.walk(os.path.join(ROOT, d)):
            dns[:] = sorted(x for x in dns if x != "__pycache__")
            for fn in sorted(fns):
                if fn.endswith(".pyc"):
                    continue
                out.append(os.path.relpath(os.path.join(dp, fn), ROOT).replace(os.sep, "/"))
    return sorted(out)


def add(zf, arcname, data):
    info = zipfile.ZipInfo(arcname, STAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    zf.writestr(info, data)


def read(rel):
    with open(os.path.join(ROOT, rel), "rb") as f:
        return f.read()


def changelog_section(version):
    text = read("CHANGELOG.md").decode("utf-8")
    m = re.search(r"^## \[?%s\]?[^\n]*\n(.*?)(?=^## |\Z)" % re.escape(version), text, re.S | re.M)
    return (m.group(1).strip() if m else "Version %s" % version) + "\n"


def check_matches_server():
    """The updater in server.py must allow exactly the files this script ships."""
    import ast
    tree = ast.parse(read("server.py"))
    found = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and getattr(node.targets[0], "id", "") in ("UPDATE_FILES", "UPDATE_DIRS"):
            found[node.targets[0].id] = tuple(ast.literal_eval(node.value))
    if found.get("UPDATE_FILES") != PROGRAM_FILES or found.get("UPDATE_DIRS") != PROGRAM_DIRS:
        sys.exit("UPDATE_FILES / UPDATE_DIRS in server.py don't match PROGRAM_FILES / PROGRAM_DIRS here")


def build(python_zip, out):
    check_matches_server()
    version = read("VERSION").decode("utf-8").strip()
    if not re.match(r"^\d+\.\d+\.\d+$", version):
        sys.exit("VERSION must look like 1.2.3")
    files = program_files()
    os.makedirs(out, exist_ok=True)

    # the update zip: program files at the top level
    upd_name = "EmergencyHub-%s-update.zip" % version
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for rel in files:
            add(zf, rel, read(rel))
    upd = buf.getvalue()
    with open(os.path.join(out, upd_name), "wb") as f:
        f.write(upd)

    # the full Windows zip: one folder with the program, start.bat and Python
    full_name = "EmergencyHub-%s-windows.zip" % version
    with zipfile.ZipFile(os.path.join(out, full_name), "w") as zf:
        for rel in files + list(FULL_ONLY):
            add(zf, "%s/%s" % (FOLDER, rel), read(rel))
        if python_zip:
            with zipfile.ZipFile(python_zip) as pz:
                for info in pz.infolist():
                    if not info.filename.endswith("/"):
                        add(zf, "%s/python/%s" % (FOLDER, info.filename), pz.read(info))

    sha = hashlib.sha256(upd).hexdigest()
    with open(os.path.join(out, "update.json"), "w", encoding="utf-8") as f:
        json.dump({"version": version, "file": upd_name, "size": len(upd), "sha256": sha}, f, indent=1)
    with open(os.path.join(out, "SHA256SUMS.txt"), "w", encoding="utf-8") as f:
        for name in (full_name, upd_name):
            with open(os.path.join(out, name), "rb") as z:
                f.write("%s  %s\n" % (hashlib.sha256(z.read()).hexdigest(), name))
    print("Built version %s: %d program files%s" % (version, len(files), ", with Python" if python_zip else ""))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--python-zip", help="the Windows embeddable Python zip to include")
    ap.add_argument("--out", default="dist")
    ap.add_argument("--notes", metavar="VERSION", help="print the CHANGELOG section for VERSION and stop")
    a = ap.parse_args()
    if a.notes:
        sys.stdout.write(changelog_section(a.notes))
    else:
        build(a.python_zip, a.out)
