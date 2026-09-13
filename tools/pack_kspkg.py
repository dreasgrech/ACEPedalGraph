#!/usr/bin/env python3
"""
pack_kspkg.py - build an Assetto Corsa EVO .kspkg mod package from a folder.

Format (reverse-engineered by the community, verified against Kunos' sample mod
ks_modded_car.kspkg from the official SDK documentation):

  [0x100000 bytes zero header]
  [file blobs, packed back to back]
  [padding so the blob area ends on a 1 MB boundary]
  [file table: 0x4000000 bytes (64 MB), 0x100 bytes per entry, XOR-obfuscated]

Table entry (little endian):
  0x00  char[0xE0]  path, lower case, backslash separators, NUL padded
  0xE0  int32       always 0
  0xE4  uint16      flags: 1 = directory, 0x100 = blob XOR-obfuscated
  0xE6  int16       path length
  0xE8  uint64      FNV-1a 64 of the path encoded as UTF-16LE (game does bsearch on this)
  0xF0  int64       file size
  0xF8  int64       blob offset

Entries are sorted by hash ascending; the game stops reading at the first entry
whose hash is 0. The whole table is XOR'd with the 8-byte key 0x9F9721A97D1135C1.

Usage:
  python pack_kspkg.py <source_dir> <output.kspkg> [--encrypt] [--install] [--no-verify]

  --encrypt    XOR the file blobs as well (official content does; mods need not)
  --install    copy the result to %USERPROFILE%\\Saved Games\\ACE\\mods\\
  --no-verify  skip re-reading the package to check every entry

Every file below <source_dir> is stored with its path relative to <source_dir>,
so <source_dir>/uiresources/hud.html becomes "uiresources\\hud.html" in the package.
"""
import os
import shutil
import struct
import sys

KEY = 0x9F9721A97D1135C1
KEY_BYTES = KEY.to_bytes(8, "little")
HEADER_SIZE = 0x100000
TABLE_SIZE = 0x4000000
ENTRY_SIZE = 0x100
MAX_ENTRIES = TABLE_SIZE // ENTRY_SIZE
PATH_FIELD = 0xE0
BLOB_ALIGN = 0x100000
FLAG_DIR = 0x1
FLAG_XOR = 0x100
FNV_PRIME = 0x100000001B3
FNV_OFFSET = 0xCBF29CE484222325
MASK64 = 0xFFFFFFFFFFFFFFFF

# files that must never end up in a package
IGNORED_NAMES = {".gitkeep", ".gitignore", "desktop.ini", "thumbs.db", ".ds_store"}
IGNORED_SUFFIXES = (".pyc", ".swp", ".tmp", "~")


def fnv1a64(data: bytes) -> int:
    h = FNV_OFFSET
    for b in data:
        h = ((h ^ b) * FNV_PRIME) & MASK64
    return h


def normalize(path: str) -> str:
    return path.replace("/", "\\").lower()


def path_hash(path: str) -> int:
    return fnv1a64(normalize(path).encode("utf-16-le"))


def xor_buffer(buf: bytearray) -> None:
    n = len(buf)
    full = n - (n % 8)
    words = memoryview(buf)[:full].cast("Q")
    for i in range(len(words)):
        words[i] ^= KEY
    for i in range(full, n):
        buf[i] ^= KEY_BYTES[i % 8]


def collect(source_dir: str):
    files = []
    dirs = set()
    for root, dirnames, filenames in os.walk(source_dir):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "__pycache__"]
        rel_root = os.path.relpath(root, source_dir)
        if rel_root != ".":
            dirs.add(normalize(rel_root))
        for name in filenames:
            lname = name.lower()
            if lname in IGNORED_NAMES or lname.endswith(IGNORED_SUFFIXES):
                print(f"  (skipping {os.path.join(rel_root, name)})")
                continue
            full = os.path.join(root, name)
            files.append((normalize(os.path.relpath(full, source_dir)), full))
    return sorted(files), sorted(dirs)


def make_entry(path: str, flags: int, size: int, offset: int) -> bytes:
    try:
        raw = path.encode("ascii")
    except UnicodeEncodeError:
        raise SystemExit(f"non-ASCII characters in path are not supported: {path!r}")
    if len(raw) >= PATH_FIELD:
        raise SystemExit(f"path too long for table entry ({len(raw)} >= {PATH_FIELD}): {path}")
    return (raw.ljust(PATH_FIELD, b"\0")
            + struct.pack("<ihh", 0, flags, len(raw))
            + struct.pack("<Q", path_hash(path))
            + struct.pack("<qq", size, offset))


def pack(source_dir: str, out_path: str, encrypt: bool = False) -> list:
    files, dirs = collect(source_dir)
    if not files:
        raise SystemExit(f"no files found under {source_dir}")

    entries = [(path_hash(d), make_entry(d, FLAG_DIR, 0, 0)) for d in dirs]
    written = []   # (rel, full, offset, size, flags) for verification

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as out:
        out.write(b"\0" * HEADER_SIZE)
        offset = HEADER_SIZE
        for rel, full in files:
            with open(full, "rb") as fh:
                data = bytearray(fh.read())
            flags = 0
            if encrypt:
                xor_buffer(data)
                flags |= FLAG_XOR
            out.write(data)
            entries.append((path_hash(rel), make_entry(rel, flags, len(data), offset)))
            written.append((rel, full, offset, len(data), flags))
            print(f"  {rel}  ({len(data)} bytes @ 0x{offset:X})")
            offset += len(data)

        pad = (-offset) % BLOB_ALIGN
        out.write(b"\0" * pad)

        if len(entries) >= MAX_ENTRIES:
            raise SystemExit(f"too many entries for the file table ({len(entries)} >= {MAX_ENTRIES})")
        entries.sort(key=lambda e: e[0])
        hashes = [h for h, _ in entries]
        if len(set(hashes)) != len(hashes):
            raise SystemExit("hash collision between entries")

        # Only the used prefix of the table needs real XOR work; the zero-padded
        # remainder XORs to the repeated key, which we can emit directly.
        used = bytearray().join(ent for _, ent in entries)
        xor_buffer(used)
        out.write(used)
        remaining = TABLE_SIZE - len(used)
        out.write(KEY_BYTES * (remaining // 8))

    total = offset + pad + TABLE_SIZE
    print(f"wrote {out_path}: {len(files)} files, {len(dirs)} dirs, {total} bytes")
    return written


def verify(out_path: str, written: list) -> None:
    """Re-read the package the way the game would and compare against the sources."""
    with open(out_path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        if size % BLOB_ALIGN != 0:
            raise SystemExit(f"verify: package size {size} is not 1 MB aligned")
        f.seek(size - TABLE_SIZE)
        table = bytearray(f.read(TABLE_SIZE))
        xor_buffer(table)

        entries = {}
        prev = -1
        for i in range(MAX_ENTRIES):
            e = table[i * ENTRY_SIZE:(i + 1) * ENTRY_SIZE]
            h = struct.unpack_from("<Q", e, 0xE8)[0]
            if h == 0:
                break
            if h <= prev:
                raise SystemExit("verify: table is not strictly sorted by hash")
            prev = h
            plen = struct.unpack_from("<h", e, 0xE6)[0]
            path = bytes(e[:plen]).decode("ascii")
            if path_hash(path) != h:
                raise SystemExit(f"verify: hash mismatch for {path}")
            flags, = struct.unpack_from("<H", e, 0xE4)
            fsize, foff = struct.unpack_from("<qq", e, 0xF0)
            entries[path] = (flags, fsize, foff)

        for rel, full, offset, fsize, flags in written:
            if rel not in entries:
                raise SystemExit(f"verify: {rel} missing from table")
            tflags, tsize, toff = entries[rel]
            if (tflags, tsize, toff) != (flags, fsize, offset):
                raise SystemExit(f"verify: table entry mismatch for {rel}")
            f.seek(toff)
            data = bytearray(f.read(tsize))
            if tflags & FLAG_XOR:
                xor_buffer(data)
            with open(full, "rb") as src:
                if bytes(data) != src.read():
                    raise SystemExit(f"verify: blob content mismatch for {rel}")
    print(f"verified {len(written)} files, {len(entries)} table entries OK")


def install(out_path: str) -> None:
    mods = os.path.join(os.path.expanduser("~"), "Saved Games", "ACE", "mods")
    os.makedirs(mods, exist_ok=True)
    dest = os.path.join(mods, os.path.basename(out_path))
    shutil.copyfile(out_path, dest)
    print(f"installed {dest}")


def selftest() -> None:
    # Known entry from Kunos' sample mod package.
    expect = 0x62C8DEBE5C3DA
    got = path_hash("content\\cars\\ks_modded_car\\materials\\ext_disc.material")
    assert got == expect, f"hash self-test failed: {got:#x} != {expect:#x}"


def read_version() -> str:
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "VERSION")
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return "unknown"


if __name__ == "__main__":
    selftest()
    print(f"PedalGraph version {read_version()}")
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    unknown = flags - {"--encrypt", "--install", "--no-verify"}
    if len(args) != 2 or unknown:
        print(__doc__)
        sys.exit(1)
    written = pack(args[0], args[1], encrypt="--encrypt" in flags)
    if "--no-verify" not in flags:
        verify(args[1], written)
    if "--install" in flags:
        install(args[1])
