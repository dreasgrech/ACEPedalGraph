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
script logs it (`script loaded, version=<version>, source=ACEUIAppLoader`) and
exposes it as `PedalGraph.VERSION` through `ACEUIAppLoader.app("pedalgraph")`;
outside the game it reads `dev`. Bumping means: edit `app.json`, reinstall.
`check_ingame_log.py` prints the version the game actually ran. The `widget
attached` line also carries the history rate, the scale and whether attract is
on, so the options the game restored are in the log.

History: 0.1.0 proof of concept (custom element, module script);
0.2.0 IIFE module in project style, external stylesheet, named constants,
version stamp, preview page, test suite; 0.2.1 the game's override
resolution reverse-engineered and replayed by the packer (padding), so the
package no longer depends on luck; 0.2.2 position persisted through the
stock HUD layout store (survives Escape/resume and game restarts), hidden
until placed; 0.3.0 converted from a hud.html-override package to a loose
folder loaded by `ACEUIAppLoader`, so it coexists with other UI apps; 0.4.0
drag, persistence, frame loop and helpers moved into the loader's shared
library (`ACEUIAppLoader.*`), the widget is now only the graph; then (loader
0.4.0) `mod.js`, the `VERSION` file, the install wrapper and the identity
constants were dropped: the loader creates the root and supplies the identity;
0.7.0 options through `ACEUIAppLoader.settings`: panel scale (the stylesheet
went from rem to em inside the panel for it), history window as a sample rate
over the fixed bar count, a switch per input, level bars, readouts, grid,
background; the on-widget attract checkbox moved into the same window; then a
steering trace, ABS / TC / ESC marks, plot height and trace weight -- eight
channels sharing one strip machinery, the optional ones built at attach and
hidden.

## Steering is signed

`ACEGameInternals` had `steering_percent` down as a 0..1 float like the pedals.
The stock speedo (`components.js`, `ks-hudspeedo-radial`) clamps it to -1..1 and
maps it to its +/-35 degree arc, so it is signed with 0 straight; the widget draws
it from the centre line (positive, right, upward) with the transform origin at the
centre and a `translateY` of a quarter of the strip height per unit of deviation.
Any other channel of this shape (lateral g, say) is the same two lines.

## Options without rebuilding

Every option is either a class on an element that already exists or a number the
loop reads. Nothing is built or removed when one changes, because the markup is
built once (a rebuild per option would be the SVG lesson again in slow motion)
and because hidden elements were measured to cost the renderer nothing
(`ACEUIAppLoader/dev/snippets/hiddencost.js`). The history window is the one
option that looks like it needs more elements and does not: 250 bars over 10 s
is a 25 Hz sampler, over 3 s an 83 Hz one.

The assist marks are the same strips written with 0 or 1 and styled as a thin tick
along the top (`transform-origin: 50% 0`, `height: 5%`), one row per mark. They
have a legend entry but no readout and no level bar, so the per-channel arrays in
the state hold nulls for them and the loop checks before writing.

The live value goes into the incoming bar at the right edge **only**, not into both
twins. Both twins are on screen at once, a fraction of a bar each -- the second-half
one arriving at the right, the first-half one leaving at the left -- so writing both
put the newest value on the oldest edge of the graph as a one-bar sliver that flickered
with the pedals. It was there from the first version and only showed up in a 2.5x
screenshot. The commit still writes both, which is what keeps the wrap invisible.

One slot in every window is the exception to that: when the incoming slot is 0, its
right-hand twin would be bar 2N, past the end of the strip, and bar N -- the left-hand
twin -- is the one on screen at the left edge. Writing it put a hairline of the live
value at the far left for one sample period every window. Nothing is written for that
slot; the right edge is a bar short for 20 ms and the previous bar's overlap covers it.

## Seams, and where the translucency lives

Bars are 0.2 % of a strip wide: under a pixel at most scales. Every bar edge is
antialiased, so a graph of abutting bars shows vertical lines wherever adjacent edges
fall across a pixel boundary, spaced by the beat between bar width and pixel width.
Each bar now spans its own slot and the whole of the next (`BAR_OVERLAP`), so every
pixel column lies wholly inside some bar. That only works if the bars are opaque:
translucent bars overlapping would double up into stripes twice as dense, so the
trace's translucency is the strip's `opacity`, which composites its bars as one shape.
The trace weight option and steering's and the marks' own opacities are on the strip
for the same reason.

When an input, the level bars or the readouts come back, the per-frame caches
(`lastScale`, `lastPct`) are cleared so the next frame rewrites them; otherwise
a value that happened to match the cached one would leave the stale element on
screen until it changed.

## The look

Follows the stock HUD widgets so it reads as part of the game: a dark translucent
panel (a slight vertical gradient, hairline border, soft shadow, small radii), the
game's Rajdhani through `--font-family-main`, dim uppercase labels with bright figures
in `rajdhani-numerals-mono` so the readouts do not jitter as digits change, and the
stock green (`#44EA78`, the delta bar's) for throttle. Everything the stock
stylesheets use -- `flex-wrap`, `box-shadow`, `linear-gradient` -- is known to render
in this Cohtml build; `backdrop-filter` and `gap` are not used by them, so this widget
does not use them either.

Judged from `dev/preview.html` rendered headless at 2.5x with the game's font
(`tools/preview_fonts.py`), which is also where the two README images come from. A
Chromium run with `--virtual-time-budget` delivers exactly one animation frame, so the
preview's `#shot` flag drives frames from timers for that purpose.

## Verifying in game

The game writes UI `console.log` output into `Saved Games\ACE\Logs\log-*.txt`
as `[gameface]` lines. Run `python ..\ACEUIAppLoader\tools\check_ingame_log.py`
after playing: `[ACEUIAppLoader] app pedalgraph <version>: loading` followed by
`[PedalGraph] script loaded, ... source=ACEUIAppLoader` means the loader served the
app, `sampling ok` once a minute means car data is flowing, and the position
save/restore lines show persistence working.
