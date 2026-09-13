# ACE PedalGraph

HUD widget for Assetto Corsa EVO that draws a scrolling graph of throttle,
brake, clutch and handbrake input. Working prototype as of 2026-09-13
(game version 0.9.1+release.6).

## Layout

- `src/uiresources/hud.html` - copy of the stock HUD page with one extra
  `<script>` tag, a source tag, and one `<ace-pedalgraph>` element.
- `src/uiresources/js/pedalgraph.js` - the widget. Reads the global
  `ModelCurrentCar` object (`gas_percent`, `brake_percent`, `clutch_percent`,
  `handbrake_percent`) and animates a fixed set of bars with CSS transforms.
  Draggable, remembers its position in `localStorage`, hides with the HUD.
- `src/content/cars/ks_toyota_supra_mkiv/displays/display.html` - copy of a
  stock car display with one logging line. It does NOT take effect in game;
  it is there because the package is only applied when it contains an
  override of an existing `content\` file (see "What makes the package
  apply" below).
- `tools/pack_kspkg.py` - packs `src/` into a `.kspkg` (format notes inside).
- `dist/pedalgraph.kspkg` - built package (git-ignored, 69 MB).

## Build and install

```
python tools/pack_kspkg.py src dist/pedalgraph.kspkg
copy dist\pedalgraph.kspkg "%USERPROFILE%\Saved Games\ACE\mods\"
```

Delete the file from the `mods` folder to restore the stock HUD.

## Verifying in game

The game writes UI `console.log` output into `Saved Games\ACE\Logs\log-*.txt`
as `[gameface]` lines. Search the newest log for `[PedalGraph]`:

- `script loaded, source=kspkg` - the modified hud.html was served from the
  mod package.
- `sampling ok thr=... brk=...` every 15 s - car data is flowing.
- no lines at all - the package was not applied (see below).

## What makes the package apply

Tested on 2026-09-13, always the Supra on the same server:

| Package contents | Loose files in game dir | Result |
|---|---|---|
| uiresources only (loose files under `mods\uiresources`, no package) | no | not applied |
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
  line never appears), only the base file is. The mechanism is unknown; the
  working theory is that the game merges all package tables into one
  hash-sorted list and binary-searches it, so which duplicate wins depends on
  the overall layout. Treat the extra file as a required ingredient until
  proven otherwise, and re-test after every game update.
- Steam launch options never reach the exe (every log says `Arguments: 1`),
  and a direct launch is refused by the ownership check ("User has not
  permission to run this product"), so `-log_debug` / `-log_trace` cannot be
  used to trace file reads.

## Rendering rules learned the hard way

- Never rebuild SVG path geometry per frame. The first build did that and the
  game died within seconds inside Renoir with "Unable to allocate chunk from
  buddy allocator". The stock HUD only animates by changing CSS transforms on
  fixed elements; the widget now does the same.
- `var(--name, fallback)` is not supported by this Cohtml build (logs
  "Unable to resolve custom variable"). Use plain `var(--name)`.

## Known issues / next steps

- Motion is visibly choppy: sampling and redraw run at a fixed 25 Hz. Options
  are a higher rate (the model refreshes every frame) or interpolating the
  strip translation between samples.
- Widget is not part of the stock HUD layout system yet (no on/off toggle in
  settings, no HUD-managed position). The base class is reachable at runtime
  via `Object.getPrototypeOf(customElements.get('ks-hudwidgethost'))`.
- Visual polish to match the stock HUD.

## Notes on the package format

Header 1 MB of zeros, blobs back to back, blob area padded to 1 MB, then a
64 MB file table (0x100-byte entries sorted by FNV-1a-64 of the lower-case
UTF-16LE path, terminated by a zero hash) XOR'd with 0x9F9721A97D1135C1.
Verified byte-for-byte against Kunos' own sample mod package. Nenkai's
ACEvo.Package CLI refuses packages whose first entry is not under `content\`;
that is a heuristic in the tool, not part of the format.
