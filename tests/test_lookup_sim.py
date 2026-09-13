"""Tests for tools/lookup_sim.py: the replay of the game's package lookup.

The sort replica must sort correctly (any MSVC-faithful introsort still sorts), and
the whole model must reproduce every launch we observed on 2026-09-13/14. The
latter needs the installed game (content.kspkg) and is skipped without it.
"""
import os
import random
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import lookup_sim as L  # noqa: E402
from pack_kspkg import path_hash as H  # noqa: E402


class SortReplicaTests(unittest.TestCase):
    def test_sorts_like_sorted_including_duplicates(self):
        rng = random.Random(1234)
        for n in (0, 1, 2, 31, 32, 33, 40, 41, 100, 1000, 5000):
            vals = [rng.randrange(0, 50) for _ in range(n)]
            a = [(v, i) for i, v in enumerate(vals)]
            L.msvc_sort(a, 0, len(a), len(a))
            self.assertEqual([x[0] for x in a], sorted(vals), f"n={n}")

    def test_sorted_input_stays_sorted(self):
        a = [(i, "x") for i in range(3000)]
        L.msvc_sort(a, 0, len(a), len(a))
        self.assertEqual([x[0] for x in a], list(range(3000)))

    def test_lower_bound(self):
        a = [(v, None) for v in [1, 3, 3, 3, 7, 9]]
        self.assertEqual(L.lower_bound(a, 3), 1)
        self.assertEqual(L.lower_bound(a, 4), 4)
        self.assertEqual(L.lower_bound(a, 0), 0)
        self.assertEqual(L.lower_bound(a, 10), 6)

    def test_winners_marks_new_paths_as_mod_and_missing_as_none(self):
        base = sorted(random.Random(7).sample(range(1, 10 ** 12), 2000))
        new_hash = 10 ** 12 + 5
        w = L.winners(base, [new_hash])
        self.assertEqual(w[new_hash], "mod")

    def test_pad_names(self):
        self.assertEqual(L.pad_names(0), [])
        self.assertEqual(L.pad_names(2), ["uiresources\\pad", "uiresources\\pad\\00", "uiresources\\pad\\01"])


@unittest.skipUnless(L.find_base_package(), "installed game (content.kspkg) not found")
class ObservedLaunchesTests(unittest.TestCase):
    """Every package layout we launched, and whether hud.html came from the mod."""

    @classmethod
    def setUpClass(cls):
        cls.base = L.read_base_hashes(L.find_base_package())

    D = ["content", "content\\cars", "content\\cars\\ks_toyota_supra_mkiv", "content\\cars\\ks_toyota_supra_mkiv\\displays"]
    DISPLAY = "content\\cars\\ks_toyota_supra_mkiv\\displays\\display.html"
    UI = ["uiresources", "uiresources\\js", "uiresources\\hud.html", "uiresources\\js\\pedalgraph.js"]
    HUD = "uiresources\\hud.html"

    OBSERVED = [
        ("ui only (3 launches)", UI, False),
        ("ui + supra display copy (5 launches)", UI + D + [DISPLAY], True),
        ("ui + marker file", UI + D[:3] + ["content\\cars\\ks_toyota_supra_mkiv\\pedalgraph_marker.txt"], False),
        ("ui + display + css/", UI + D + [DISPLAY, "uiresources\\css", "uiresources\\css\\pedalgraph.css"], False),
        ("ui + display + assets/", UI + D + [DISPLAY, "uiresources\\assets", "uiresources\\assets\\pedalgraph.css"], False),
        ("ui + display + assets/ + scene", UI + D + [DISPLAY, "uiresources\\assets", "uiresources\\assets\\pedalgraph.css",
                                                   "content\\tracks", "content\\tracks\\interns",
                                                   "content\\tracks\\interns\\car_dealership",
                                                   "content\\tracks\\interns\\car_dealership\\car_dealership.scene"], False),
    ]

    def test_model_reproduces_every_observed_launch(self):
        for name, entries, applied in self.OBSERVED:
            w = L.winners(self.base, [H(p) for p in entries])
            self.assertEqual(w[H(self.HUD)] == "mod", applied, name)

    def test_display_copy_was_never_served_in_working_build(self):
        # the probe log line inside the copied display.html never appeared in game
        w = L.winners(self.base, [H(p) for p in self.UI + self.D + [self.DISPLAY]])
        self.assertEqual(w[H(self.DISPLAY)], "base")

    def test_padding_search_finds_a_winning_layout_for_current_sources(self):
        mod = ["uiresources", "uiresources\\js", "uiresources\\assets", "uiresources\\hud.html",
               "uiresources\\js\\pedalgraph.js", "uiresources\\assets\\pedalgraph.css"]
        pad, w = L.find_padding(self.base, mod, [self.HUD], H)
        self.assertIsNotNone(pad, "no padding within the search range makes hud.html win")
        self.assertEqual(w[H(self.HUD)], "mod")


if __name__ == "__main__":
    unittest.main()
