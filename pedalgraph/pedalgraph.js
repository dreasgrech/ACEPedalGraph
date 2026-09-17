/**
 * PedalGraph -- Assetto Corsa EVO HUD widget.
 *
 * A scrolling time graph of throttle, brake, clutch, handbrake and steering input,
 * with marks where ABS, TC or ESC stepped in, loaded into the stock HUD page by the
 * ACEUIAppLoader (see app.json). It knows nothing of the stock ks-* component
 * framework; it only reads the global model object the game refreshes every frame
 * and draws into one plain <div>. Styling lives in pedalgraph.css; this file writes
 * no colours or sizes, only transforms and classes.
 *
 * Built on the ACEUIAppLoader library: `ACEUIAppLoader.panel` makes the root draggable and
 * persists its position, `ACEUIAppLoader.loop` runs the frame loop and the fixed-rate
 * sampler, `ACEUIAppLoader.settings` holds the options and draws them in the app's
 * settings window, `me.scale` sizes the panel, `ACEUIAppLoader` core provides the small
 * helpers. This file is the graph.
 *
 * Data source: `window.ModelCurrentCar` (UICurrentCarState, mirrored into the
 * Gameface UI by ksUI.perFrameAllModelUpdate). Fields used:
 *
 *     gas_percent, brake_percent, clutch_percent, handbrake_percent   floats 0..1
 *     steering_percent                                                float -1..1, 0 straight
 *     abs_active, tc_active, esc_active                               booleans
 *
 * The steering range is the stock speedo's: it clamps the field to -1..1 and maps it
 * to its +/-35 degree arc (components.js, ks-hudspeedo-radial).
 *
 * Rendering rules (Cohtml/Renoir):
 *
 * The first prototype redrew four SVG paths every frame. Renoir re-tessellates
 * SVG geometry on every change and the game's allocator ran out of chunks within
 * seconds ("Unable to allocate chunk from buddy allocator"), crashing the game.
 * This version only ever changes CSS transforms on a fixed set of elements, the
 * same technique the stock HUD uses for its gauges. No geometry is rebuilt.
 *
 * Each channel is a strip of two identical halves of N thin bars. A committed
 * sample writes one bar in each half and the strip slides left by one bar, so
 * the newest sample is always at the right edge and the wrap-around is
 * invisible. Samples are committed at a fixed rate, but every rendered frame
 * (a) slides the strip by the fractional time since the last sample, so the
 * scroll is continuous at any frame rate, and (b) writes the live value into the
 * incoming bar at the right edge, so the newest value never lags a sample. Style
 * writes whose value did not change are skipped.
 *
 * Three kinds of channel share that machinery and differ only in the transform
 * they write and the stylesheet's transform-origin: a pedal grows from the bottom
 * (`scaleY`), steering grows from the centre line towards its side (a `translateY`
 * and a `scaleY`, origin at the centre), and an assist mark is a thin tick along the
 * top of the graph written with 0 or 1.
 *
 * Options (the app drawer's OPTIONS button opens them): panel scale, the seconds of
 * history across the graph, the plot height, the trace weight, which channels are
 * drawn, the level bars, the legend readouts, the grid, the background, and attract
 * mode. Everything the options change is a class on a fixed element or a number the
 * loop reads. Every strip is built at attach, the optional ones hidden: hidden
 * elements were measured to cost the renderer nothing, and the bar count never
 * changing is what keeps the markup built once. The history window is a sample
 * rate: N bars over more seconds is a slower sampler, not more bars.
 *
 * Usage: `PedalGraph.attach(rootElement)` returns the widget's state;
 * `PedalGraph.detach(state)` stops it and releases its listeners.
 */
const PedalGraph = (function () {

    /**
     * Identity from the loader: name, version (app.json), title, root, a prefixed
     * logger and the storage keys, so none of it is repeated here.
     */
    const me = ACEUIAppLoader.app("pedalgraph");

    /** History resolution at the default window, independent of frame rate. */
    const SAMPLE_HZ = 50;
    /** Visible history in seconds, by default. */
    const WINDOW_S = 5;
    /** Bars per half strip: one per sample in the default window (250). Fixed. */
    const N = SAMPLE_HZ * WINDOW_S;
    /** Bars per strip: two identical halves so the wrap-around is invisible. */
    const STRIP_BARS = 2 * N;
    /** Bars are widened a hair so rounding cannot open seams between them. */
    const BAR_OVERLAP_PCT = 0.02;
    const MS_PER_S = 1000;
    const LOG_EVERY_MS = 60000;
    /** Decimals kept when writing transforms; more only churns strings. */
    const SCALE_DECIMALS = 3;
    const SHIFT_DECIMALS = 4;
    const LAYOUT_DECIMALS = 4;
    const LOG_DECIMALS = 2;
    /** The strip shift is a percentage of the strip's own width. */
    const PERCENT = 100;
    /** Horizontal reference lines, as percent of the graph height from the top. */
    const GRID_LINES_PCT = [25, 50, 75];

    /**
     * A centred bar (steering) spans from the centre line to its value: scaled to half
     * the deviation, since the scale grows both ways from the centre, and moved a
     * quarter of the graph height towards its side. Positive (right) draws upward.
     */
    const CENTRED_HALF = 0.5;
    const CENTRED_SHIFT_PCT = 25;
    const STEER_MIN = -1;
    const STEER_MAX = 1;
    /** Readout prefixes for a signed value. */
    const LEFT_TEXT = "L";
    const RIGHT_TEXT = "R";
    const ZERO_TEXT = "0%";

    /**
     * Panel scale: the root's font-size in rem, everything inside sized in em, applied
     * by `me.scale`. The bounds are this widget's: below 0.6 the readouts are unreadable,
     * above 2 the graph is a quarter of a 1440p screen.
     */
    const SCALE_MIN = 0.6;
    const SCALE_MAX = 2;
    const SCALE_STEP = 0.1;

    /**
     * History window choices. The bar count is fixed (see N), so a longer window is a
     * slower sampler: 10 s over 250 bars is 25 Hz, 3 s is 83 Hz. The label is the stored
     * value, because the choice control shows what it stores.
     */
    const WINDOW_CHOICES = { "3 s": 3, "5 s": 5, "10 s": 10 };
    const WINDOW_DEFAULT = WINDOW_S + " s";

    /** Choices whose middle value is the stylesheet's default and the others a class. */
    const HEIGHT_LOW = "low";
    const HEIGHT_NORMAL = "normal";
    const HEIGHT_TALL = "tall";
    const WEIGHT_FAINT = "faint";
    const WEIGHT_NORMAL = "normal";
    const WEIGHT_BOLD = "bold";
    const BACKGROUND_DARK = "dark";
    const BACKGROUND_LIGHT = "light";
    const BACKGROUND_NONE = "none";

    /** Class names shared with pedalgraph.css. */
    const CLASS = {
        root: "ace-pedalgraph",
        dragging: "dragging",
        header: "pg-header",
        legend: "pg-legend",
        item: "pg-item",
        swatch: "pg-swatch",
        value: "pg-val",
        noData: "pg-nodata",
        plot: "pg-plot",
        graph: "pg-graph",
        grid: "pg-grid",
        track: "pg-track",
        /** On an assist mark's strip and legend item: a thin tick along the top, no readout. */
        mark: "pg-mark",
        bar: "pg-bar",
        levels: "pg-bars",
        level: "pg-lvl",
        fill: "pg-fill",
        /** On a legend item, strip or level bar whose channel is switched off. */
        off: "pg-off",
        /** On the root: what the view options hide, and the looks they choose. */
        noLevels: "pg-nolevels",
        noReadouts: "pg-noreadouts",
        noGrid: "pg-nogrid",
        low: "pg-low",
        tall: "pg-tall",
        faint: "pg-faint",
        bold: "pg-bold",
        bgLight: "pg-bg-light",
        bgNone: "pg-bg-none"
    };

    /** Attribute that keys a strip, swatch or level fill to its channel colour in the CSS. */
    const TRACE_ATTR = "data-trace";

    const NO_DATA_TEXT = "waiting for car data";

    /** How a channel is drawn; see the file comment. */
    const KIND = { level: "level", centred: "centred", mark: "mark" };

    /**
     * The channels, in draw order (later ones paint over earlier ones). `key` is the
     * ModelCurrentCar field; the index doubles as the CSS colour key; `setting` is the
     * option that shows or hides it, `on` its default. The pedals are the first four,
     * which is what the log line and the tests count on.
     */
    const TRACES = [
        { key: "clutch_percent", label: "CLU", name: "Clutch", setting: "showClutch", kind: KIND.level, on: true },
        { key: "handbrake_percent", label: "HBK", name: "Handbrake", setting: "showHandbrake", kind: KIND.level, on: true },
        { key: "brake_percent", label: "BRK", name: "Brake", setting: "showBrake", kind: KIND.level, on: true },
        { key: "gas_percent", label: "THR", name: "Throttle", setting: "showThrottle", kind: KIND.level, on: true },
        { key: "steering_percent", label: "STR", name: "Steering", setting: "showSteering", kind: KIND.centred, on: false },
        { key: "abs_active", label: "ABS", name: "ABS", setting: "markAbs", kind: KIND.mark, on: false },
        { key: "tc_active", label: "TC", name: "TC", setting: "markTc", kind: KIND.mark, on: false },
        { key: "esc_active", label: "ESC", name: "ESC", setting: "markEsc", kind: KIND.mark, on: false }
    ];

    /** Indices into TRACES, for the log line. */
    const CLUTCH = 0;
    const HANDBRAKE = 1;
    const BRAKE = 2;
    const GAS = 3;
    const STEER = 4;

    const clamp = ACEUIAppLoader.clamp;
    const el = ACEUIAppLoader.el;
    const close = ACEUIAppLoader.close;
    const toArray = ACEUIAppLoader.toArray;
    const percentText = ACEUIAppLoader.percentText;
    const setClass = ACEUIAppLoader.dom.setClass;
    const settings = ACEUIAppLoader.settings;
    const log = me.log;

    /**
     * Attract mode: the widget drives itself with scripted inputs (same as
     * dev/preview.html), for recording without driving. Toggled in the settings window
     * or from the dev console: PedalGraph.attract(true).
     */
    /** Seconds for one scripted lap of the demo. */
    const ATTRACT_CYCLE_S = 14;
    /** The live attached state, so the demo can be toggled from the dev console. */
    let current = null;

    /**
     * The options. Declared once at load, so the drawer offers the OPTIONS button and
     * the values are there before attach; the loader stores them and draws the window.
     * Everything but `attract` and `window` is a view option: a class on a fixed element.
     */
    const SETTING = {
        scale: "scale",
        window: "window",
        height: "height",
        weight: "weight",
        levels: "levels",
        readouts: "readouts",
        grid: "grid",
        bg: "background",
        attract: "attract"
    };

    /** The switch for one channel. */
    const channelSpec = function (trace, verb) {
        return { key: trace.setting, type: "toggle", label: verb + " " + trace.name.toLowerCase(), value: trace.on };
    };

    /** One switch per input, listed throttle first: the order a driver thinks in. */
    const inputSpecs = [GAS, BRAKE, HANDBRAKE, CLUTCH, STEER].map(function (t) { return channelSpec(TRACES[t], "Show"); });
    const markSpecs = TRACES.filter(function (trace) { return trace.kind === KIND.mark; }).map(function (trace) {
        return { key: trace.setting, type: "toggle", label: trace.name + " marks", value: trace.on };
    });

    const options = settings.define(me.name, [
        me.scaleSpec({ min: SCALE_MIN, max: SCALE_MAX, step: SCALE_STEP }),
        {
            key: SETTING.window,
            type: "choice",
            label: "History",
            value: WINDOW_DEFAULT,
            options: Object.keys(WINDOW_CHOICES),
            hint: "seconds of input across the graph"
        },
        {
            key: SETTING.height,
            type: "choice",
            label: "Plot height",
            value: HEIGHT_NORMAL,
            options: [HEIGHT_LOW, HEIGHT_NORMAL, HEIGHT_TALL]
        },
        {
            key: SETTING.weight,
            type: "choice",
            label: "Traces",
            value: WEIGHT_NORMAL,
            options: [WEIGHT_FAINT, WEIGHT_NORMAL, WEIGHT_BOLD]
        }
    ].concat(inputSpecs).concat(markSpecs).concat([
        {
            key: SETTING.levels,
            type: "toggle",
            label: "Level bars",
            value: true,
            hint: "the live value of each input, beside the graph"
        },
        {
            key: SETTING.readouts,
            type: "toggle",
            label: "Readouts",
            value: true,
            hint: "the live value of each input, in the legend"
        },
        { key: SETTING.grid, type: "toggle", label: "Grid lines", value: true },
        {
            key: SETTING.bg,
            type: "choice",
            label: "Background",
            value: BACKGROUND_DARK,
            options: [BACKGROUND_DARK, BACKGROUND_LIGHT, BACKGROUND_NONE]
        },
        {
            key: SETTING.attract,
            type: "toggle",
            label: "Attract mode",
            /** Seeded from the key it lived under before it was a setting, so a widget left in attract mode does not reset. */
            value: Boolean(me.recall("attract", false)),
            hint: "scripted inputs, for recording without driving"
        }
    ]));

    /** The option keys that change what is drawn, and nothing else. */
    const VIEW_KEYS = TRACES.map(function (trace) { return trace.setting; })
        .concat([SETTING.height, SETTING.weight, SETTING.levels, SETTING.readouts, SETTING.grid, SETTING.bg]);

    // ---- small helpers -----------------------------------------------------------

    /** A pedal, or a mark: grows from the bottom (or, for a mark, the top) of its strip. */
    const scaleTransform = function (value) {
        return "scaleY(" + value.toFixed(SCALE_DECIMALS) + ")";
    };

    /** Steering: grows from the centre line towards its side; the origin is the centre. */
    const centredTransform = function (value) {
        return "translateY(" + (-value * CENTRED_SHIFT_PCT).toFixed(SHIFT_DECIMALS) + "%) scaleY("
            + (Math.abs(value) * CENTRED_HALF).toFixed(SCALE_DECIMALS) + ")";
    };

    /** Steering readout: which way and how far, "L 42%". */
    const steerText = function (value) {
        const pct = percentText(Math.abs(value));

        if (pct === ZERO_TEXT) { return pct; }

        return (value < 0 ? LEFT_TEXT : RIGHT_TEXT) + " " + pct;
    };

    /** Per channel: how its value becomes a transform, and a readout (null for a mark). */
    const TRANSFORMS = TRACES.map(function (trace) {
        return trace.kind === KIND.centred ? centredTransform : scaleTransform;
    });
    const TEXTS = TRACES.map(function (trace) {
        if (trace.kind === KIND.mark) { return null; }

        return trace.kind === KIND.centred ? steerText : percentText;
    });

    const shiftTransform = function (percent) {
        return "translateX(" + percent.toFixed(SHIFT_DECIMALS) + "%)";
    };

    /** Write one history slot in both halves of a strip. */
    const setSlot = function (track, slot, transform) {
        track.bars[slot].style.transform = transform;
        track.bars[slot + N].style.transform = transform;
    };

    /**
     * Write the live value into the incoming bar at the right edge only. Its twin in the
     * first half is the bar leaving at the LEFT edge -- both are on screen at once, a
     * fraction of a bar each -- and it must keep the sample from a window ago until the
     * commit overwrites both, or the oldest edge of the graph flickers with the newest value.
     */
    const setIncoming = function (track, slot, transform) {
        track.bars[slot + N].style.transform = transform;
    };

    /** The attribute that keys an element to its channel colour in the stylesheet. */
    const traceAttrs = function (index) {
        const attrs = {};

        attrs[TRACE_ATTR] = index;

        return attrs;
    };

    /** Seconds of history the stored choice means; the default when the value is unknown. */
    const windowSeconds = function (choice) {
        return WINDOW_CHOICES[choice] || WINDOW_S;
    };

    /**
     * The sampler for a history window: N bars over that many seconds. A stall longer
     * than the window resets the clock rather than replaying into every slot.
     */
    const samplerFor = function (choice) {
        const seconds = windowSeconds(choice);

        return ACEUIAppLoader.loop.sampler(N / seconds, seconds * MS_PER_S);
    };

    // ---- markup ------------------------------------------------------------------

    /** One channel's strip: two halves of N bars, laid out once, animated by transform. */
    const stripMarkup = function (index) {
        const barW = 100 / STRIP_BARS;
        const width = (barW + BAR_OVERLAP_PCT).toFixed(LAYOUT_DECIMALS);
        const classes = TRACES[index].kind === KIND.mark ? CLASS.track + " " + CLASS.mark : CLASS.track;
        const bars = [];
        let j;

        for (j = 0; j < STRIP_BARS; j += 1) {
            bars.push(el("div", CLASS.bar, { style: "left:" + (j * barW).toFixed(LAYOUT_DECIMALS) + "%;width:" + width + "%" }) + close("div"));
        }

        return el("div", classes, traceAttrs(index)) + bars.join("") + close("div");
    };

    /** The widget's markup: legend, one strip per channel, a level bar per input. */
    const markup = function () {
        let legend = "";
        let tracks = "";
        let levels = "";

        TRACES.forEach(function (trace, index) {
            const traceAttr = traceAttrs(index);
            const isMark = trace.kind === KIND.mark;

            legend += el("div", isMark ? CLASS.item + " " + CLASS.mark : CLASS.item, traceAttr)
                + el("div", CLASS.swatch) + close("div")
                + trace.label
                + (isMark ? "" : el("div", CLASS.value) + ZERO_TEXT + close("div"))
                + close("div");
            tracks += stripMarkup(index);

            if (!isMark) {
                levels += el("div", CLASS.level, traceAttr) + el("div", CLASS.fill) + close("div") + close("div");
            }
        });

        const grid = GRID_LINES_PCT.map(function (pct) {
            return el("div", CLASS.grid, { style: "top:" + pct + "%" }) + close("div");
        }).join("");

        return el("div", CLASS.header)
            + el("div", CLASS.legend) + legend + close("div")
            + el("div", CLASS.noData) + NO_DATA_TEXT + close("div")
            + close("div")
            + el("div", CLASS.plot)
            + el("div", CLASS.graph) + grid + tracks + close("div")
            + el("div", CLASS.levels) + levels + close("div")
            + close("div");
    };

    /** The element of `className` keyed to channel `index`, or null (a mark has no level bar). */
    const forTrace = function (root, className, index, inner) {
        return root.querySelector("." + className + "[" + TRACE_ATTR + "=\"" + index + "\"]" + (inner || ""));
    };

    /**
     * Build (or, on a root that already carries the markup, re-use) the DOM and
     * return the widget's state. Everything the loop touches is looked up once, by
     * channel index, so the arrays line up with TRACES whatever a channel lacks.
     */
    const create = function (root) {
        root.classList.add(CLASS.root);

        if (!root.querySelector("." + CLASS.plot)) { root.innerHTML = markup(); }

        return {
            root: root,
            tracks: TRACES.map(function (trace, t) {
                const track = forTrace(root, CLASS.track, t);

                return { el: track, bars: toArray(track.querySelectorAll("." + CLASS.bar)) };
            }),
            items: TRACES.map(function (trace, t) { return forTrace(root, CLASS.item, t); }),
            levelBoxes: TRACES.map(function (trace, t) { return forTrace(root, CLASS.level, t); }),
            levels: TRACES.map(function (trace, t) { return forTrace(root, CLASS.level, t, " > ." + CLASS.fill); }),
            vals: TRACES.map(function (trace, t) { return forTrace(root, CLASS.item, t, " ." + CLASS.value); }),
            noData: root.querySelector("." + CLASS.noData),
            unsubscribeSettings: null,
            head: 0,                    // index of the last committed sample
            lastIncoming: -1,           // slot that last received the live value
            sampler: samplerFor(options[SETTING.window]),
            lastLog: 0,
            lastPct: TRACES.map(function () { return ""; }),
            lastScale: TRACES.map(function () { return ""; }),
            shown: TRACES.map(function () { return true; }),   // per channel: drawn, or switched off in the options
            levelsOn: true,             // the level bars are drawn
            readoutsOn: true,           // the legend values are written
            attract: false,             // self-running demo (a setting, toggled from the dev console too)
            scaler: null,               // me.scale handle: the loader owns panel scaling
            ui: null                    // me.panel handle: the panel and its frame loop
        };
    };

    // ---- options -----------------------------------------------------------------

    /**
     * Put the view options on the page: a class per hidden thing, on a fixed element,
     * so nothing is built or torn down. The per-frame caches are cleared so the next
     * frame rewrites every visible value: a channel or a level bar coming back would
     * otherwise show whatever it held when it was switched off, for as long as the live
     * value happened to match the cached one.
     */
    const applyView = function (state) {
        TRACES.forEach(function (trace, t) {
            const shown = options[trace.setting] !== false;

            state.shown[t] = shown;
            setClass(state.items[t], CLASS.off, !shown);
            setClass(state.tracks[t].el, CLASS.off, !shown);
            setClass(state.levelBoxes[t], CLASS.off, !shown);
            state.lastScale[t] = "";
            state.lastPct[t] = "";
        });

        state.levelsOn = options[SETTING.levels] !== false;
        state.readoutsOn = options[SETTING.readouts] !== false;
        setClass(state.root, CLASS.noLevels, !state.levelsOn);
        setClass(state.root, CLASS.noReadouts, !state.readoutsOn);
        setClass(state.root, CLASS.noGrid, options[SETTING.grid] === false);
        setClass(state.root, CLASS.low, options[SETTING.height] === HEIGHT_LOW);
        setClass(state.root, CLASS.tall, options[SETTING.height] === HEIGHT_TALL);
        setClass(state.root, CLASS.faint, options[SETTING.weight] === WEIGHT_FAINT);
        setClass(state.root, CLASS.bold, options[SETTING.weight] === WEIGHT_BOLD);
        setClass(state.root, CLASS.bgLight, options[SETTING.bg] === BACKGROUND_LIGHT);
        setClass(state.root, CLASS.bgNone, options[SETTING.bg] === BACKGROUND_NONE);
    };

    /**
     * A new history window: the same bars, sampled at a new rate. The bars already on
     * screen keep their positions, so for one window's worth of scrolling the old history
     * is drawn at the new time scale; then it has scrolled off.
     */
    const applyWindow = function (state, choice) {
        state.sampler = samplerFor(choice);
        log("history window " + windowSeconds(choice) + " s, " + (N / windowSeconds(choice)).toFixed(0) + " Hz");
    };

    /** Turn the self-running demo on or off, and remember it. */
    const setAttract = function (state, on) {
        state.attract = Boolean(on);
        settings.set(me.name, SETTING.attract, state.attract);
        log("attract " + (state.attract ? "on" : "off"));

        return state.attract;
    };

    /** What the settings window changed, applied to the live widget. */
    const onSetting = function (state, key, value) {
        if (key === SETTING.attract) {
            if (value !== state.attract) { setAttract(state, value); }

            return;
        }

        if (key === SETTING.window) {
            applyWindow(state, value);

            return;
        }

        // the scale is me.scale's to apply; anything else drawn is a class
        if (VIEW_KEYS.indexOf(key) >= 0) { applyView(state); }
    };

    // ---- data ------------------------------------------------------------------

    /** One channel's value from the car: a clamped float, or 1 / 0 for an assist flag. */
    const readChannel = function (car, trace) {
        const x = car[trace.key];

        if (trace.kind === KIND.mark) { return x === true ? 1 : 0; }

        if (typeof x !== "number") { return 0; }

        return trace.kind === KIND.centred ? clamp(x, STEER_MIN, STEER_MAX) : clamp(x, 0, 1);
    };

    /** Every channel's value, in TRACES order, or null when there is no focused car. */
    const readModel = function () {
        const car = window.ModelCurrentCar;

        if (!car || car.has_focused_car === false) { return null; }

        return TRACES.map(function (trace) { return readChannel(car, trace); });
    };

    /**
     * Corners in the scripted lap: braking point (s), peak brake, hard-press time, trail-off
     * time, and which way and how far the wheel turns through it.
     */
    const ATTRACT_CORNERS = [
        { at: 2.6, peak: 0.98, rise: 0.28, trail: 2.1, steer: -0.85 },   // heavy stop for a left hairpin
        { at: 7.4, peak: 0.55, rise: 0.20, trail: 1.1, steer: 0.35 },    // light dab for a fast right kink
        { at: 11.0, peak: 0.85, rise: 0.30, trail: 1.7, steer: 0.6 }     // medium-speed right-hander
    ];
    /** One brief handbrake flick per lap (a tight turn), centre time and half-width in seconds. */
    const ATTRACT_HANDBRAKE = { at: 12.1, width: 0.35 };
    /** Brake pressure above which the demo's ABS is working, and throttle above which its TC is. */
    const ATTRACT_ABS_BRAKE = 0.9;
    const ATTRACT_TC_GAS = 0.93;
    /** Seconds after a corner's trail-off during which the demo's TC catches the throttle. */
    const ATTRACT_TC_S = 0.5;
    /** The wheel turns in over the braking phase and unwinds over this much of the exit. */
    const ATTRACT_STEER_HOLD = 0.6;

    /** ease-out (fast then settling): 0..1 -> 0..1. */
    const easeOut = function (x) { return 1 - (1 - x) * (1 - x); };

    /** A smooth 0->1->0 bump, 1 at the centre, 0 at +/- width; for clutch and handbrake pulses. */
    const bump = function (t, centre, width) {
        const d = Math.abs(t - centre);

        return d >= width ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / width);
    };

    /** Brake for one corner: presses hard and fast (ease-out rise), then trails off gradually (ease-out fall). */
    const cornerBrake = function (phase, corner) {
        const t = phase - corner.at;

        if (t < 0 || t > corner.rise + corner.trail) { return 0; }

        if (t < corner.rise) { return corner.peak * easeOut(t / corner.rise); }

        const k = (t - corner.rise) / corner.trail;

        return corner.peak * (1 - k) * (1 - k);
    };

    /** Steering through one corner: a smooth turn-in over the braking, held, unwound on the exit. */
    const cornerSteer = function (phase, corner) {
        const span = corner.rise + corner.trail * (1 + ATTRACT_STEER_HOLD);

        return corner.steer * bump(phase, corner.at + span / 2, span / 2);
    };

    /**
     * Scripted inputs for attract mode, in TRACES order, shaped like a human's: braking is a
     * hard fast jab that trails off, throttle eases off for corners and rolls back on out of them,
     * the clutch blips on down- and up-shifts, the wheel turns through each corner, an occasional
     * handbrake flick; ABS works under the hardest braking, TC catches the throttle on the exits,
     * ESC during the handbrake flick. A continuous function of `now` (no state), so the graph
     * scrolls exactly as it would with real telemetry.
     */
    const attractValues = function (now) {
        const phase = (now / MS_PER_S) % ATTRACT_CYCLE_S;
        let brake = 0;
        let clutch = 0;
        let steer = 0;
        let tc = 0;

        ATTRACT_CORNERS.forEach(function (corner) {
            const exit = corner.at + corner.rise + corner.trail;

            brake = Math.max(brake, cornerBrake(phase, corner));
            steer += cornerSteer(phase, corner);
            // a down-shift blip going in, an up-shift blip coming out
            clutch = Math.max(clutch, bump(phase, corner.at + corner.rise + 0.1, 0.12));
            clutch = Math.max(clutch, bump(phase, corner.at + corner.rise + corner.trail * 0.7, 0.12));

            if (phase > exit && phase < exit + ATTRACT_TC_S) { tc = 1; }
        });

        // throttle: a gently undulating near-full baseline on the straights, backed off by the brake,
        // and lifted a touch by the shift blips; the smooth brake curve makes the on/off eases natural
        const straight = clamp(0.82 + 0.14 * Math.sin(phase * 0.7 + 1), 0, 1);
        const gas = clamp(straight * (1 - clutch) - 1.25 * brake, 0, 1);
        const handbrake = bump(phase, ATTRACT_HANDBRAKE.at, ATTRACT_HANDBRAKE.width);

        const values = {
            gas_percent: gas,
            brake_percent: brake,
            clutch_percent: clutch,
            handbrake_percent: handbrake,
            steering_percent: clamp(steer, STEER_MIN, STEER_MAX),
            abs_active: brake > ATTRACT_ABS_BRAKE ? 1 : 0,
            tc_active: tc && gas > ATTRACT_TC_GAS ? 1 : 0,
            esc_active: handbrake > CENTRED_HALF ? 1 : 0
        };

        return TRACES.map(function (trace) { return values[trace.key]; });
    };

    /**
     * Write a sample into the next history slot. Visible bars are head+1 .. head+N
     * (second half of the strip), newest at the right edge. Every channel records, drawn
     * or not, so one switched back on shows the history it has, not a gap.
     */
    const commitSample = function (state, v) {
        const slot = (state.head + 1) % N;

        state.tracks.forEach(function (track, t) {
            setSlot(track, slot, TRANSFORMS[t](v[t]));
        });

        state.head = slot;
    };

    /**
     * Called every frame; `frac` (0..1) is how far we are towards the next sample. A
     * channel switched off in the options is skipped whole, and the level bars and
     * readouts are skipped when hidden or when the channel has none: hidden elements
     * cost the renderer nothing, so the only thing left to save is the writes themselves.
     */
    const renderFrame = function (state, v, frac) {
        const incoming = (state.head + 1) % N;
        // bar `head` sits at the right edge when the strip is shifted by (head+1) bars;
        // advancing by `frac` of a bar slides the incoming bar into view continuously
        const shift = shiftTransform(-((state.head + 1 + frac) / STRIP_BARS) * PERCENT);
        const slotAdvanced = incoming !== state.lastIncoming;

        state.tracks.forEach(function (track, t) {
            if (!state.shown[t]) { return; }

            const scale = TRANSFORMS[t](v[t]);

            track.el.style.transform = shift;

            if (scale !== state.lastScale[t]) {
                state.lastScale[t] = scale;
                setIncoming(track, incoming, scale);

                if (state.levelsOn && state.levels[t]) { state.levels[t].style.transform = scale; }
            } else if (slotAdvanced) {
                // value unchanged but the incoming slot moved on: it still needs the live value
                setIncoming(track, incoming, scale);
            }

            if (!state.readoutsOn || !state.vals[t]) { return; }

            const pct = TEXTS[t](v[t]);

            if (pct !== state.lastPct[t]) {
                state.lastPct[t] = pct;
                state.vals[t].textContent = pct;
            }
        });

        state.lastIncoming = incoming;
    };

    const logSample = function (v) {
        log("sampling ok thr=" + v[GAS].toFixed(LOG_DECIMALS) + " brk=" + v[BRAKE].toFixed(LOG_DECIMALS)
            + " clu=" + v[CLUTCH].toFixed(LOG_DECIMALS) + " hbk=" + v[HANDBRAKE].toFixed(LOG_DECIMALS)
            + " str=" + v[STEER].toFixed(LOG_DECIMALS));
    };

    /** One animation frame: commit due samples, then draw. */
    const tick = function (state, now) {
        const v = state.attract ? attractValues(now) : readModel();
        const shouldLog = now - state.lastLog > LOG_EVERY_MS;

        if (!v) {
            ACEUIAppLoader.loop.reset(state.sampler);

            if (shouldLog) {
                state.lastLog = now;
                log("ModelCurrentCar not available yet");
            }

            return;
        }

        // history at the fixed rate (catches up after short hitches, restarts after a stall)
        const frac = ACEUIAppLoader.loop.advance(state.sampler, now, function () {
            ACEUIAppLoader.section("commit sample", function () { commitSample(state, v); });
        });

        // nothing to draw while the HUD is toggled off; history keeps recording
        if (ACEUIAppLoader.hudHidden()) { return; }

        ACEUIAppLoader.section("render", function () { renderFrame(state, v, frac); });

        if (state.noData.textContent) { state.noData.textContent = ""; }

        if (shouldLog) {
            state.lastLog = now;
            logSample(v);
        }
    };

    // ---- lifecycle ---------------------------------------------------------------

    /**
     * Build the widget inside `root`, make it a persistent draggable panel, put the
     * stored options on it and start the frame loop. Returns the state `detach` needs.
     */
    const attach = function (root) {
        const state = create(root);

        state.attract = Boolean(options[SETTING.attract]);
        applyView(state);

        // kept, because attach runs again every time the app drawer switches this app back
        // on: a listener per attach would pile up, each holding a state nobody draws any more
        state.unsubscribeSettings = settings.onChange(me.name, function (key, value) {
            onSetting(state, key, value);
        });
        state.scaler = me.scale(root, { min: SCALE_MIN, max: SCALE_MAX, step: SCALE_STEP });
        state.ui = me.panel(root, function (now) { tick(state, now); });
        current = state;
        log("widget attached, bars per channel=" + N + ", channels " + state.shown.filter(Boolean).length + "/" + TRACES.length
            + ", history rate=" + (N / windowSeconds(options[SETTING.window])).toFixed(0)
            + " Hz, scale " + state.scaler.value() + ", attract " + (state.attract ? "on" : "off"));

        return state;
    };

    /** Stop the loop and release the listeners. The DOM is left in place. */
    const detach = function (state) {
        state.ui.stop();

        if (state.scaler) {
            state.scaler.stop();
            state.scaler = null;
        }

        if (state.unsubscribeSettings) {
            state.unsubscribeSettings();
            state.unsubscribeSettings = null;
        }

        if (current === state) { current = null; }
    };

    return {
        SAMPLE_HZ: SAMPLE_HZ,
        WINDOW_S: WINDOW_S,
        N: N,
        CLASS: CLASS,
        KIND: KIND,
        TRACES: TRACES,
        SETTING: SETTING,
        WINDOW_CHOICES: WINDOW_CHOICES,
        create: create,
        readModel: readModel,
        attractValues: attractValues,
        centredTransform: centredTransform,
        steerText: steerText,
        setAttract: setAttract,
        /** Toggle the self-running demo on the live widget from the dev console: PedalGraph.attract(true). */
        attract: function (on) { return current ? setAttract(current, on) : false; },
        applyView: applyView,
        commitSample: commitSample,
        renderFrame: renderFrame,
        tick: tick,
        attach: attach,
        detach: detach
    };
}());

/* Attach to #pedalgraph: the loader creates it in game, the preview page carries it. */
ACEUIAppLoader.app("pedalgraph").mount(PedalGraph.attach, PedalGraph.detach);
