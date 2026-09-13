# ACE PedalGraph

HUD widget for Assetto Corsa EVO that draws a scrolling graph of throttle,
brake, clutch and handbrake input. Working as of 2026-09-13 on game version
0.9.1+release.6.

## Layout

- `src/uiresources/hud.html` - copy of the stock HUD page with one extra
  `<script>` tag, a source tag, and one `<ace-pedalgraph>` element.
- `src/uiresources/js/pedalgraph.js` - the widget. Reads the global
  `ModelCurrentCar` object (`gas_percent`, `brake_percent`, `clutch_percent`,
  `handbrake_percent`) and animates a fixed set of bars with CSS transforms.
  Draggable, remembers its position (as a fraction of the screen) in
  `localStorage`, hides with the HUD.
- `src/content/cars/ks_toyota_supra_mkiv/displays/display.html` - copy of a
  stock car display with one logging line. It does NOT take effect in game;
  it is there because the package is only applied when it contains an
  override of an existing `content\` file (see "What makes the package
  apply" below). A test guards its presence.
- `tools/pack_kspkg.py` - packs `src/` into a `.kspkg`, verifies the result,
  optionally installs it (format notes inside).
- `tools/check_ingame_log.py` - in-game smoke test: reads the newest game log
  and reports whether the mod was applied and whether anything crashed.
- `tests/` - regression suite, see below.
- `dist/pedalgraph.kspkg` - built package (git-ignored, 69 MB).

## Build and install

```
python tools/pack_kspkg.py src dist/pedalgraph.kspkg --install
```

`--install` copies the package to `%USERPROFILE%\Saved Games\ACE\mods\`.
Delete it from there to restore the stock HUD.

## Tests

```
python -m unittest discover -s tests -v
```

- `tests/test_pack_kspkg.py` - package format: known hashes, header, 1 MB
  alignment, sorted table with zero terminator, XOR padding pattern,
  directory entries, back-to-back blobs, `--encrypt`, junk-file filtering,
  error paths, determinism, corruption detection, and a build of the real
  `src/` that must contain the `content\` ingredient.
  Set `ACE_SDK_SAMPLE=1` to also parse Kunos' 531 MB sample package from
  `C:\AssettoEvoSDKDocumentation` with our rules.
- `tests/test_sources.py` - static rules on the shipped files: hud.html keeps
  the stock structure and load order; the widget has no per-frame geometry
  (SVG/canvas), no `var(--x, fallback)`, balanced brackets, consistent
  constants, lifecycle cleanup.
- `tests/test_widget_browser.py` - runs `tests/widget/harness.html` in a
  headless Edge or Chrome with a fake animation clock, fake `localStorage`
  and fake `ModelCurrentCar`: build, first frame, fixed-rate commits,
  fractional scroll, hitch catch-up, stall reset, clamping, readout
  updates, missing model, hidden HUD, drag with clamping, position
  save/restore, legacy data, disconnect/reconnect. Skipped if no browser is
  found (`ACE_BROWSER=<path>` overrides). The browser gets a throwaway
  profile, is killed as a process tree on timeout, and the runner verifies
  afterwards that no browser process referencing that profile is left.
  `--do-not-de-elevate` is passed because an elevated shell otherwise makes
  Chromium relaunch itself detached (empty output, orphaned process).
- After playing: `python tools/check_ingame_log.py` (exit 0 = applied and
  healthy).

The browser tests prove the logic, not Cohtml compatibility. The static rules
cover the Cohtml pitfalls found so far; the in-game check covers the rest.

## Verifying in game

The game writes UI `console.log` output into `Saved Games\ACE\Logs\log-*.txt`
as `[gameface]` lines. `[PedalGraph] script loaded, source=kspkg` means the
modified hud.html was served from the mod package; `sampling ok ...` once a
minute means car data is flowing; no lines at all means the package was not
applied.

## What makes the package apply

Tested on 2026-09-13, always the Supra on the same server:

| Package contents | Loose files in game dir | Result |
|---|---|---|
| loose files under `mods\uiresources`, no package | no | not applied |
| uiresources only | no | not applied |
| uiresources + `content\cars\<car>\displays\display.html` override | yes | **applied** |
| uiresources + new marker file under `content\cars\<car>\` | no | not applied |
| uiresources only | yes | not applied |
| uiresources + `content\cars\<car>\displays\display.html` override | no | **applied** |

Conclusions so far:

- A `.kspkg` in `Saved Games\ACE\mods\` can override `uiresources\hud.html`.
- Loose files, whether under `mods\` or in the game install folder, are never
  read while `content.kspkg` is present.
- The override only takes effect when the package also contains a copy of an
  existing file under `content\`. The copy itself is NOT served (its logging
  line never appears). The mechanism is unknown; the working theory is that
  the game merges all package tables into one hash-sorted list and
  binary-searches it, so which duplicate wins depends on the overall layout.
  Treat the extra file as a required ingredient and re-test after every game
  update.
- Steam launch options never reach the exe (every log says `Arguments: 1`),
  and a direct launch is refused by the ownership check even with a
  `steam_appid.txt`, so `-log_debug` / `-log_trace` cannot be used.

## Rendering rules learned the hard way

- Never rebuild SVG path geometry per frame. The first build did that and the
  game died within seconds inside Renoir with "Unable to allocate chunk from
  buddy allocator". The stock HUD only animates by changing CSS transforms on
  fixed elements; the widget does the same and skips writes whose value did
  not change.
- `var(--name, fallback)` is not supported by this Cohtml build (logs
  "Unable to resolve custom variable"). Use plain `var(--name)`.

## Next steps

- Integrate with the stock HUD layout system (settings toggle, HUD-managed
  position). The base class is reachable at runtime via
  `Object.getPrototypeOf(customElements.get('ks-hudwidgethost'))`.
- Visual polish to match the stock HUD.

## Notes on the package format

Header 1 MB of zeros, blobs back to back, blob area padded to 1 MB, then a
64 MB file table (0x100-byte entries sorted by FNV-1a-64 of the lower-case
UTF-16LE path, terminated by a zero hash) XOR'd with 0x9F9721A97D1135C1.
Verified byte-for-byte against Kunos' own sample mod package. Nenkai's
ACEvo.Package CLI refuses packages whose first entry is not under `content\`;
that is a heuristic in the tool, not part of the format.
