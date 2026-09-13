#!/usr/bin/env python3
"""
build.py - build (and optionally install) the PedalGraph package.

Thin wrapper: the packer lives in the ACEUIModLoader repository (which in turn
uses ACEGameInternals). Both are expected next to this repo, or pointed at by
ACE_LOADER_DIR / ACE_INTERNALS_DIR.

Usage:
  python tools/build.py [--install] [--no-pad] [--no-verify]
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def loader_dir():
    for c in (os.environ.get("ACE_LOADER_DIR"), os.path.join(os.path.dirname(ROOT), "ACEUIModLoader")):
        if c and os.path.isfile(os.path.join(c, "tools", "pack_kspkg.py")):
            return c
    raise SystemExit("ACEUIModLoader not found: clone it next to this repo or set ACE_LOADER_DIR")


if __name__ == "__main__":
    packer = os.path.join(loader_dir(), "tools", "pack_kspkg.py")
    cmd = [sys.executable, packer, os.path.join(ROOT, "src"), os.path.join(ROOT, "dist", "pedalgraph.kspkg")] + sys.argv[1:]
    sys.exit(subprocess.call(cmd))
