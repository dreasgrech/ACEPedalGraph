"""Runs tests/widget/harness.html in a headless Chromium (Edge or Chrome) and
checks every case passed.

The harness fakes requestAnimationFrame, localStorage and ModelCurrentCar, so the
widget's sampling, scrolling, clamping, drag and lifecycle logic is exercised
deterministically. It does not prove Cohtml compatibility; see test_sources.py for
the static rules that cover the known Cohtml pitfalls, and tools/check_ingame_log.py
for the in-game smoke test.

Process hygiene: the browser runs with its own throwaway --user-data-dir, is killed
as a whole process tree on timeout, and after the run any process still referencing
that profile directory is terminated. Nothing is left running.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HARNESS = os.path.join(ROOT, "tests", "widget", "harness.html")

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def find_browser():
    env = os.environ.get("ACE_BROWSER")
    if env and os.path.exists(env):
        return env
    for b in BROWSERS:
        if os.path.exists(b):
            return b
    return None


BROWSER_EXES = ("msedge.exe", "chrome.exe", "chromium.exe")


def _pids_using_profile(profile_dir):
    """PIDs of *browser* processes whose command line references our profile dir.

    Filtering by executable name matters: the shell or test runner that launched the
    browser also has the profile path on its command line and must never be killed.
    """
    if sys.platform != "win32":
        return []
    names = " -or ".join(f"$_.Name -eq '{n}'" for n in BROWSER_EXES)
    ps = (f"Get-CimInstance Win32_Process | Where-Object {{ ({names}) -and $_.CommandLine -and "
          f"$_.CommandLine.Contains('{profile_dir}') }} | Select-Object -ExpandProperty ProcessId")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                             capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return []
    return [int(p) for p in out.split() if p.strip().isdigit()]


def _kill_tree(pid):
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True)
    else:
        try:
            os.kill(pid, 9)
        except OSError:
            pass


def run_harness(browser):
    profile = tempfile.mkdtemp(prefix="acepedalgraph-headless-")
    url = "file:///" + HARNESS.replace("\\", "/")
    # --do-not-de-elevate: when started from an elevated shell, Chromium otherwise
    # relaunches itself de-elevated via the shell and exits at once, which detaches
    # the process from our stdout pipe (empty --dump-dom) and from our supervision.
    cmd = [browser, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
           "--disable-extensions", "--disable-background-networking", "--no-sandbox",
           "--do-not-de-elevate", f"--user-data-dir={profile}",
           "--allow-file-access-from-files", "--virtual-time-budget=10000",
           "--window-size=1920,1080", "--dump-dom", url]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            encoding="utf-8", errors="replace")
    try:
        stdout, _ = proc.communicate(timeout=120)
    except subprocess.TimeoutExpired:
        _kill_tree(proc.pid)
        stdout, _ = proc.communicate()
    finally:
        # belt and braces: nothing that referenced our profile may survive
        for _ in range(3):
            leftovers = [p for p in _pids_using_profile(profile) if p != os.getpid()]
            if not leftovers:
                break
            for p in leftovers:
                _kill_tree(p)
            time.sleep(0.5)
        shutil.rmtree(profile, ignore_errors=True)
    return stdout


class WidgetBrowserTests(unittest.TestCase):
    def test_widget_harness_all_pass(self):
        browser = find_browser()
        if not browser:
            self.skipTest("no Chromium-based browser found (set ACE_BROWSER)")
        dom = run_harness(browser)
        m = re.search(r'<pre id="results">(.*?)</pre>', dom, re.S)
        self.assertIsNotNone(m, "harness produced no results block; DOM head:\n" + dom[:2000])
        report = (m.group(1).replace("&lt;", "<").replace("&gt;", ">")
                  .replace("&amp;", "&").replace("&quot;", '"'))
        print("\n" + report)
        self.assertIn("DONE", dom, "harness did not finish")
        summary = re.search(r"SUMMARY (\d+)/(\d+)", report)
        self.assertIsNotNone(summary, "no summary line")
        passed, total = int(summary.group(1)), int(summary.group(2))
        self.assertGreaterEqual(total, 12, "expected the full set of widget cases")
        self.assertEqual(passed, total, "widget cases failed:\n" + report)


if __name__ == "__main__":
    unittest.main()
