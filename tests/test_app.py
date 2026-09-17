"""The shared ACEUIAppLoader test kit (appkit.py in the loader repo) plus the widget's own contract."""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOADER = os.environ.get("ACE_LOADER_DIR") or os.path.join(os.path.dirname(ROOT), "ACEUIAppLoader")
sys.path.insert(0, os.path.join(LOADER, "tools"))

from appkit import AppTests  # noqa: E402

JS = os.path.join(ROOT, "pedalgraph", "pedalgraph.js")


class Tests(AppTests):
    ROOT = ROOT
    MIN_CASES = 28
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
        self.assertIn("ACEUIAppLoader.loop.sampler(", self.js)
        self.assertIn("ACEUIAppLoader.loop.advance(", self.js)

    def test_options_go_through_the_loader(self):
        # the loader stores the values, draws the window and lists the app in the drawer;
        # the widget declares once at load and applies with classes, never by rebuilding
        self.assertEqual(self.js.count("settings.define("), 1, "one declaration, at script load")
        self.assertIn("me.scaleSpec(", self.js, "the panel scale is the loader's shared spec")
        self.assertIn("me.scale(root", self.js, "and the loader applies it")
        self.assertIn("settings.onChange(me.name", self.js, "changes reach the live widget")
        self.assertIn("unsubscribeSettings()", self.js, "and detach lets go of the listener")
        self.assertNotIn("localStorage", self.js)

    def test_every_view_option_is_a_class_in_the_stylesheet(self):
        with open(os.path.join(ROOT, "pedalgraph", "pedalgraph.css"), encoding="utf-8") as f:
            css = f.read()
        for cls in ("pg-off", "pg-nolevels", "pg-noreadouts", "pg-nogrid", "pg-low", "pg-tall", "pg-faint", "pg-bold",
                    "pg-bg-light", "pg-bg-none", "pg-mark"):
            self.assertIn("." + cls, css, cls)
        # every length inside the panel is em, so one font-size on the root scales it all
        inside = css[css.index(".ace-pedalgraph .pg-header"):]
        self.assertNotIn("rem", inside, "lengths inside the panel must be em, not rem, or the scale option skips them")


if __name__ == "__main__":
    unittest.main()
