# ACE PedalGraph

HUD widget for Assetto Corsa EVO that draws a scrolling graph of throttle,
brake, clutch and handbrake input. Version 0.4.0, for game version
0.9.1+release.6.

This repository is the mod only. It is loaded by the `ACEUIModLoader` package,
built on that package's shared library (`ACEUIModLoader.panel` for drag and position
persistence, `ACEUIModLoader.loop` for the frame loop and sampler) and installed with
that repo's tools; everything learned about the game and its UI engine is in
`ACEGameInternals` (`docs/`). Clone all three side by side: the preview page
and the tests load the library from `../ACEUIModLoader/src/`.

## Layout

- `src/mod.json` - what the loader reads: name, version, the pages to load on
  (`hud.html`), the stylesheet and the scripts in load order.
- `src/pedalgraph.js` - the widget, an IIFE module
  (`PedalGraph.attach(root)` / `PedalGraph.detach(state)`). Reads the global
  `ModelCurrentCar` object (`gas_percent`, `brake_percent`, `clutch_percent`,
  `handbrake_percent`) and animates a fixed set of bars with CSS transforms.
  Everything that is not the graph comes from the library: `ACEUIModLoader.panel`
  makes it draggable and stores its position as a fraction of the screen in
  the stock HUD layout container (`HUD.elementModified`, persisted by the
  game) with `localStorage` as fallback, hidden until placed; `ACEUIModLoader.loop`
  runs the frame loop and the fixed-rate sampler. Hides with the HUD. Writes
  no colours or sizes, only transforms; every class name, timing and
  precision is a named constant.
- `src/mod.js` - loader entry point: creates `<div id="pedalgraph">` inside the
  HUD's positioning container and calls `PedalGraph.attach`.
- `src/pedalgraph.css` - all styling, including the trace colours keyed by
  `data-trace` index.
- `VERSION` - the mod version, single source of truth (see Versioning).
- `dev/preview.html` - runs the widget outside the game (see below).
- `tools/install.py` - thin wrapper around the loader's `install_mod.py`.
- `tests/` - this mod's tests, see below.

The mod does not override any stock file. It is a loose folder the game reads
from `%USERPROFILE%\Saved Games\ACE\mods\uiresources\ACEUIModLoaderMods\pedalgraph\`.

## Install

The loader package must be installed once (from `ACEUIModLoader`:
`python tools/build_loader.py --install`). Then:

```
python tools/install.py            # copy src/ into the mods folder and register it
python tools/install.py --remove
```

Edits to `src/` need only a re-run of `install.py` (or a copy of the changed
file) and a HUD reload in game; pressing Escape and resuming reloads the HUD
page. Set `ACE_LOADER_DIR` if the loader repo is elsewhere.

## Preview outside the game

Open `dev/preview.html` in Edge or Chrome (double-click, no server needed). It
loads the ACEUIModLoader library from the sibling loader checkout, then the real
`pedalgraph.css` and `pedalgraph.js` from `src/`, inside a 16:9
stand-in for the game's HUD container and feeds them a fake `ModelCurrentCar`:

- `W` throttle, `S` brake, `A` clutch, `Space` handbrake (with pedal travel
  smoothing), or leave **auto demo** on for a scripted lap
- **hide HUD** toggles `body.hide-hud` like the game's HUD toggle
- **focused car** toggles `has_focused_car` (spectator/no-car case)
- **reset position** clears the stored position; dragging persists like in game
- the fps counter shows the browser's frame rate

What it cannot show: Cohtml-specific behaviour (this is Chromium), the stock
HUD around the widget, and the game's font. Anything touching per-frame
rendering still needs one in-game run, checked with the loader's
`tools/check_ingame_log.py`.

## Versioning

`VERSION` at the repo root holds the semantic version. `pedalgraph.js` repeats
it in `const VERSION`, logs it in its first line (`script loaded,
version=0.4.0, source=ACEUIModLoader`), and exposes it as `PedalGraph.VERSION`;
`src/mod.json` repeats it for the loader. A test fails if they disagree or if
this README stops mentioning the current version, so bumping means: edit
`VERSION`, the constant, `mod.json`, mention it here, reinstall.
`check_ingame_log.py` prints the version the game actually ran.

History: 0.1.0 proof of concept (custom element, module script);
0.2.0 IIFE module in project style, external stylesheet, named constants,
version stamp, preview page, test suite; 0.2.1 the game's override
resolution reverse-engineered and replayed by the packer (padding), so the
package no longer depends on luck; 0.2.2 position persisted through the
stock HUD layout store (survives Escape/resume and game restarts), hidden
until placed; 0.3.0 converted from a hud.html-override package to a loose
folder loaded by `ACEUIModLoader`, so it coexists with other UI mods; 0.4.0
drag, persistence, frame loop and helpers moved into the loader's shared
library (`ACEUIModLoader.*`), the widget is now only the graph.

## Code style (JavaScript)

Same conventions as the uplinkjs scripts, enforced by `tests/test_sources.py`:

- one IIFE module per file: `const PedalGraph = (function () { ... return {...}; }());`
- no classes and no `this`; per-instance state is a plain object passed as
  the first argument (`attach(root)` returns it, `detach(state)` takes it)
- functions are assigned expressions: `const name = function (args) { ... };`,
  no function declarations, no arrow functions
- `let` / `const` only, double quotes, four-space indentation, braces on every
  `if` with a blank line after a one-line block, `catch (ignore) { /* why */ }`
- JSDoc comments on the module and on anything non-obvious

The custom element of the first prototype is gone for this reason: Custom
Elements need a class, so the widget attaches to a plain `<div>` instead.

## Tests

```
python -m unittest discover -s tests -v
```

- `tests/test_sources.py` - static rules on the shipped files: `mod.json`
  lists exactly the files in `src/` with the widget before the entry script
  and overrides nothing; the widget has no per-frame geometry (SVG/canvas), no
  CSS in the script, no `var(--x, fallback)`, no magic numbers in the hot
  path, balanced brackets, consistent constants; the widget uses the library
  for drag, persistence and the loop instead of its own code; every class
  name the script uses is styled and every trace has a colour; the version
  agrees across `VERSION`, the script, `mod.json` and this README; the preview
  page and harness load the library in order and then the real sources; and
  the JavaScript style rules.
- `tests/test_widget_browser.py` - runs `tests/widget/harness.html` in a
  headless Edge or Chrome with a fake animation clock, fake `localStorage`,
  fake `ModelCurrentCar` and fake HUD store: 13 behavioural cases covering
  sampling, scrolling, clamping, lifecycle and the integration with the
  library's panel (drag saves under this mod's keys, restore in the loop).
  The panel's own behaviour is tested in the loader repo. Skipped if no
  browser is found (`ACE_BROWSER=<path>` overrides). The runner, shared from
  `ACEUIModLoader/tools/headless.py`, uses a throwaway profile, kills the
  process tree on timeout and verifies no browser process is left behind.

## Verifying in game

The game writes UI `console.log` output into `Saved Games\ACE\Logs\log-*.txt`
as `[gameface]` lines. Run `python ..\ACEUIModLoader\tools\check_ingame_log.py`
after playing: `[ACEUIModLoader] mod pedalgraph 0.4.0: loading` followed by
`[PedalGraph] script loaded, ... source=ACEUIModLoader` means the loader served the
mod, `sampling ok` once a minute means car data is flowing, and the position
save/restore lines show persistence working.

## Rendering rules learned the hard way

- Never rebuild SVG path geometry per frame. The first build did that and the
  game died within seconds inside Renoir with "Unable to allocate chunk from
  buddy allocator". The stock HUD only animates by changing CSS transforms on
  fixed elements; the widget does the same and skips writes whose value did
  not change.
- `var(--name, fallback)` is not supported by this Cohtml build (logs
  "Unable to resolve custom variable"). Use plain `var(--name)`.

Full background in `ACEGameInternals/docs/gameface-notes.md`.
