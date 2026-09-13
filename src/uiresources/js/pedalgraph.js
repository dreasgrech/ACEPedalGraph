/**
 * PedalGraph -- Assetto Corsa EVO HUD widget.
 *
 * A scrolling time graph of throttle, brake, clutch and handbrake input, added to
 * the stock HUD page (hud.html) by a mod package. It knows nothing of the stock
 * ks-* component framework; it only reads the global model object the game
 * refreshes every frame and draws into one plain <div>. Styling lives in
 * assets/pedalgraph.css; this file writes no colours or sizes, only transforms.
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
 * `PedalGraph.detach(state)` stops it and releases its listeners. The boot block
 * at the bottom attaches to `#pedalgraph` when hud.html has one.
 */
const PedalGraph = (function () {

    /** Mod version -- keep in step with the VERSION file at the repo root. */
    const VERSION = "0.2.1";

    /** Prefix of every log line; the game log and the tests grep for it. */
    const LOG_PREFIX = "[PedalGraph]";

    /** History resolution, independent of frame rate. */
    const SAMPLE_HZ = 50;
    /** Visible history in seconds. */
    const WINDOW_S = 5;
    /** Bars per half strip: one per sample in the window (250). */
    const N = SAMPLE_HZ * WINDOW_S;
    /** Bars per strip: two identical halves so the wrap-around is invisible. */
    const STRIP_BARS = 2 * N;
    /** Width of the strip relative to the visible graph. */
    const STRIP_WIDTH_PCT = 200;
    /** Bars are widened a hair so rounding cannot open seams between them. */
    const BAR_OVERLAP_PCT = 0.02;
    const SAMPLE_MS = 1000 / SAMPLE_HZ;
    const WINDOW_MS = WINDOW_S * 1000;
    const LOG_EVERY_MS = 60000;
    /** Decimals kept when writing transforms; more only churns strings. */
    const SCALE_DECIMALS = 3;
    const SHIFT_DECIMALS = 4;
    const LAYOUT_DECIMALS = 4;
    const LOG_DECIMALS = 2;
    /** Horizontal reference lines, as percent of the graph height from the top. */
    const GRID_LINES_PCT = [25, 50, 75];

    const STORAGE_KEY = "acepedalgraph.pos";
    /** Element id hud.html gives the widget's root; the boot block attaches to it. */
    const ROOT_ID = "pedalgraph";
    /** The stock HUD toggles this class on <body> when the HUD is hidden. */
    const HUD_HIDDEN_CLASS = "hide-hud";

    /** Class names shared with assets/pedalgraph.css. */
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

    // ---- small helpers -----------------------------------------------------------

    const clamp = function (x, lo, hi) {
        if (x < lo) { return lo; }

        if (x > hi) { return hi; }

        return x;
    };

    const log = function (message) {
        console.log(LOG_PREFIX + " " + message);
    };

    const el = function (tag, className, attrs) {
        let html = "<" + tag + " class=\"" + className + "\"";

        Object.keys(attrs || {}).forEach(function (name) {
            html += " " + name + "=\"" + attrs[name] + "\"";
        });

        return html + ">";
    };

    const close = function (tag) {
        return "</" + tag + ">";
    };

    const scaleTransform = function (value) {
        return "scaleY(" + value.toFixed(SCALE_DECIMALS) + ")";
    };

    const shiftTransform = function (percent) {
        return "translateX(" + percent.toFixed(SHIFT_DECIMALS) + "%)";
    };

    const percentText = function (value) {
        return Math.round(value * 100) + "%";
    };

    /** Write one history slot in both halves of a strip. */
    const setSlot = function (track, slot, transform) {
        track.bars[slot].style.transform = transform;
        track.bars[slot + N].style.transform = transform;
    };

    const toArray = function (nodeList) {
        return Array.prototype.slice.call(nodeList);
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

        return el("div", CLASS.header)
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
            head: 0,                    // index of the last committed sample
            lastIncoming: -1,           // slot that last received the live value
            lastSampleAt: 0,            // timestamp of the last committed sample
            rafId: 0,
            lastLog: 0,
            lastPct: TRACES.map(function () { return ""; }),
            lastScale: TRACES.map(function () { return ""; }),
            dragging: false,
            dragOffset: { x: 0, y: 0 },
            handlers: null
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
        const shift = shiftTransform(-((state.head + 1 + frac) / STRIP_BARS) * 100);
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

    /** One animation frame: commit due samples, then draw. Reschedules itself. */
    const tick = function (state, now) {
        state.rafId = requestAnimationFrame(function (next) { tick(state, next); });

        const v = readModel();
        const shouldLog = now - state.lastLog > LOG_EVERY_MS;

        if (!v) {
            state.lastSampleAt = 0;

            if (shouldLog) {
                state.lastLog = now;
                log("ModelCurrentCar not available yet");
            }

            return;
        }

        // first sample, or a stall longer than the whole window: restart the clock
        // instead of replaying hundreds of identical samples
        if (state.lastSampleAt === 0 || now - state.lastSampleAt > WINDOW_MS) {
            state.lastSampleAt = now;
        }

        // commit history at the fixed rate (catches up after short hitches)
        while (now - state.lastSampleAt >= SAMPLE_MS) {
            state.lastSampleAt += SAMPLE_MS;
            commitSample(state, v);
        }

        // nothing to draw while the HUD is toggled off; history keeps recording
        if (document.body.classList.contains(HUD_HIDDEN_CLASS)) { return; }

        renderFrame(state, v, clamp((now - state.lastSampleAt) / SAMPLE_MS, 0, 1));

        if (state.noData.textContent) { state.noData.textContent = ""; }

        if (shouldLog) {
            state.lastLog = now;
            logSample(v);
        }
    };

    // ---- drag / position -------------------------------------------------------

    /** Place the widget at viewport coordinates, clamped so it stays fully on screen. */
    const moveTo = function (state, clientX, clientY) {
        const root = state.root;
        const parent = root.parentElement.getBoundingClientRect();
        const x = clamp(clientX - parent.left, 0, Math.max(0, parent.width - root.offsetWidth));
        const y = clamp(clientY - parent.top, 0, Math.max(0, parent.height - root.offsetHeight));

        root.style.left = Math.round(x) + "px";
        root.style.top = Math.round(y) + "px";
        root.style.bottom = "auto";
    };

    /** Stored as fractions of the parent so the position survives resolution changes. */
    const savePosition = function (state) {
        try {
            const parent = state.root.parentElement.getBoundingClientRect();
            const r = state.root.getBoundingClientRect();

            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                fx: parent.width > 0 ? (r.left - parent.left) / parent.width : 0,
                fy: parent.height > 0 ? (r.top - parent.top) / parent.height : 0
            }));
        } catch (ignore) { /* storage unavailable: the position is simply not remembered */ }
    };

    const restorePosition = function (state) {
        let pos = null;

        try {
            pos = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        } catch (ignore) { /* unreadable store: keep the stylesheet's default position */ }

        if (!pos || typeof pos.fx !== "number" || typeof pos.fy !== "number") { return; }

        const parent = state.root.parentElement.getBoundingClientRect();

        moveTo(state, parent.left + pos.fx * parent.width, parent.top + pos.fy * parent.height);
    };

    const onMouseDown = function (state, e) {
        const r = state.root.getBoundingClientRect();

        state.dragging = true;
        state.dragOffset.x = e.clientX - r.left;
        state.dragOffset.y = e.clientY - r.top;
        state.root.classList.add(CLASS.dragging);
    };

    const onMouseMove = function (state, e) {
        if (!state.dragging) { return; }

        moveTo(state, e.clientX - state.dragOffset.x, e.clientY - state.dragOffset.y);
    };

    const onMouseUp = function (state) {
        if (!state.dragging) { return; }

        state.dragging = false;
        state.root.classList.remove(CLASS.dragging);
        savePosition(state);
    };

    // ---- lifecycle ---------------------------------------------------------------

    /**
     * Build the widget inside `root`, restore its position, wire the drag handlers
     * and start the frame loop. Returns the state `detach` needs.
     */
    const attach = function (root) {
        const state = create(root);

        state.handlers = {
            down: function (e) { onMouseDown(state, e); },
            move: function (e) { onMouseMove(state, e); },
            up: function () { onMouseUp(state); }
        };

        root.addEventListener("mousedown", state.handlers.down);
        window.addEventListener("mousemove", state.handlers.move);
        window.addEventListener("mouseup", state.handlers.up);

        restorePosition(state);

        state.rafId = requestAnimationFrame(function (now) { tick(state, now); });
        log("widget attached, bars per trace=" + N + ", history rate=" + SAMPLE_HZ + " Hz");

        return state;
    };

    /** Stop the loop and release the listeners. The DOM is left in place. */
    const detach = function (state) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
        state.dragging = false;
        state.root.classList.remove(CLASS.dragging);

        if (state.handlers) {
            state.root.removeEventListener("mousedown", state.handlers.down);
            window.removeEventListener("mousemove", state.handlers.move);
            window.removeEventListener("mouseup", state.handlers.up);
            state.handlers = null;
        }
    };

    log("script loaded, version=" + VERSION + ", source=" + (window.PEDALGRAPH_SOURCE || "unknown") + ", url=" + location.href);

    return {
        VERSION: VERSION,
        LOG_PREFIX: LOG_PREFIX,
        SAMPLE_HZ: SAMPLE_HZ,
        WINDOW_S: WINDOW_S,
        N: N,
        STORAGE_KEY: STORAGE_KEY,
        ROOT_ID: ROOT_ID,
        HUD_HIDDEN_CLASS: HUD_HIDDEN_CLASS,
        CLASS: CLASS,
        TRACES: TRACES,
        clamp: clamp,
        create: create,
        readModel: readModel,
        commitSample: commitSample,
        renderFrame: renderFrame,
        tick: tick,
        moveTo: moveTo,
        savePosition: savePosition,
        restorePosition: restorePosition,
        attach: attach,
        detach: detach
    };
}());

/** Boot: hud.html carries `<div id="pedalgraph">`; attach to it once the DOM exists. */
(function () {
    const boot = function () {
        const root = document.getElementById(PedalGraph.ROOT_ID);

        if (root) { PedalGraph.attach(root); }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
}());
