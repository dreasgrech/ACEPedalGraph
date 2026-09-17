# ACE PedalGraph

A HUD widget for Assetto Corsa EVO that draws a scrolling graph of throttle, brake, clutch and handbrake input, loaded by the [ACE UI App Loader](https://github.com/dreasgrech/ACEUIAppLoader) and built on its library.

It is also the **reference app**: the smallest complete example of the shape every other app here follows, and the one to copy from.

## Installing

With the loader installed, this app is a folder and an empty marker file:

```
Saved Games\ACE\mods\uiresources\ACEUIAppLoader\pedalgraph\
Saved Games\ACE\Video\ACEUIAppLoader-pedalgraph.settingspreset
```

It overrides no game file — it is a loose folder the game reads, found through its marker.

From a checkout, with the loader repo beside this one:

```
python ..\ACEUIAppLoader\tools\install_app.py pedalgraph
python ..\ACEUIAppLoader\tools\install_app.py --remove pedalgraph
```

Escape and resume in the car reloads the HUD and picks up changes.

## What it is made of

The widget reads the game's `ModelCurrentCar` (`gas_percent`, `brake_percent`, `clutch_percent`, `handbrake_percent`) and animates a fixed set of bars with CSS transforms. Everything that is not the graph comes from the library:

| | |
|---|---|
| `ACEUIAppLoader.panel` | drag, and a position stored as a fraction of the screen so it survives the HUD reload |
| `ACEUIAppLoader.loop` | the frame loop and the fixed-rate sampler |
| `ACEUIAppLoader.app("pedalgraph")` | name, version, title, root, logger and storage keys — so none of them is repeated in the source |

It writes no colours or sizes, only transforms; every class name, timing and precision is a named constant. The version lives in `pedalgraph/app.json` and nowhere else.

## Preview outside the game

Open `dev/preview.html` in Edge or Chrome — double-click, no server needed. It loads the library from the sibling loader checkout, then the real `pedalgraph.css` and `pedalgraph.js`, inside a 16:9 stand-in for the game's HUD container, and feeds them a fake `ModelCurrentCar`.

- `W` throttle, `S` brake, `A` clutch, `Space` handbrake, with pedal travel smoothing — or leave **auto demo** on for a scripted lap
- **hide HUD** toggles `body.hide-hud` like the game's own HUD toggle
- **focused car** toggles `has_focused_car`, the spectator case
- **reset position** clears the stored position; dragging persists as it does in game

What it cannot show: anything Cohtml-specific (this is Chromium), the stock HUD around the widget, and the game's font. Per-frame rendering still needs one real launch — see [`docs/notes.md`](docs/notes.md).

## Tests

```
python -m unittest discover -s tests -v
```

`tests/test_app.py` runs the loader's shared test kit pointed at this repo, plus the widget's own contract; `tests/widget/harness.html` holds the browser cases. Clone `ACEUIAppLoader` and `ACEGameInternals` beside this repo — the preview and the tests load the library and the shared fixtures from `../ACEUIAppLoader/`.

## Layout

```
pedalgraph/
  app.json          version, title, stylesheet and script
  pedalgraph.js     the widget: PedalGraph.attach(root) / .detach(state)
  pedalgraph.css    all styling, trace colours keyed by data-trace index
dev/preview.html    the widget outside the game
tests/
  test_app.py       the shared kit plus this app's contract
  widget/harness.html   the browser cases
docs/notes.md       rendering rules, versioning, and how to verify a change in game
```

### Style

No classes, no `this`, no `var`, no arrow functions, no function declarations; one self-invoking module per file, four-space indent, double quotes. The loader's test kit enforces it — see [`docs/style.md`](https://github.com/dreasgrech/ACEUIAppLoader/blob/main/docs/style.md) there.

Everything learned about the game and its UI engine lives in [`ACEGameInternals`](https://github.com/dreasgrech/ACEGameInternals).
