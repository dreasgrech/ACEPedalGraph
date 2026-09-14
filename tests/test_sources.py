"""Static regression checks on the shipped mod files.

These guard against the mistakes that already bit us once, and against drifting
away from the project's JavaScript style:
  - anything that rebuilds geometry per frame (SVG paths) crashes the game
  - CSS var() fallback syntax is not supported by the game's Cohtml build
  - mod.json must describe exactly the files that exist, in the right order
  - style: IIFE modules, function expressions, let/const, no classes, no `this`
  - the version is declared once per artefact and they all agree
"""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
JS = os.path.join(SRC, "pedalgraph.js")
ENTRY = os.path.join(SRC, "mod.js")
CSS = os.path.join(SRC, "pedalgraph.css")
MOD_JSON = os.path.join(SRC, "mod.json")
VERSION_FILE = os.path.join(ROOT, "VERSION")
PREVIEW = os.path.join(ROOT, "dev", "preview.html")
HARNESS = os.path.join(ROOT, "tests", "widget", "harness.html")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def strip_js(src):
    """Remove comments and string literals so token counting is meaningful."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"//[^\n]*", "", src)
    src = re.sub(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`", "''", src)
    return src


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"//[^\n]*", "", src)


class ModManifestTests(unittest.TestCase):
    def setUp(self):
        self.info = json.loads(read(MOD_JSON))

    def test_required_fields(self):
        self.assertEqual(self.info["name"], "pedalgraph")
        self.assertRegex(self.info["version"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(self.info["pages"], ["hud.html"])

    def test_listed_files_exist_and_nothing_else_ships(self):
        listed = set(self.info["scripts"]) | set(self.info["styles"]) | {"mod.json"}
        present = set(os.listdir(SRC))
        self.assertEqual(listed, present, "mod.json must list exactly the files in src/")

    def test_widget_loads_before_entry(self):
        scripts = self.info["scripts"]
        self.assertLess(scripts.index("pedalgraph.js"), scripts.index("mod.js"))

    def test_no_stock_file_is_overridden(self):
        # a loose mod must only add files; hud.html / cohtml.js belong to the loader
        for name in os.listdir(SRC):
            self.assertNotIn(name, ("hud.html", "cohtml.js", "components.js"))


class EntryTests(unittest.TestCase):
    def setUp(self):
        self.js = read(ENTRY)

    def test_entry_attaches_into_the_hud_container(self):
        self.assertIn('".absolutecenter"', self.js)
        self.assertIn("PedalGraph.ROOT_ID", self.js)
        self.assertIn("PedalGraph.attach(root)", self.js)
        self.assertIn("not attaching twice", self.js)

    def test_entry_logs_through_the_loader_when_present(self):
        self.assertIn('AceMods.logger("[PedalGraph]")', self.js)


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

    def test_no_css_in_script(self):
        self.assertNotIn("createElement(\"style\")", self.js)
        self.assertNotIn("background:", self.js)
        self.assertIsNone(re.search(r"style\.(width|height|background|color|opacity|left|top)\s*=",
                                    self.js[self.js.find("const commitSample"):self.js.find("// ---- drag")]))

    def test_no_css_var_fallback_syntax(self):
        self.assertIsNone(re.search(r"var\(--[a-z0-9-]+\s*,", read(CSS)),
                          "var(--x, fallback) is not supported by the game's Cohtml")
        self.assertIsNone(re.search(r"var\(--", self.js), "no CSS in the script")

    def test_only_transforms_change_in_hot_path(self):
        hot = self.js[self.js.find("const commitSample"):self.js.find("// ---- drag")]
        for forbidden in ("innerHTML", "appendChild", "style.width", "style.height", "style.left"):
            self.assertNotIn(forbidden, hot, forbidden)

    def test_constants_consistent(self):
        hz = int(re.search(r"const SAMPLE_HZ = (\d+)", self.js).group(1))
        win = int(re.search(r"const WINDOW_S = (\d+)", self.js).group(1))
        self.assertIn("const N = SAMPLE_HZ * WINDOW_S", self.js)
        self.assertIn("const STRIP_BARS = 2 * N", self.js)
        self.assertGreaterEqual(hz, 20)
        self.assertLessEqual(hz * win * 2 * 4, 4000, "too many bar elements for the UI")

    def test_no_magic_literals_in_hot_path(self):
        hot = strip_comments(self.js[self.js.find("const commitSample"):self.js.find("// ---- drag")])
        numbers = set(re.findall(r"(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])", hot))
        self.assertTrue(numbers <= {"0", "1", "100"}, f"magic numbers in hot path: {sorted(numbers)}")
        self.assertNotIn("toFixed(", hot.replace("toFixed(SCALE_DECIMALS)", "").replace("toFixed(SHIFT_DECIMALS)", "")
                         .replace("toFixed(LOG_DECIMALS)", ""), "precision must come from a named constant")

    def test_reads_expected_model_fields(self):
        for key in ("gas_percent", "brake_percent", "clutch_percent", "handbrake_percent"):
            self.assertIn(f'"{key}"', self.js)
        self.assertIn("window.ModelCurrentCar", self.js)

    def test_module_shape_and_boot(self):
        self.assertIn("const PedalGraph = (function () {", self.js)
        self.assertIn("}());", self.js)
        self.assertIn('const ROOT_ID = "pedalgraph"', self.js)
        self.assertIn("script loaded, version=", self.js)
        for name in ("VERSION", "ROOT_ID", "attach", "detach", "readModel", "commitSample", "renderFrame", "moveTo", "CLASS"):
            self.assertRegex(self.js, rf"\n\s+{name}: {name},?\n", f"{name} not exported")

    def test_lifecycle_cleanup(self):
        self.assertIn("cancelAnimationFrame", self.js)
        self.assertIn('window.removeEventListener("mousemove"', self.js)
        self.assertIn('window.removeEventListener("mouseup"', self.js)

    def test_class_names_match_stylesheet(self):
        css = read(CSS)
        block = self.js[self.js.find("const CLASS = {"):self.js.find("};", self.js.find("const CLASS = {"))]
        names = re.findall(r':\s*"([a-z-]+)"', block)
        self.assertGreaterEqual(len(names), 10)
        for name in names:
            self.assertIn("." + name, css, f"class {name} used by the script is not styled")
        self.assertIn('const HUD_HIDDEN_CLASS = "hide-hud"', self.js)
        self.assertIn("body.hide-hud .ace-pedalgraph", css)

    def test_trace_colours_cover_every_trace(self):
        css = read(CSS)
        traces = len(re.findall(r'\{ key: "\w+", label: "\w+" \}', self.js))
        self.assertEqual(traces, 4)
        for i in range(traces):
            self.assertIn(f'[data-trace="{i}"] .pg-bar', css, f"no colour for trace {i}")


class VersionTests(unittest.TestCase):
    SEMVER = re.compile(r"^\d+\.\d+\.\d+$")

    def test_version_file_is_semver(self):
        self.assertRegex(read(VERSION_FILE).strip(), self.SEMVER)

    def test_script_and_manifest_match_version_file(self):
        v = read(VERSION_FILE).strip()
        self.assertEqual(re.search(r'const VERSION = "([^"]+)"', read(JS)).group(1), v)
        self.assertEqual(json.loads(read(MOD_JSON))["version"], v)

    def test_readme_mentions_current_version(self):
        self.assertIn(read(VERSION_FILE).strip(), read(os.path.join(ROOT, "README.md")))


class PreviewAndHarnessTests(unittest.TestCase):
    def test_pages_load_the_real_sources(self):
        html = read(PREVIEW)
        self.assertIn('href="../src/pedalgraph.css"', html)
        self.assertIn('src="../src/pedalgraph.js"', html)
        self.assertIn('id="pedalgraph"', html)
        self.assertIn("--font-family-main", html)
        harness = read(HARNESS)
        self.assertIn('href="../../src/pedalgraph.css"', harness)
        self.assertIn('src="../../src/pedalgraph.js"', harness)


class StyleTests(unittest.TestCase):
    """The project's JavaScript conventions (see the uplinkjs scripts)."""

    FILES = {"widget": JS, "entry": ENTRY, "preview": PREVIEW}

    def code_of(self, path):
        src = read(path)
        if path.endswith(".html"):
            src = "\n".join(re.findall(r"<script>(.*?)</script>", src, re.S))
        return src, strip_js(src)

    def test_no_classes(self):
        for name, path in self.FILES.items():
            _, code = self.code_of(path)
            self.assertIsNone(re.search(r"\bclass\s+[A-Za-z_$]", code), name)
            self.assertNotIn("customElements", code, name)
            self.assertNotIn("extends ", code, name)

    def test_no_this(self):
        for name, path in self.FILES.items():
            _, code = self.code_of(path)
            self.assertIsNone(re.search(r"\bthis\b", code), name)

    def test_functions_are_assigned_expressions(self):
        for name, path in self.FILES.items():
            _, code = self.code_of(path)
            self.assertIsNone(re.search(r"^\s*function\s+[A-Za-z_$][\w$]*\s*\(", code, re.M),
                              f"{name}: function declarations must be `const name = function (...)`")
            self.assertNotIn("=>", code, f"{name}: arrow functions are not used in this code base")
        self.assertGreaterEqual(len(re.findall(r"= function \(", strip_js(read(JS)))), 20)

    def test_let_and_const_only(self):
        for name, path in self.FILES.items():
            _, code = self.code_of(path)
            self.assertIsNone(re.search(r"\bvar\s", code), name)

    def test_iife_shapes(self):
        self.assertIsNotNone(re.search(r"const PedalGraph = \(function \(\) \{", strip_js(read(JS))))
        self.assertIsNotNone(re.search(r"\n\}\(\)\);", strip_js(read(JS))))
        self.assertIsNotNone(re.search(r"^\(function \(\) \{", strip_js(read(ENTRY)), re.M))

    def test_formatting_conventions(self):
        for path in (JS, ENTRY):
            js = read(path)
            self.assertNotIn("\t", js)
            for line in js.splitlines():
                if line.lstrip().startswith("*"):
                    continue
                stripped = len(line) - len(line.lstrip(" "))
                self.assertEqual(stripped % 4, 0, f"indent not a multiple of 4: {line!r}")
            no_comments = strip_comments(js)
            self.assertEqual(re.findall(r"^[^\"'\n]*'", no_comments, re.M), [], f"single-quoted literal in {path}")
            self.assertIsNone(re.search(r"\bif \([^\n]*\)\s*[a-z][^{\n]*;\s*$", strip_js(js), re.M), "if without braces")


if __name__ == "__main__":
    unittest.main()
