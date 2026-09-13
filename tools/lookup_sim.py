#!/usr/bin/env python3
"""
lookup_sim.py - replay the game's file lookup to predict whether a mod package's
overrides will win, and find padding entries that make them win.

How the game resolves a path (read from the 0.9.1+release.6 exe):

  1. For each package, in order (content.kspkg first, then mods\\*.kspkg), the
     table entries are APPENDED as {hash, flags, size, offset, package index}
     records to ONE shared vector, which is then re-sorted with std::sort
     (MSVC introsort, unstable).
  2. A read does std::lower_bound on that vector by path hash and takes the
     FIRST record with an equal hash. If nothing matches, loose-file search
     directories are tried.

Because the sort is unstable, when a mod package overrides a file that also
exists in the base package, which copy lower_bound finds depends on where the
introsort's swaps leave the two equal records -- i.e. on the whole set of hashes
in the mod package. This module replays MSVC's algorithm exactly so the outcome
can be computed offline for any package layout, and searches for a set of dummy
directory entries ("padding") under which every override resolves to the mod.

The base table is read straight from the installed content.kspkg, so the result
always matches the installed game version. Validated 2026-09-14 against seven
observed launches (see tests/test_lookup_sim.py).
"""
import os
import struct
import sys

KEY = 0x9F9721A97D1135C1
TABLE_SIZE = 0x4000000
ENTRY_SIZE = 0x100
MAX_ENTRIES = TABLE_SIZE // ENTRY_SIZE
HASH_OFFSET = 0xE8

ISORT_MAX = 32

DEFAULT_GAME_DIR = r"C:\Program Files (x86)\Steam\steamapps\common\Assetto Corsa EVO"

# Padding entries are directories under this path. They have no blob, the game
# never enumerates this folder, and the packer strips them from listings.
PAD_PARENT = "uiresources\\pad"


# ---- MSVC STL std::sort, faithfully -------------------------------------------------

def _med3(a, first, mid, last):
    if a[mid][0] < a[first][0]:
        a[mid], a[first] = a[first], a[mid]
    if a[last][0] < a[mid][0]:
        a[last], a[mid] = a[mid], a[last]
        if a[mid][0] < a[first][0]:
            a[mid], a[first] = a[first], a[mid]


def _guess_median(a, first, mid, last):
    count = last - first
    if count > 40:
        step = (count + 1) >> 3
        two_step = step << 1
        _med3(a, first, first + step, first + two_step)
        _med3(a, mid - step, mid, mid + step)
        _med3(a, last - two_step, last - step, last)
        _med3(a, first + step, mid, last - step)
    else:
        _med3(a, first, mid, last)


def _partition_by_median_guess(a, first, last):
    """MSVC STL _Partition_by_median_guess_unchecked. Returns (pfirst, plast)."""
    mid = first + ((last - first) >> 1)
    _guess_median(a, first, mid, last - 1)
    pfirst = mid
    plast = pfirst + 1
    while first < pfirst and not (a[pfirst - 1][0] < a[pfirst][0]) and not (a[pfirst][0] < a[pfirst - 1][0]):
        pfirst -= 1
    while plast < last and not (a[plast][0] < a[pfirst][0]) and not (a[pfirst][0] < a[plast][0]):
        plast += 1
    gfirst = plast
    glast = pfirst
    while True:
        while gfirst < last:
            if a[pfirst][0] < a[gfirst][0]:
                pass
            elif a[gfirst][0] < a[pfirst][0]:
                break
            elif plast != gfirst:
                a[plast], a[gfirst] = a[gfirst], a[plast]
                plast += 1
            else:
                plast += 1
            gfirst += 1
        while first < glast:
            if a[glast - 1][0] < a[pfirst][0]:
                pass
            elif a[pfirst][0] < a[glast - 1][0]:
                break
            else:
                pfirst -= 1
                if pfirst != glast - 1:
                    a[pfirst], a[glast - 1] = a[glast - 1], a[pfirst]
            glast -= 1
        if glast == first and gfirst == last:
            return pfirst, plast
        if glast == first:
            # no room at bottom, rotate pivot upward
            if plast != gfirst:
                a[pfirst], a[plast] = a[plast], a[pfirst]
            plast += 1
            a[pfirst], a[gfirst] = a[gfirst], a[pfirst]
            pfirst += 1
            gfirst += 1
        elif gfirst == last:
            # no room at top, rotate pivot downward
            glast -= 1
            pfirst -= 1
            if glast != pfirst:
                a[glast], a[pfirst] = a[pfirst], a[glast]
            plast -= 1
            a[pfirst], a[plast] = a[plast], a[pfirst]
        else:
            glast -= 1
            a[gfirst], a[glast] = a[glast], a[gfirst]
            gfirst += 1


def _insertion_sort(a, first, last):
    if first == last:
        return
    mid = first + 1
    while mid != last:
        hole = mid
        val = a[mid]
        if val[0] < a[first][0]:
            a[first + 1:mid + 1] = a[first:mid]
            a[first] = val
        else:
            prev = hole - 1
            while val[0] < a[prev][0]:
                a[hole] = a[prev]
                hole = prev
                prev -= 1
            a[hole] = val
        mid += 1


def _heap_sort(a, first, last):
    # depth-limit fallback; effectively unreachable for our sizes but kept for fidelity
    sub = a[first:last]
    sub.sort(key=lambda r: r[0])
    a[first:last] = sub


def msvc_sort(a, first, last, ideal):
    """MSVC STL _Sort_unchecked on a[first:last], comparing on element [0]."""
    while True:
        if last - first <= ISORT_MAX:
            _insertion_sort(a, first, last)
            return
        if ideal <= 0:
            _heap_sort(a, first, last)
            return
        pfirst, plast = _partition_by_median_guess(a, first, last)
        ideal = (ideal >> 1) + (ideal >> 2)
        if pfirst - first < last - plast:
            msvc_sort(a, first, pfirst, ideal)
            first = plast
        else:
            msvc_sort(a, plast, last, ideal)
            last = pfirst


def lower_bound(a, key):
    first, count = 0, len(a)
    while count > 0:
        half = count >> 1
        if a[first + half][0] < key:
            first += half + 1
            count -= half + 1
        else:
            count = half
    return first


# ---- base table ----------------------------------------------------------------------------

def read_base_hashes(kspkg_path):
    """Every entry hash of a package, in table order, read straight from the file."""
    hashes = []
    with open(kspkg_path, "rb") as f:
        f.seek(0, 2)
        f.seek(f.tell() - TABLE_SIZE)
        table = f.read(TABLE_SIZE)
    for i in range(MAX_ENTRIES):
        h = struct.unpack_from("<Q", table, i * ENTRY_SIZE + HASH_OFFSET)[0] ^ KEY
        if h == 0:
            break
        hashes.append(h)
    return hashes


def find_base_package(game_dir=None):
    game_dir = game_dir or os.environ.get("ACE_GAME_DIR") or DEFAULT_GAME_DIR
    path = os.path.join(game_dir, "content.kspkg")
    return path if os.path.exists(path) else None


# ---- prediction -----------------------------------------------------------------------------

def merged_after_mod(base_hashes, mod_hashes):
    """The shared vector after content.kspkg and one mod package were added."""
    a = [(h, "base") for h in base_hashes] + [(h, "mod") for h in sorted(mod_hashes)]
    sys.setrecursionlimit(max(sys.getrecursionlimit(), 10000))
    msvc_sort(a, 0, len(a), len(a))
    return a


def winners(base_hashes, mod_hashes):
    """For each mod hash: 'mod' if the mod's record is the one lower_bound finds."""
    a = merged_after_mod(base_hashes, mod_hashes)
    result = {}
    for h in mod_hashes:
        i = lower_bound(a, h)
        result[h] = a[i][1] if i < len(a) and a[i][0] == h else "none"
    return result


def pad_names(count):
    """The padding directory entries for a given count: the parent plus `count` children."""
    if count == 0:
        return []
    return [PAD_PARENT] + [f"{PAD_PARENT}\\{i:02d}" for i in range(count)]


def find_padding(base_hashes, mod_paths, override_paths, hash_fn, max_pad=64):
    """
    Smallest padding (list of directory paths) such that every override path
    resolves to the mod. Returns (padding, winners) or (None, winners_without_pad).
    """
    base_set = set(base_hashes)
    for h in (hash_fn(p) for p in override_paths):
        if h not in base_set:
            raise ValueError("override path is not in the base package")
    best = None
    for count in range(0, max_pad + 1):
        pad = pad_names(count)
        hashes = [hash_fn(p) for p in list(mod_paths) + pad]
        w = winners(base_hashes, hashes)
        if best is None:
            best = w
        if all(w[hash_fn(p)] == "mod" for p in override_paths):
            return pad, w
    return None, best


if __name__ == "__main__":
    print(__doc__)
