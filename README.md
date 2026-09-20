<div align="center">

# ACE Pedal Graph

**Your pedals, as a scrolling graph on the HUD of Assetto Corsa EVO.**<br>

[![Latest release](https://img.shields.io/github/v/release/dreasgrech/ACEPedalGraph?style=flat-square&label=download&color=0a7)](../../releases/latest)
[![Needs](https://img.shields.io/badge/needs-ACE_UI_App_Loader-informational?style=flat-square)](https://github.com/dreasgrech/ACEUIAppLoader)
[![Downloads](https://img.shields.io/github/downloads/dreasgrech/ACEPedalGraph/total?style=flat-square&color=555)](../../releases)
[![Issues](https://img.shields.io/github/issues/dreasgrech/ACEPedalGraph?style=flat-square&color=555)](../../issues)

</div>

<p align="center"><img width="400" height="171" alt="pedalgraph_cmp_R_96_50fps_400px" src="https://github.com/user-attachments/assets/6ad256aa-ddef-4b49-bda5-5c785bacaeea" /></p>


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

<p align="left"><img width="374" height="741" alt="image" src="https://github.com/user-attachments/assets/7761c2d8-4e9e-4ae9-aa3a-b8d716583d90" /></p>


**OPTIONS** in the app drawer opens the graph's settings. Everything you change is kept,
through the HUD reload and a restart. Click a section header to fold it.

| | |
|---|---|
| **Layout** | Panel scale, how many seconds of driving the graph shows (3, 5 or 10), and a low, normal or tall plot. |
| **Inputs** | Which of clutch, brake, throttle, handbrake and steering are drawn. A hidden one keeps recording, so it has its history when you turn it back on. |
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

<div align="center">
<sub>Pedal Graph 0.8.5 · needs ACE UI App Loader 0.23.0 or newer</sub>
</div>
