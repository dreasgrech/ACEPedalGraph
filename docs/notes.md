# Notes

What this widget cost to get right, kept because the next per-frame app in this
engine will hit the same walls.

## Rendering rules

- Never rebuild SVG path geometry per frame. The first build did that and the
  game died within seconds inside Renoir with "Unable to allocate chunk from
  buddy allocator". The stock HUD only animates by changing CSS transforms on
  fixed elements; the widget does the same and skips writes whose value did
  not change.
- `var(--name, fallback)` is not supported by this Cohtml build (logs
  "Unable to resolve custom variable"). Use plain `var(--name)`.

Full background in `ACEGameInternals/docs/gameface-notes.md`.

## Versioning

The version lives in `pedalgraph/app.json` only. The loader reads it and the
script logs it (`script loaded, version=<version>, source=ACEUIModLoader`) and
exposes it as `PedalGraph.VERSION` through `ACEUIModLoader.app("pedalgraph")`;
outside the game it reads `dev`. Bumping means: edit `app.json`, reinstall.
`check_ingame_log.py` prints the version the game actually ran.

History: 0.1.0 proof of concept (custom element, module script);
0.2.0 IIFE module in project style, external stylesheet, named constants,
version stamp, preview page, test suite; 0.2.1 the game's override
resolution reverse-engineered and replayed by the packer (padding), so the
package no longer depends on luck; 0.2.2 position persisted through the
stock HUD layout store (survives Escape/resume and game restarts), hidden
until placed; 0.3.0 converted from a hud.html-override package to a loose
folder loaded by `ACEUIModLoader`, so it coexists with other UI apps; 0.4.0
drag, persistence, frame loop and helpers moved into the loader's shared
library (`ACEUIModLoader.*`), the widget is now only the graph; then (loader
0.4.0) `mod.js`, the `VERSION` file, the install wrapper and the identity
constants were dropped: the loader creates the root and supplies the identity.

## Verifying in game

The game writes UI `console.log` output into `Saved Games\ACE\Logs\log-*.txt`
as `[gameface]` lines. Run `python ..\ACEUIModLoader\tools\check_ingame_log.py`
after playing: `[ACEUIModLoader] app pedalgraph <version>: loading` followed by
`[PedalGraph] script loaded, ... source=ACEUIModLoader` means the loader served the
app, `sampling ok` once a minute means car data is flowing, and the position
save/restore lines show persistence working.
