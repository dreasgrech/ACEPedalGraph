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
  python pack_kspkg.py <source_dir> <output.kspkg> [--encrypt]

Every file below <source_dir> is stored with its path relative to <source_dir>,
so <source_dir>/uiresources/hud.html becomes "uiresources\\hud.html" in the package.
"""
import os
import struct
import sys

KEY = 0x9F9721A97D1135C1
KEY_BYTES = KEY.to_bytes(8, "little")
HEADER_SIZE = 0x100000
TABLE_SIZE = 0x4000000
ENTRY_SIZE = 0x100
PATH_FIELD = 0xE0
BLOB_ALIGN = 0x100000
FLAG_DIR = 0x1
FLAG_XOR = 0x100
FNV_PRIME = 0x100000001B3
FNV_OFFSET = 0xCBF29CE484222325
MASK64 = 0xFFFFFFFFFFFFFFFF


def fnv1a64(data: bytes) -> int:
    h = FNV_OFFSET
    for b in data:
        h = ((h ^ b) * FNV_PRIME) & MASK64
    return h


def path_hash(path: str) -> int:
    return fnv1a64(path.lower().replace("/", "\\").encode("utf-16-le"))


def xor_buffer(buf: bytearray) -> None:
    n = len(buf)
    full = n - (n % 8)
    # fast path: view as 64-bit words
    words = memoryview(buf)[:full].cast("Q")
    for i in range(len(words)):
        words[i] ^= KEY
    for i in range(full, n):
        buf[i] ^= KEY_BYTES[i % 8]


def collect(source_dir: str):
    files = []
    dirs = set()
    for root, dirnames, filenames in os.walk(source_dir):
        rel_root = os.path.relpath(root, source_dir)
        if rel_root != ".":
            dirs.add(rel_root.replace("/", "\\").lower())
        for name in filenames:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, source_dir).replace("/", "\\").lower()
            files.append((rel, full))
    return sorted(files), sorted(dirs)


def make_entry(path: str, flags: int, size: int, offset: int) -> bytes:
    raw = path.encode("ascii")
    if len(raw) >= PATH_FIELD:
        raise ValueError(f"path too long for table entry: {path}")
    return (raw.ljust(PATH_FIELD, b"\0")
            + struct.pack("<ihh", 0, flags, len(raw))
            + struct.pack("<Q", path_hash(path))
            + struct.pack("<qq", size, offset))


def pack(source_dir: str, out_path: str, encrypt: bool = False) -> None:
    files, dirs = collect(source_dir)
    if not files:
        raise SystemExit(f"no files found under {source_dir}")

    entries = []
    for d in dirs:
        entries.append((path_hash(d), make_entry(d, FLAG_DIR, 0, 0)))

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
            print(f"  {rel}  ({len(data)} bytes @ 0x{offset:X})")
            offset += len(data)

        pad = (-offset) % BLOB_ALIGN
        out.write(b"\0" * pad)

        entries.sort(key=lambda e: e[0])
        if len(entries) >= TABLE_SIZE // ENTRY_SIZE:
            raise SystemExit("too many entries for the file table")
        hashes = [h for h, _ in entries]
        if len(set(hashes)) != len(hashes):
            raise SystemExit("hash collision between entries")

        table = bytearray(TABLE_SIZE)
        pos = 0
        for _, ent in entries:
            table[pos:pos + ENTRY_SIZE] = ent
            pos += ENTRY_SIZE
        xor_buffer(table)
        out.write(table)

    total = HEADER_SIZE + (offset - HEADER_SIZE) + pad + TABLE_SIZE
    print(f"wrote {out_path}: {len(files)} files, {len(dirs)} dirs, {total} bytes")


def selftest() -> None:
    # Known entry from Kunos' sample mod package.
    expect = 0x62C8DEBE5C3DA
    got = path_hash("content\\cars\\ks_modded_car\\materials\\ext_disc.material")
    assert got == expect, f"hash self-test failed: {got:#x} != {expect:#x}"


if __name__ == "__main__":
    selftest()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        sys.exit(1)
    pack(args[0], args[1], encrypt="--encrypt" in sys.argv)
