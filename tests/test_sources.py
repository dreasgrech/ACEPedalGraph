"""Static regression checks on the shipped UI sources.

These guard against the mistakes that already bit us once:
  - anything that rebuilds geometry per frame (SVG paths) crashes the game
  - CSS var() fallback syntax is not supported by the game's Cohtml build
  - hud.html must keep the stock structure and only add our hooks
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUD = os.path.join(ROOT, "src", "uiresources", "hud.html")
JS = os.path.join(ROOT, "src", "uiresources", "js", "pedalgraph.js")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def strip_js(src):
    """Remove comments and string literals so bracket counting is meaningful."""
    src = re.sub(r"//[^\n]*", "", src)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`", "''", src)
    return src


class HudHtmlTests(unittest.TestCase):
    def setUp(self):
        self.html = read(HUD)

    def test_stock_scripts_and_styles_present_in_order(self):
        order = ["js/cohtml.js", "js/components.js", "js/pedalgraph.js",
                 "css/ui.css", "css/uicomponents.css"]
        positions = [self.html.find(s) for s in order]
        self.assertTrue(all(p >= 0 for p in positions), positions)
        self.assertEqual(positions, sorted(positions), "load order changed")

    def test_pedalgraph_script_is_a_module_after_components(self):
        m = re.search(r"<script type=\"module\" src='js/pedalgraph.js'></script>", self.html)
        self.assertIsNotNone(m)

    def test_source_tag_set_before_widget_script(self):
        tag = self.html.find('window.PEDALGRAPH_SOURCE = "kspkg"')
        script = self.html.find("js/pedalgraph.js")
        self.assertGreater(tag, 0)
        self.assertLess(tag, script)

    def test_widget_element_inside_absolutecenter(self):
        self.assertEqual(self.html.count("<ace-pedalgraph"), 1)
        center = self.html.find('class="absolutecenter"')
        elem = self.html.find("<ace-pedalgraph")
        end = self.html.find("<ks-modaldialog>")
        self.assertTrue(center < elem < end)

    def test_stock_hud_elements_untouched(self):
        for needle in ['<ks-hud id="mainHUD"', '<ks-hud-freeroam id="mainHUD"',
                       "<ks-dev-reloadbutton>", "<ks-modaldialog>",
                       'GAMEMODETYPE.Racing', 'GAMEMODETYPE.Freeroam',
                       'data-bind-process="APF().process({{ModelUISessionState}})"']:
            self.assertIn(needle, self.html, needle)


class WidgetSourceTests(unittest.TestCase):
    def setUp(self):
        self.js = read(JS)
        self.code = strip_js(self.js)

    def test_brackets_balanced(self):
        for a, b in ("()", "{}", "[]"):
            self.assertEqual(self.code.count(a), self.code.count(b), f"unbalanced {a}{b}")

    def test_no_per_frame_geometry(self):
        # SVG geometry rebuilt per frame crashed the game (Renoir buddy allocator).
        self.assertNotIn("<svg", self.js.lower())
        self.assertNotIn('setAttribute("d"', self.js)
        self.assertNotIn("<canvas", self.js.lower())
        self.assertNotIn("getContext(", self.js)

    def test_no_css_var_fallback_syntax(self):
        self.assertIsNone(re.search(r"var\(--[a-z0-9-]+\s*,", self.js),
                          "var(--x, fallback) is not supported by the game's Cohtml")

    def test_only_transforms_change_in_hot_path(self):
        hot = self.js[self.js.find("commitSample("):self.js.find("// ---- drag")]
        self.assertNotIn("innerHTML", hot)
        self.assertNotIn("appendChild", hot)
        self.assertNotIn("style.width", hot)
        self.assertNotIn("style.height", hot)
        self.assertNotIn("style.left", hot)

    def test_constants_consistent(self):
        hz = int(re.search(r"const SAMPLE_HZ = (\d+)", self.js).group(1))
        win = int(re.search(r"const WINDOW_S = (\d+)", self.js).group(1))
        self.assertIn("const N = SAMPLE_HZ * WINDOW_S", self.js)
        self.assertGreaterEqual(hz, 20)
        self.assertLessEqual(hz * win * 2 * 4, 4000, "too many bar elements for the UI")

    def test_reads_expected_model_fields(self):
        for key in ("gas_percent", "brake_percent", "clutch_percent", "handbrake_percent"):
            self.assertIn(f'"{key}"', self.js)
        self.assertIn('window["ModelCurrentCar"]', self.js)

    def test_registers_custom_element_once_and_logs_tag(self):
        self.assertEqual(self.js.count('customElements.define("ace-pedalgraph"'), 1)
        self.assertIn('customElements.get("ace-pedalgraph")', self.js)
        self.assertIn("[PedalGraph] script loaded", self.js)

    def test_lifecycle_cleanup(self):
        self.assertIn("disconnectedCallback", self.js)
        self.assertIn("cancelAnimationFrame", self.js)
        self.assertIn('window.removeEventListener("mousemove"', self.js)
        self.assertIn('window.removeEventListener("mouseup"', self.js)


if __name__ == "__main__":
    unittest.main()
