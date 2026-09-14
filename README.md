# ACE PedalGraph

HUD widget for Assetto Corsa EVO that draws a scrolling graph of throttle,
brake, clutch and handbrake input, for game version 0.9.1+release.6. The mod's
version is in `pedalgraph/mod.json` and nowhere else.

This repository is the mod only. It is loaded by the `ACEUIModLoader` package,
built on that package's shared library (`ACEUIModLoader.panel` for drag and position
persistence, `ACEUIModLoader.loop` for the frame loop and sampler) and installed with
that repo's tools; everything learned about the game and its UI engine is in
`ACEGameInternals` (`docs/`). Clone all three side by side: the preview page
and the tests load the library and the shared test fixtures from
`../ACEUIModLoader/`.

## Layout

- `pedalgraph/` - the shipped mod, exactly what lands in
  `%USERPROFILE%\Saved Games\ACE\mods\uiresources\ACEUIModLoaderMods\pedalgraph\`:
  - `mod.json` - version, title, stylesheet and script. The loader reads it
    and hands the values back through `ACEUIModLoader.mod("pedalgraph")`
    (name, version, title, root, logger, storage keys), so none of them is
    repeated in the source.
  - `pedalgraph.js` - the widget, an IIFE module
    (`PedalGraph.attach(root)` / `PedalGraph.detach(state)`). Reads the global
    `ModelCurrentCar` object (`gas_percent`, `brake_percent`, `clutch_percent`,
    `handbrake_percent`) and animates a fixed set of bars with CSS transforms.
    Everything that is not the graph comes from the library: `ACEUIModLoader.panel`
    makes it draggable and stores its position as a fraction of the screen in
    the stock HUD layout container (`HUD.elementModified`, persisted by the
    game) with `localStorage` as fallback, hidden until placed; `ACEUIModLoader.loop`
    runs the frame loop and the fixed-rate sampler. Hides with the HUD. Writes
    no colours or sizes, only transforms; every class name, timing and
    precision is a named constant. It attaches to `#pedalgraph`, which the
    loader creates in game and the preview and harness pages carry themselves.
  - `pedalgraph.css` - all styling, including the trace colours keyed by
    `data-trace` index.
- `dev/preview.html` - runs the widget outside the game (see below).
- `tests/test_mod.py` - the loader's shared test kit pointed at this repo plus
  the widget's own contract; `tests/widget/harness.html` holds the browser cases.

The mod does not override any stock file. It is a loose folder the game reads,
discovered through its marker file (see the loader's README).

## Install

With the loader package installed (`python tools/build_loader.py --install` in
the loader repo, checked out next to this one):

```
python ..\ACEUIModLoader\tools\install_mod.py pedalgraph
python ..\ACEUIModLoader\tools\install_mod.py --remove pedalgraph
```

Edits need only a re-run of the install and a HUD reload in game; pressing
Escape and resuming reloads the HUD page.

## Preview outside the game

Open `dev/preview.html` in Edge or Chrome (double-click, no server needed). It
loads the ACEUIModLoader library from the sibling loader checkout, then the real
`pedalgraph.css` and `pedalgraph.js` from `pedalgraph/`, inside a 16:9
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

The version lives in `pedalgraph/mod.json` only. The loader reads it and the
script logs it (`script loaded, version=<version>, source=ACEUIModLoader`) and
exposes it as `PedalGraph.VERSION` through `ACEUIModLoader.mod("pedalgraph")`;
outside the game it reads `dev`. Bumping means: edit `mod.json`, reinstall.
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
library (`ACEUIModLoader.*`), the widget is now only the graph; then (loader
0.4.0) `mod.js`, the `VERSION` file, the install wrapper and the identity
constants were dropped: the loader creates the root and supplies the identity.

## Code style (JavaScript)

Same conventions as the uplinkjs scripts, enforced by the loader's test kit:

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

`tests/test_mod.py` subclasses `modkit.ModTests` from the loader repo, which
checks the shipped folder (`mod.json` valid and minimal, nothing unlisted ships,
no stock override, no legacy boilerplate), the JavaScript style rules, the
Cohtml rules (no SVG/canvas built by script, no CSS in the script, no
`var(--x, fallback)`), that class names exist in the stylesheet, that identity
comes from the loader, that the sampling/render hot path only writes transforms
and text with no magic numbers, and runs `tests/widget/harness.html` in a
headless Edge or Chrome with the shared fake animation clock, in-memory
`localStorage`, a fake `ModelCurrentCar` and a fake HUD store: 13 behavioural
cases covering sampling, scrolling, clamping, lifecycle and the integration
with the library's panel (drag saves under this mod's keys, restore in the
loop). A second class keeps the widget's own contract (transforms only, sampling
through the library). The panel's own behaviour is tested in the loader repo.
Skipped without a browser (`ACE_BROWSER=<path>` overrides); the runner leaves
no browser process behind.

## Verifying in game

The game writes UI `console.log` output into `Saved Games\ACE\Logs\log-*.txt`
as `[gameface]` lines. Run `python ..\ACEUIModLoader\tools\check_ingame_log.py`
after playing: `[ACEUIModLoader] mod pedalgraph <version>: loading` followed by
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
