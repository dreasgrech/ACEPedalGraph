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
    MIN_CASES = 30
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

    def test_the_strip_overhangs_the_graph_by_the_bar_widening(self):
        # bars are widened 1.5 px to the left; without the strip overhanging the clip by the
        # same amount, the next sample's bar pokes into the right edge (a wobble that follows
        # the live value) and the wrapped newest bar into the left edge (a hairline)
        with open(os.path.join(ROOT, "pedalgraph", "pedalgraph.css"), encoding="utf-8") as f:
            css = f.read()
        strips = css[css.index(".ace-pedalgraph .pg-strips {"):]
        strips = strips[:strips.index("}")]
        self.assertIn("left: -1.5px;", strips)
        self.assertIn("right: -1.5px;", strips)
        import re
        rules = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        self.assertNotIn("calc(", rules, "Cohtml did not apply calc(200% + 6px) even from the stylesheet: the graph came up empty in game")
        self.assertIn("margin-left: -1.5px;", css)
        self.assertIn('el("div", CLASS.strips) + tracks + close("div")', self.js, "the strips sit in the overhanging box")
        self.assertIn("const EDGE_PX = 1.5;", self.js, "the script computes slopes against the strip's slot width")
        self.assertIn("(graph.offsetWidth + 2 * EDGE_PX)", self.js)

    def test_every_view_option_is_a_class_in_the_stylesheet(self):
        with open(os.path.join(ROOT, "pedalgraph", "pedalgraph.css"), encoding="utf-8") as f:
            css = f.read()
        for cls in ("pg-off", "pg-nolegend", "pg-nolevels", "pg-noreadouts", "pg-nogrid", "pg-low", "pg-tall", "pg-faint", "pg-bold",
                    "pg-bg-light", "pg-bg-none", "pg-mark", "pg-marks", "pg-row"):
            self.assertIn("." + cls, css, cls)
        # every length inside the panel is em, so one font-size on the root scales it all
        inside = css[css.index(".ace-pedalgraph .pg-header"):]
        self.assertNotIn("rem", inside, "lengths inside the panel must be em, not rem, or the scale option skips them")


class ReadmeTests(unittest.TestCase):
    """The README is the release page. It has to say which version it describes and show
    pictures that exist; a stale number or a broken image is the first thing a visitor sees."""

    def setUp(self):
        import json
        import re
        with open(os.path.join(ROOT, "README.md"), encoding="utf-8") as f:
            self.readme = f.read()
        with open(os.path.join(ROOT, "pedalgraph", "app.json"), encoding="utf-8") as f:
            self.version = json.load(f)["version"]
        self.re = re

    def test_it_states_the_version_of_app_json(self):
        self.assertIn(self.version, self.readme, "the README's version must be app.json's")

    def test_every_picture_it_promises_is_actually_there(self):
        for src in self.re.findall(r'src="(docs/images/[^"]+)"', self.readme):
            self.assertTrue(os.path.isfile(os.path.join(ROOT, src)), src)

    def test_it_installs_the_way_the_release_zip_is_built(self):
        self.assertIn("Saved Games\\ACE", self.readme)
        self.assertIn("releases/latest", self.readme, "it points at the download")


if __name__ == "__main__":
    unittest.main()
