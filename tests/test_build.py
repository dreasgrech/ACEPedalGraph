"""Builds the real src/ with the loader's packer and checks the game would honour it.

Needs the ACEUIModLoader and ACEGameInternals repos next to this one (or the
ACE_LOADER_DIR / ACE_INTERNALS_DIR variables). Skipped otherwise.
"""
import os
import struct
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOADER = os.environ.get("ACE_LOADER_DIR") or os.path.join(os.path.dirname(ROOT), "ACEUIModLoader")
HAVE_LOADER = os.path.isfile(os.path.join(LOADER, "tools", "pack_kspkg.py"))
if HAVE_LOADER:
    sys.path.insert(0, os.path.join(LOADER, "tools"))


@unittest.skipUnless(HAVE_LOADER, "ACEUIModLoader checkout not found next to this repo")
class BuildTests(unittest.TestCase):
    def test_source_builds_and_hud_override_is_predicted_to_win(self):
        import pack_kspkg as pk
        import lookup_sim
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "pedalgraph.kspkg")
            written = pk.pack(os.path.join(ROOT, "src"), out)
            pk.verify(out, written)
            paths = {rel for rel, *_ in written}
            self.assertEqual(paths, {"uiresources\\hud.html", "uiresources\\js\\pedalgraph.js",
                                     "uiresources\\assets\\pedalgraph.css"})
            base_pkg = lookup_sim.find_base_package()
            if not base_pkg:
                self.skipTest("game not installed; padding prediction not checked")
            with open(out, "rb") as f:
                f.seek(0, 2)
                f.seek(f.tell() - pk.TABLE_SIZE)
                table = bytearray(f.read(pk.TABLE_SIZE))
            pk.xor_buffer(table)
            hashes = []
            for i in range(pk.MAX_ENTRIES):
                h = struct.unpack_from("<Q", table, i * pk.ENTRY_SIZE + 0xE8)[0]
                if h == 0:
                    break
                hashes.append(h)
            base = lookup_sim.read_base_hashes(base_pkg)
            w = lookup_sim.winners(base, hashes)
            self.assertEqual(w[pk.path_hash("uiresources\\hud.html")], "mod", "hud.html override would lose")


if __name__ == "__main__":
    unittest.main()
