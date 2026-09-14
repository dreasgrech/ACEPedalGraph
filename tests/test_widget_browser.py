"""Runs tests/widget/harness.html in a headless Chromium (Edge or Chrome) and
checks every case passed.

The harness loads the AceMods library from the sibling ACEUIModLoader checkout
(in game it is part of cohtml.js), fakes requestAnimationFrame, localStorage and
ModelCurrentCar, and exercises the widget's sampling, scrolling, clamping and
lifecycle deterministically. It does not prove Cohtml compatibility; see
test_sources.py for the static rules that cover the known Cohtml pitfalls, and
the loader's tools/check_ingame_log.py for the in-game smoke test.

The runner (tools/headless.py in ACEUIModLoader) uses a throwaway profile, kills
the process tree on timeout and verifies no browser process is left behind.
"""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import install  # noqa: E402

sys.path.insert(0, os.path.join(install.loader_dir(), "tools"))
import headless  # noqa: E402

HARNESS = os.path.join(ROOT, "tests", "widget", "harness.html")
MIN_CASES = 12


class WidgetBrowserTests(unittest.TestCase):
    def test_widget_harness_all_pass(self):
        headless.check_harness(self, HARNESS, MIN_CASES)


if __name__ == "__main__":
    unittest.main()
