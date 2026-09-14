"""The shared ACEUIModLoader test kit (modkit.py in the loader repo) plus the widget's own contract."""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOADER = os.environ.get("ACE_LOADER_DIR") or os.path.join(os.path.dirname(ROOT), "ACEUIModLoader")
sys.path.insert(0, os.path.join(LOADER, "tools"))

from modkit import ModTests  # noqa: E402

JS = os.path.join(ROOT, "pedalgraph", "pedalgraph.js")


class Tests(ModTests):
    ROOT = ROOT
    MIN_CASES = 13
    HOT_PATH = ("const commitSample", "// ---- lifecycle")


class WidgetContractTests(unittest.TestCase):
    """What the widget promises beyond the kit's rules (each line was once a bug or a crash)."""

    def setUp(self):
        with open(JS, encoding="utf-8") as f:
            self.js = f.read()

    def test_draws_with_transforms_only(self):
        # rebuilding SVG geometry per frame crashed the game inside Renoir; bars are fixed elements scaled by transform
        self.assertIn("scaleY(", self.js)
        self.assertEqual(self.js.count("root.innerHTML = markup()"), 1, "markup built once, at attach")

    def test_samples_at_a_fixed_rate_through_the_library(self):
        self.assertIn("ACEUIModLoader.loop.sampler(", self.js)
        self.assertIn("ACEUIModLoader.loop.advance(", self.js)


if __name__ == "__main__":
    unittest.main()
