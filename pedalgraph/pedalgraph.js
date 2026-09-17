/**
 * PedalGraph -- Assetto Corsa EVO HUD widget.
 *
 * A scrolling time graph of throttle, brake, clutch and handbrake input, loaded
 * into the stock HUD page by the ACEUIModLoader (see app.json). It knows
 * nothing of the stock ks-* component framework; it only reads the global model
 * object the game refreshes every frame and draws into one plain <div>. Styling
 * lives in pedalgraph.css; this file writes no colours or sizes, only transforms.
 *
 * Built on the ACEUIModLoader library: `ACEUIModLoader.panel` makes the root draggable and
 * persists its position, `ACEUIModLoader.loop` runs the frame loop and the fixed-rate
 * sampler, `ACEUIModLoader` core provides the small helpers. This file is the graph.
 *
 * Data source: `window.ModelCurrentCar` (UICurrentCarState, mirrored into the
 * Gameface UI by ksUI.perFrameAllModelUpdate). Fields used, all 0..1:
 *
 *     gas_percent, brake_percent, clutch_percent, handbrake_percent
 *
 * Rendering rules (Cohtml/Renoir):
 *
 * The first prototype redrew four SVG paths every frame. Renoir re-tessellates
 * SVG geometry on every change and the game's allocator ran out of chunks within
 * seconds ("Unable to allocate chunk from buddy allocator"), crashing the game.
 * This version only ever changes CSS transforms on a fixed set of elements, the
 * same technique the stock HUD uses for its gauges. No geometry is rebuilt.
 *
 * Each trace is a strip of two identical halves of N thin bars. A committed
 * sample writes one bar in each half and the strip slides left by one bar, so
 * the newest sample is always at the right edge and the wrap-around is
 * invisible. Samples are committed at a fixed SAMPLE_HZ, but every rendered frame
 * (a) slides the strip by the fractional time since the last sample, so the
 * scroll is continuous at any frame rate, and (b) writes the live pedal value
 * into the incoming bar at the right edge, so the newest value never lags a
 * sample. Style writes whose value did not change are skipped.
 *
 * Usage: `PedalGraph.attach(rootElement)` returns the widget's state;
 * `PedalGraph.detach(state)` stops it and releases its listeners.
 */
const PedalGraph = (function () {

    /**
     * Identity from the loader: name, version (app.json), title, root, a prefixed
     * logger and the storage keys, so none of it is repeated here.
     */
    const me = ACEUIModLoader.app("pedalgraph");

    /** History resolution, independent of frame rate. */
    const SAMPLE_HZ = 50;
    /** Visible history in seconds. */
    const WINDOW_S = 5;
    /** Bars per half strip: one per sample in the window (250). */
    const N = SAMPLE_HZ * WINDOW_S;
    /** Bars per strip: two identical halves so the wrap-around is invisible. */
    const STRIP_BARS = 2 * N;
    /** Bars are widened a hair so rounding cannot open seams between them. */
    const BAR_OVERLAP_PCT = 0.02;
    const WINDOW_MS = WINDOW_S * 1000;
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


    /** Class names shared with pedalgraph.css. */
    const CLASS = {
        root: "ace-pedalgraph",
        dragging: "dragging",
        header: "pg-header",
        legend: "pg-legend",
        item: "pg-item",
        swatch: "pg-swatch",
        value: "pg-val",
        attract: "pg-attract",
        attractBox: "pg-attract-box",
        attractOn: "pg-on",
        noData: "pg-nodata",
        plot: "pg-plot",
        graph: "pg-graph",
        grid: "pg-grid",
        track: "pg-track",
        bar: "pg-bar",
        levels: "pg-bars",
        level: "pg-lvl",
        fill: "pg-fill"
    };

    /** Attribute that keys a strip, swatch or level fill to its trace colour in the CSS. */
    const TRACE_ATTR = "data-trace";

    const NO_DATA_TEXT = "waiting for car data";

    /**
     * The traces, in draw order (later ones paint over earlier ones). `key` is the
     * ModelCurrentCar field; the index doubles as the CSS colour key.
     */
    const TRACES = [
        { key: "clutch_percent", label: "CLU" },
        { key: "handbrake_percent", label: "HBK" },
        { key: "brake_percent", label: "BRK" },
        { key: "gas_percent", label: "THR" }
    ];

    /** Indices into TRACES, for the log line. */
    const CLUTCH = 0;
    const HANDBRAKE = 1;
    const BRAKE = 2;
    const GAS = 3;

    const clamp = ACEUIModLoader.clamp;
    const el = ACEUIModLoader.el;
    const close = ACEUIModLoader.close;
    const toArray = ACEUIModLoader.toArray;
    const percentText = ACEUIModLoader.percentText;
    const persist = ACEUIModLoader.persist;
    const log = me.log;

    /**
     * Attract mode: the widget drives itself with scripted pedal inputs (same as
     * dev/preview.html). It is a declared setting, so the loader stores it, draws it in
     * this app's settings window and lists the app in the app drawer; the checkbox on the
     * widget is a second way to reach the same value.
     */
    const ATTRACT_KEY = me.key("attract");      // where it lived before it was a setting
    /** Seconds for one scripted lap of the demo. */
    const ATTRACT_CYCLE_S = 14;
    /** The live attached state, so the demo can be toggled from the dev console: PedalGraph.attract(true). */
    let current = null;

    const options = ACEUIModLoader.settings.define(me.name, [
        {
            key: "attract",
            type: "toggle",
            label: "Attract mode",
            /** Seeded from the old key, so a widget left in attract mode does not reset. */
            value: Boolean(me.recall("attract", false)),
            hint: "scripted inputs, for recording without driving"
        }
    ]);

    // ---- small helpers -----------------------------------------------------------

    const scaleTransform = function (value) {
        return "scaleY(" + value.toFixed(SCALE_DECIMALS) + ")";
    };

    const shiftTransform = function (percent) {
        return "translateX(" + percent.toFixed(SHIFT_DECIMALS) + "%)";
    };

    /** Write one history slot in both halves of a strip. */
    const setSlot = function (track, slot, transform) {
        track.bars[slot].style.transform = transform;
        track.bars[slot + N].style.transform = transform;
    };

    /** The attribute that keys an element to its trace colour in the stylesheet. */
    const traceAttrs = function (index) {
        const attrs = {};

        attrs[TRACE_ATTR] = index;

        return attrs;
    };

    // ---- markup ------------------------------------------------------------------

    /** One trace's strip: two halves of N bars, laid out once, animated by transform. */
    const stripMarkup = function (index) {
        const barW = 100 / STRIP_BARS;
        const width = (barW + BAR_OVERLAP_PCT).toFixed(LAYOUT_DECIMALS);
        const bars = [];
        let j;

        for (j = 0; j < STRIP_BARS; j += 1) {
            bars.push(el("div", CLASS.bar, { style: "left:" + (j * barW).toFixed(LAYOUT_DECIMALS) + "%;width:" + width + "%" }) + close("div"));
        }

        return el("div", CLASS.track, traceAttrs(index)) + bars.join("") + close("div");
    };

    /** The widget's markup: legend, one strip per trace, level bars. */
    const markup = function () {
        let legend = "";
        let tracks = "";
        let levels = "";

        TRACES.forEach(function (trace, index) {
            const traceAttr = traceAttrs(index);

            legend += el("div", CLASS.item, traceAttr)
                + el("div", CLASS.swatch) + close("div")
                + trace.label
                + el("div", CLASS.value) + "0%" + close("div")
                + close("div");
            tracks += stripMarkup(index);
            levels += el("div", CLASS.level, traceAttr) + el("div", CLASS.fill) + close("div") + close("div");
        });

        const grid = GRID_LINES_PCT.map(function (pct) {
            return el("div", CLASS.grid, { style: "top:" + pct + "%" }) + close("div");
        }).join("");

        // temporary control for recording a demo video; a div toggle (Cohtml has no native checkbox),
        // positioned by CSS above the widget's top-left so it never crowds the header; data-nodrag = no drag
        const attract = el("div", CLASS.attract, { "data-nodrag": "" })
            + el("div", CLASS.attractBox, { "data-nodrag": "" }) + close("div")
            + "Attract mode"
            + close("div");

        return attract
            + el("div", CLASS.header)
            + el("div", CLASS.legend) + legend + close("div")
            + el("div", CLASS.noData) + NO_DATA_TEXT + close("div")
            + close("div")
            + el("div", CLASS.plot)
            + el("div", CLASS.graph) + grid + tracks + close("div")
            + el("div", CLASS.levels) + levels + close("div")
            + close("div");
    };

    /**
     * Build (or, on a root that already carries the markup, re-use) the DOM and
     * return the widget's state. Everything the loop touches is looked up once.
     */
    const create = function (root) {
        root.classList.add(CLASS.root);

        if (!root.querySelector("." + CLASS.plot)) { root.innerHTML = markup(); }

        return {
            root: root,
            tracks: toArray(root.querySelectorAll("." + CLASS.track)).map(function (track) {
                return { el: track, bars: toArray(track.querySelectorAll("." + CLASS.bar)) };
            }),
            levels: toArray(root.querySelectorAll("." + CLASS.level + " > ." + CLASS.fill)),
            vals: toArray(root.querySelectorAll("." + CLASS.value)),
            noData: root.querySelector("." + CLASS.noData),
            attractToggle: root.querySelector("." + CLASS.attract),
            attractBox: root.querySelector("." + CLASS.attractBox),
            bag: ACEUIModLoader.dom.listeners(),
            unsubscribeSettings: null,
            head: 0,                    // index of the last committed sample
            lastIncoming: -1,           // slot that last received the live value
            sampler: ACEUIModLoader.loop.sampler(SAMPLE_HZ, WINDOW_MS),
            lastLog: 0,
            lastPct: TRACES.map(function () { return ""; }),
            lastScale: TRACES.map(function () { return ""; }),
            attract: false,             // self-running demo (persisted, toggled from the dev console)
            ui: null                    // me.panel handle: the panel and its frame loop
        };
    };

    // ---- data ------------------------------------------------------------------

    /** The four pedal values, clamped, or null when there is no focused car. */
    const readModel = function () {
        const car = window.ModelCurrentCar;

        if (!car || car.has_focused_car === false) { return null; }

        return TRACES.map(function (trace) {
            const x = car[trace.key];

            return typeof x === "number" ? clamp(x, 0, 1) : 0;
        });
    };

    /** Corners in the scripted lap: braking point (s), peak brake, hard-press time, trail-off time. */
    const ATTRACT_CORNERS = [
        { at: 2.6, peak: 0.98, rise: 0.28, trail: 2.1 },   // heavy stop for a hairpin
        { at: 7.4, peak: 0.55, rise: 0.20, trail: 1.1 },   // light dab for a fast kink
        { at: 11.0, peak: 0.85, rise: 0.30, trail: 1.7 }    // medium-speed corner
    ];
    /** One brief handbrake flick per lap (a tight turn), centre time and half-width in seconds. */
    const ATTRACT_HANDBRAKE = { at: 12.1, width: 0.35 };

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

    /**
     * Scripted pedal inputs for attract mode, in TRACES order, shaped like a human's: braking is a
     * hard fast jab that trails off, throttle eases off for corners and rolls back on out of them,
     * the clutch blips on down- and up-shifts, an occasional handbrake flick. A continuous function
     * of `now` (no state), so the graph scrolls exactly as it would with real telemetry.
     */
    const attractValues = function (now) {
        const phase = (now / 1000) % ATTRACT_CYCLE_S;
        let brake = 0;
        let clutch = 0;

        ATTRACT_CORNERS.forEach(function (corner) {
            brake = Math.max(brake, cornerBrake(phase, corner));
            // a down-shift blip going in, an up-shift blip coming out
            clutch = Math.max(clutch, bump(phase, corner.at + corner.rise + 0.1, 0.12));
            clutch = Math.max(clutch, bump(phase, corner.at + corner.rise + corner.trail * 0.7, 0.12));
        });

        // throttle: a gently undulating near-full baseline on the straights, backed off by the brake,
        // and lifted a touch by the shift blips; the smooth brake curve makes the on/off eases natural
        const straight = clamp(0.82 + 0.14 * Math.sin(phase * 0.7 + 1), 0, 1);
        const gas = clamp(straight * (1 - clutch) - 1.25 * brake, 0, 1);

        const values = {
            gas_percent: gas,
            brake_percent: brake,
            clutch_percent: clutch,
            handbrake_percent: bump(phase, ATTRACT_HANDBRAKE.at, ATTRACT_HANDBRAKE.width)
        };

        return TRACES.map(function (trace) { return values[trace.key]; });
    };

    /** Turn the self-running demo on or off, reflect it on the checkbox, and remember it. */
    const setAttract = function (state, on) {
        state.attract = Boolean(on);

        if (state.attractBox) { state.attractBox.classList.toggle(CLASS.attractOn, state.attract); }

        ACEUIModLoader.settings.set(me.name, "attract", state.attract);
        log("attract " + (state.attract ? "on" : "off"));

        return state.attract;
    };

    /**
     * Write a sample into the next history slot. Visible bars are head+1 .. head+N
     * (second half of the strip), newest at the right edge.
     */
    const commitSample = function (state, v) {
        const slot = (state.head + 1) % N;

        state.tracks.forEach(function (track, t) {
            setSlot(track, slot, scaleTransform(v[t]));
        });

        state.head = slot;
    };

    /** Called every frame; `frac` (0..1) is how far we are towards the next sample. */
    const renderFrame = function (state, v, frac) {
        const incoming = (state.head + 1) % N;
        // bar `head` sits at the right edge when the strip is shifted by (head+1) bars;
        // advancing by `frac` of a bar slides the incoming bar into view continuously
        const shift = shiftTransform(-((state.head + 1 + frac) / STRIP_BARS) * PERCENT);
        const slotAdvanced = incoming !== state.lastIncoming;

        state.tracks.forEach(function (track, t) {
            const scale = scaleTransform(v[t]);
            const pct = percentText(v[t]);

            track.el.style.transform = shift;

            if (scale !== state.lastScale[t]) {
                state.lastScale[t] = scale;
                setSlot(track, incoming, scale);
                state.levels[t].style.transform = scale;
            } else if (slotAdvanced) {
                // value unchanged but the incoming slot moved on: it still needs the live value
                setSlot(track, incoming, scale);
            }

            if (pct !== state.lastPct[t]) {
                state.lastPct[t] = pct;
                state.vals[t].textContent = pct;
            }
        });

        state.lastIncoming = incoming;
    };

    const logSample = function (v) {
        log("sampling ok thr=" + v[GAS].toFixed(LOG_DECIMALS) + " brk=" + v[BRAKE].toFixed(LOG_DECIMALS)
            + " clu=" + v[CLUTCH].toFixed(LOG_DECIMALS) + " hbk=" + v[HANDBRAKE].toFixed(LOG_DECIMALS));
    };

    /** One animation frame: commit due samples, then draw. */
    const tick = function (state, now) {
        const v = state.attract ? attractValues(now) : readModel();
        const shouldLog = now - state.lastLog > LOG_EVERY_MS;

        if (!v) {
            ACEUIModLoader.loop.reset(state.sampler);

            if (shouldLog) {
                state.lastLog = now;
                log("ModelCurrentCar not available yet");
            }

            return;
        }

        // history at the fixed rate (catches up after short hitches, restarts after a stall)
        const frac = ACEUIModLoader.loop.advance(state.sampler, now, function () {
            ACEUIModLoader.section("commit sample", function () { commitSample(state, v); });
        });

        // nothing to draw while the HUD is toggled off; history keeps recording
        if (ACEUIModLoader.hudHidden()) { return; }

        ACEUIModLoader.section("render", function () { renderFrame(state, v, frac); });

        if (state.noData.textContent) { state.noData.textContent = ""; }

        if (shouldLog) {
            state.lastLog = now;
            logSample(v);
        }
    };

    // ---- lifecycle ---------------------------------------------------------------

    /**
     * Build the widget inside `root`, make it a persistent draggable panel and start
     * the frame loop. Returns the state `detach` needs.
     */
    const attach = function (root) {
        const state = create(root);

        state.attract = Boolean(options.attract);

        if (state.attractToggle) {
            state.attractBox.classList.toggle(CLASS.attractOn, state.attract);
            state.bag.on(state.attractToggle, "click", function () { setAttract(state, !state.attract); });
        }

        // the same switch lives in the settings window; follow it when it is moved there
        state.unsubscribeSettings = ACEUIModLoader.settings.onChange(me.name, function (key, value) {
            if (key === "attract" && value !== state.attract) { setAttract(state, value); }
        });

        state.ui = me.panel(root, function (now) { tick(state, now); });
        current = state;
        log("widget attached, bars per trace=" + N + ", history rate=" + SAMPLE_HZ + " Hz, attract " + (state.attract ? "on" : "off"));

        return state;
    };

    /** Stop the loop and release the listeners. The DOM is left in place. */
    const detach = function (state) {
        state.ui.stop();
        state.bag.off();

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
        TRACES: TRACES,
        create: create,
        readModel: readModel,
        attractValues: attractValues,
        setAttract: setAttract,
        /** Toggle the self-running demo on the live widget from the dev console: PedalGraph.attract(true). */
        attract: function (on) { return current ? setAttract(current, on) : false; },
        commitSample: commitSample,
        renderFrame: renderFrame,
        tick: tick,
        attach: attach,
        detach: detach
    };
}());

/* Attach to #pedalgraph: the loader creates it in game, the preview page carries it. */
ACEUIModLoader.app("pedalgraph").mount(PedalGraph.attach, PedalGraph.detach);
