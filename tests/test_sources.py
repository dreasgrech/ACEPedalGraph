"""Static regression checks on the shipped UI sources.

These guard against the mistakes that already bit us once, and against drifting
away from the project's JavaScript style:
  - anything that rebuilds geometry per frame (SVG paths) crashes the game
  - CSS var() fallback syntax is not supported by the game's Cohtml build
  - hud.html must keep the stock structure and only add our hooks
  - style: IIFE modules, function expressions, let/const, no classes, no `this`
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
    """Remove comments and string literals so token counting is meaningful."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"//[^\n]*", "", src)
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

    def test_pedalgraph_script_is_deferred_classic_script(self):
        # classic (non-module) so `const PedalGraph` is a page-wide binding; deferred so
        # the #pedalgraph element exists when the boot block runs
        self.assertIsNotNone(re.search(r"<script defer src='js/pedalgraph.js'></script>", self.html))
        self.assertNotIn('type="module" src=\'js/pedalgraph.js\'', self.html)

    def test_source_tag_set_before_widget_script(self):
        tag = self.html.find('window.PEDALGRAPH_SOURCE = "kspkg"')
        script = self.html.find("js/pedalgraph.js")
        self.assertGreater(tag, 0)
        self.assertLess(tag, script)

    def test_widget_root_inside_absolutecenter(self):
        self.assertEqual(self.html.count('id="pedalgraph"'), 1)
        center = self.html.find('class="absolutecenter"')
        elem = self.html.find('id="pedalgraph"')
        end = self.html.find("<ks-modaldialog>")
        self.assertTrue(center < elem < end)
        self.assertNotIn("<ace-pedalgraph", self.html, "custom element replaced by a plain div")

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
        hot = self.js[self.js.find("const commitSample"):self.js.find("// ---- drag")]
        for forbidden in ("innerHTML", "appendChild", "style.width", "style.height", "style.left"):
            self.assertNotIn(forbidden, hot, forbidden)

    def test_constants_consistent(self):
        hz = int(re.search(r"const SAMPLE_HZ = (\d+)", self.js).group(1))
        win = int(re.search(r"const WINDOW_S = (\d+)", self.js).group(1))
        self.assertIn("const N = SAMPLE_HZ * WINDOW_S", self.js)
        self.assertGreaterEqual(hz, 20)
        self.assertLessEqual(hz * win * 2 * 4, 4000, "too many bar elements for the UI")

    def test_reads_expected_model_fields(self):
        for key in ("gas_percent", "brake_percent", "clutch_percent", "handbrake_percent"):
            self.assertIn(f'"{key}"', self.js)
        self.assertIn("window.ModelCurrentCar", self.js)

    def test_module_shape_and_boot(self):
        self.assertIn("const PedalGraph = (function () {", self.js)
        self.assertIn("}());", self.js)
        self.assertIn('document.getElementById("pedalgraph")', self.js)
        self.assertIn("[PedalGraph] script loaded", self.js)
        for name in ("attach", "detach", "readModel", "commitSample", "renderFrame", "moveTo"):
            self.assertRegex(self.js, rf"\n\s+{name}: {name},?\n", f"{name} not exported")

    def test_lifecycle_cleanup(self):
        self.assertIn("cancelAnimationFrame", self.js)
        self.assertIn('window.removeEventListener("mousemove"', self.js)
        self.assertIn('window.removeEventListener("mouseup"', self.js)


class StyleTests(unittest.TestCase):
    """The project's JavaScript conventions (see the uplinkjs scripts)."""

    def setUp(self):
        self.js = read(JS)
        self.code = strip_js(self.js)

    def test_no_classes(self):
        self.assertIsNone(re.search(r"\bclass\s+[A-Za-z_$]", self.code))
        self.assertNotIn("customElements", self.code)
        self.assertNotIn("extends ", self.code)

    def test_no_this(self):
        self.assertIsNone(re.search(r"\bthis\b", self.code))

    def test_functions_are_assigned_expressions(self):
        self.assertIsNone(re.search(r"^\s*function\s+[A-Za-z_$][\w$]*\s*\(", self.code, re.M),
                          "function declarations must be `const name = function (...)`")
        self.assertNotIn("=>", self.code, "arrow functions are not used in this code base")
        self.assertGreaterEqual(len(re.findall(r"= function \(", self.code)), 15)

    def test_let_and_const_only(self):
        self.assertIsNone(re.search(r"\bvar\s", self.code))

    def test_iife_module(self):
        self.assertIsNotNone(re.search(r"const PedalGraph = \(function \(\) \{", self.code))
        self.assertIsNotNone(re.search(r"\n\}\(\)\);", self.code))

    def test_formatting_conventions(self):
        # four-space indentation, double quotes, no tabs
        self.assertNotIn("\t", self.js)
        for line in self.js.splitlines():
            if line.lstrip().startswith("*"):
                continue  # JSDoc continuation lines are aligned one space in, as in the reference
            stripped = len(line) - len(line.lstrip(" "))
            self.assertEqual(stripped % 4, 0, f"indent not a multiple of 4: {line!r}")
        # double-quoted strings: a line whose first quote character is a single quote
        # would be a single-quoted literal (comments are stripped first)
        no_comments = re.sub(r"/\*.*?\*/", "", self.js, flags=re.S)
        no_comments = re.sub(r"//[^\n]*", "", no_comments)
        self.assertEqual(re.findall(r"^[^\"'\n]*'", no_comments, re.M), [], "single-quoted string literal")
        # one-line if blocks keep their braces
        self.assertIsNone(re.search(r"\bif \([^\n]*\)\s*[a-z][^{\n]*;\s*$", self.code, re.M),
                          "if without braces")


if __name__ == "__main__":
    unittest.main()
