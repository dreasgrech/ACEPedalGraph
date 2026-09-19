<div align="center">

# ACE Pedal Graph

**Your pedals, as a scrolling graph on the HUD of Assetto Corsa EVO.**<br>

[![Latest release](https://img.shields.io/github/v/release/dreasgrech/ACEPedalGraph?style=flat-square&label=download&color=0a7)](../../releases/latest)
[![Needs](https://img.shields.io/badge/needs-ACE_UI_App_Loader-informational?style=flat-square)](https://github.com/dreasgrech/ACEUIAppLoader)
[![Downloads](https://img.shields.io/github/downloads/dreasgrech/ACEPedalGraph/total?style=flat-square&color=555)](../../releases)
[![Issues](https://img.shields.io/github/issues/dreasgrech/ACEPedalGraph?style=flat-square&color=555)](../../issues)

[Install](#install) · [Options](#options) · [Help](#if-something-isnt-right) · [Developers](#for-developers)

</div>

<p align="center"><img src="docs/images/widget.png" width="70%" alt="Throttle, brake, clutch and handbrake as a scrolling graph, with a level bar for each"></p>

Throttle, brake, clutch and handbrake scroll across the graph as you drive, each with a live
level bar beside it. Turn on steering and it draws from the centre line; turn on the assist
marks and a tick appears wherever ABS, TC or ESC stepped in. Drag it anywhere on the HUD and it
stays there.

---

## Install

This is an app for the [ACE UI App Loader](https://github.com/dreasgrech/ACEUIAppLoader).
Install that first.

<table>
<tr><td width="40" align="center"><h3>1</h3></td><td>

Download the **`ACEPedalGraph-….zip`** from the [latest release](../../releases/latest) and open it.
Inside are two folders, `mods` and `Video`.

</td></tr>
<tr><td align="center"><h3>2</h3></td><td>

Press <kbd>Win</kbd> + <kbd>R</kbd>, paste this in, press <kbd>Enter</kbd>:

```
%USERPROFILE%\Saved Games\ACE
```

</td></tr>
<tr><td align="center"><h3>3</h3></td><td>

Drag **both** folders out of the zip into that window. If Windows asks, choose to **merge**.
Nothing to run.

</td></tr>
</table>

In the car, move your mouse to the right edge of the screen. The graph is listed in the app
drawer with its own switch and an **OPTIONS** button.

---

## Options

<p align="center"><img src="docs/images/widget-all.png" width="70%" alt="Every channel on: steering drawn from the centre line, ABS, TC and ESC ticks along the top"></p>

**OPTIONS** in the app drawer opens the graph's settings. Everything you change is kept,
through the HUD reload and a restart. Click a section header to fold it.

| | |
|---|---|
| **Layout** | Panel scale, how many seconds of driving the graph shows (3, 5 or 10), and a low, normal or tall plot. |
| **Inputs** | Which of throttle, brake, clutch, handbrake and steering are drawn. A hidden one keeps recording, so it has its history when you turn it back on. |
| **Assist marks** | ABS, TC and ESC: a tick along the top wherever the electronics stepped in, with a legend line of their own. Off by default. |
| **Look** | Faint, normal or bold traces; a dark, light or no background; the legend, level bars, readouts and grid lines on or off. Legend off leaves only the graph. |
| **Draw order** | Drag to choose which input paints over which. |
| **Demo** | Attract mode: scripted inputs, for recording without driving. |

**Reset to defaults** puts every value back.

---

## If something isn't right

<details>
<summary><b>It isn't in the app drawer</b></summary><br>

1. **The loader isn't installed**, or its drawer doesn't appear at all. Start with the
   [loader's own help](https://github.com/dreasgrech/ACEUIAppLoader#if-something-isnt-right).
2. **Only one of the two folders was copied.** The app needs both: the folder under `mods`
   and the small file under `Video`. That file must stay completely empty.

</details>

<details>
<summary><b>It's there but the graph is flat</b></summary><br>

It draws your own car's inputs, so it only moves once you are driving. Spectating shows the
car you are watching.

</details>

<details>
<summary><b>Anything else</b></summary><br>

Open an [issue](../../issues) and say what you saw. If you can, attach the newest file from
`%USERPROFILE%\Saved Games\ACE\Logs`.

</details>

---

## Uninstalling

Delete the folder `mods\uiresources\ACEUIAppLoader\pedalgraph` and the file
`Video\ACEUIAppLoader-pedalgraph.settingspreset`, both under `Saved Games\ACE`. Your settings
stay in the game's UI settings file, where the game ignores them.

---

## For developers

This is the loader's **reference app**: the smallest complete example of the shape every app
follows, and the one to copy from. It is one folder with three files and no build step.

```
pedalgraph/
  app.json          version, title, stylesheet and script
  pedalgraph.js     the widget: PedalGraph.attach(root) / .detach(state)
  pedalgraph.css    all styling in em, one class per option
```

The widget reads the game's `ModelCurrentCar` and animates a fixed set of bars with CSS
transforms, nothing else per frame. Each pedal's bar is a trapezoid from the previous sample
to its own, so a trace is piecewise linear rather than a staircase. Everything that is not
the graph comes from the loader's library: the panel, the frame loop, the settings window,
the panel scale, and the app's own identity.

<details>
<summary><b>Working on it</b></summary><br>

Clone [`ACEUIAppLoader`](https://github.com/dreasgrech/ACEUIAppLoader) and
[`ACEGameInternals`](https://github.com/dreasgrech/ACEGameInternals) beside this repo.

```
python ..\ACEUIAppLoader\tools\install_app.py pedalgraph     # install this checkout; Escape and resume reloads it
python -m unittest discover -s tests -v                       # the shared kit plus the widget's own cases
python tools\preview_fonts.py                                 # once: the game's typeface for the preview
python ..\ACEUIAppLoader\tools\release_app.py pedalgraph      # the release zip, into dist/
```

`dev/preview.html` runs the widget outside the game in Edge or Chrome: `W` `S` `A` `Space`
and the arrow keys drive a fake car, or leave the demo on. It cannot show anything
Cohtml-specific, so a change still needs one launch and a look at the log.

| | |
|---|---|
| [`docs/notes.md`](docs/notes.md) | rendering rules, what the game's engine does differently, how to verify a change in game |
| [`docs/writing-an-app.md`](https://github.com/dreasgrech/ACEUIAppLoader/blob/main/docs/writing-an-app.md) | the app lifecycle and `app.json`, in the loader repo |
| [`docs/style.md`](https://github.com/dreasgrech/ACEUIAppLoader/blob/main/docs/style.md) | the JavaScript rules the test kit enforces |

</details>

---

<div align="center">
<sub>Pedal Graph 0.8.2 · needs ACE UI App Loader 0.23.0 or newer</sub>
</div>
