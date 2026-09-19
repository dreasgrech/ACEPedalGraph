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
value at the far left for one sample period every window. Each strip has a spare bar
at index 2N for exactly that slot; it scrolls into the right edge when slot 0 is
incoming and nowhere else.

The bar *beyond* the incoming one is blanked whenever the incoming slot advances. It
holds a sample from a window ago (or the spare's last live value), it sits just past the
right edge, and bars are widened 1.5 px to the left: as the strip scrolled, its left
edge entered the last pixel of the graph before the commit overwrote it -- the same
hairline, on the right. The commit writes that bar whole a moment later, so blanking it
costs one transform per channel per sample and shows nothing.

## Seams, and where the translucency lives

Bars are 0.2 % of a strip wide: a pixel or two at most scales. Every bar edge is
antialiased, so a graph of abutting bars shows vertical lines wherever adjacent edges
fall across a pixel boundary (the background leaks by a·(1−a) at a boundary drawn as
two partial covers), spaced by the beat between bar width and pixel width. Each bar is
now widened 1.5 px to the left (`.pg-bar`: a negative margin and matching padding on
top of a whole-slot layout), so the pixel a boundary falls in is covered whole by the
later bar. The first attempt wrote `left: calc(X% - 1.5px)` into the inline style;
Chromium drew it and Cohtml did not, and every bar vanished in game -- the stock UI's
`calc` is all in stylesheets, and that is where it stays. Two wrong
turns on the way: widening by a whole *slot* killed the seams but made every step of
the staircase two bars wide, which read as aliasing; and widening to the *right* let
the newest committed bar -- just off the left edge of the window -- poke into the
oldest slot on screen, a hairline that followed the pedals. That only works if the bars
are opaque: translucent bars overlapping would double up, so the trace's translucency
is the strip's `opacity`, which composites its bars as one shape. The trace weight
option and steering's and the marks' own opacities are on the strip for the same reason.

Widening to the left moved the poke to the other end. The bar for the *next* sample now
reached 1.5 px into the right edge the moment a sample committed, and that sliver is
sheared towards the raw live value, which changes every frame: the last pixel column of
the graph changed direction 50 times in a 500-frame recording where the column beside it
changed 18 (2026-09-19). Both ends are closed the same way: the strip overhangs the
graph's clip by the widening on each side: the strips sit in a `.pg-strips` box with
`left: -1.5px; right: -1.5px`, and are `200%` of it. The first attempt, `width: calc(200% +
6px)` on the strip itself, worked in Chromium and left the graph EMPTY in game -- Cohtml did
not apply that `calc` even from the stylesheet, so the stock's `calc(33vw + 2rem)` proves
less than it seemed; percentages and pixels in one `calc` are out. The next sample's bar then
enters only as far as the sampler has advanced, the newest committed value sits exactly
at the right clip, and the wrapped newest bar ends 1.5 px before the left clip. The slopes
are computed against the strip's slot width, which is 3 px / N wider than the graph's
(`EDGE_PX` in the script, tested against the stylesheet).

## The clip edge is antialiased

With the fills solid, a faint hairline the full height of the graph appeared at both
sides, in the trace's colour, in the preview as much as in game. Pixel readings showed
the last column at 76 % trace, 24 % background: the graph's edge sat at x = 374.76, and
a clip at a fractional pixel is antialiased. Layout in em puts almost every edge at a
fraction. `ACEUIAppLoader.dom.snapToPixels` grows the graph's margins by those fractions
so its four edges land on whole pixels; the widget calls it whenever the layout settles
(the same frame that measures the aspect). The graph therefore has no fixed height: the
plot stretches it, and the margins take what they need.

## Trapezoids, not columns

250 samples across the graph is a column every couple of pixels, and a fast movement
-- a clutch blip is five or six samples -- drew as a comb of columns of different
heights. Doubling the bars would halve the teeth and double the DOM. Instead each
pedal's bar is a trapezoid from the previous sample at its left edge to its own at the
right: `translateY((1 - from) * 50%) skewY(-atan((to - from) * aspect))` on an element
twice the graph tall, sheared about its top-left corner, so its top edge slopes and
its bottom stays below the graph where `overflow: hidden` clips it. `aspect` is graph
height over bar width in pixels, read from the layout once the graph has a size and
re-read after a layout change (the first frame after attach or a plot-height change
draws level bars). The incoming bar runs from the last committed sample to the live
value across a whole slot although only a fraction of it is on screen, so the right
edge lags the live value by at most one sample period; the exact slope would divide
by that fraction and flicker just after each commit. Steering (centred) and the marks
(0/1 ticks) keep flat bars: a sheared bar has no flat bottom to sit on the centre line.

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

## Releasing

```
python ..\ACEUIAppLoader\tools\release_app.py pedalgraph
```

writes `dist/ACEPedalGraph-<version>.zip`: the app folder under `mods\uiresources\ACEUIAppLoader\`
and the empty marker under `Video\`, laid out as the contents of `Saved Games\ACE`, exactly
what `install_app.py` puts on disk. It refuses a dirty tree and runs this suite first. The
version is `pedalgraph/app.json`'s and the README must state it (tested). Before uploading:
extract that zip into `Saved Games\ACE` here, launch, and check the log the way the section
below says.

## Verifying in game

The game writes UI `console.log` output into `Saved Games\ACE\Logs\log-*.txt`
as `[gameface]` lines. Run `python ..\ACEUIAppLoader\tools\check_ingame_log.py`
after playing: `[ACEUIAppLoader] app pedalgraph <version>: loading` followed by
`[PedalGraph] script loaded, version <version>, library <loader version>` means the
loader served the app, `sampling ok` once a minute means car data is flowing, and the position
save/restore lines show persistence working.
