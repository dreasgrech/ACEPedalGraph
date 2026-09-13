/**
 * PedalGraph -- Assetto Corsa EVO HUD widget.
 *
 * A scrolling time graph of throttle, brake, clutch and handbrake input, added to
 * the stock HUD page (hud.html) by a mod package. It knows nothing of the stock
 * ks-* component framework; it only reads the global model object the game
 * refreshes every frame and draws into one plain <div>.
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
 * Each trace is a strip of 2*N thin bars (two identical halves). A committed
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
console.log("[PedalGraph] script loaded, source=" + (window.PEDALGRAPH_SOURCE || "unknown") + ", url=" + location.href);

const PedalGraph = (function () {

    /** History resolution, independent of frame rate. */
    const SAMPLE_HZ = 50;
    /** Visible history in seconds. */
    const WINDOW_S = 5;
    /** Bars per trace (250). */
    const N = SAMPLE_HZ * WINDOW_S;
    const SAMPLE_MS = 1000 / SAMPLE_HZ;
    const WINDOW_MS = WINDOW_S * 1000;
    const LOG_EVERY_MS = 60000;
    const STORAGE_KEY = "acepedalgraph.pos";
    const STYLE_ID = "pedalgraph-style";
    const ROOT_CLASS = "ace-pedalgraph";

    /** Draw order: later traces paint over earlier ones. */
    const TRACES = [
        { key: "clutch_percent", label: "CLU", color: "#3aa6ff" },
        { key: "handbrake_percent", label: "HBK", color: "#ffb020" },
        { key: "brake_percent", label: "BRK", color: "#ff1418" },
        { key: "gas_percent", label: "THR", color: "#44ea78" }
    ];

    /** Index into TRACES, for the log line. */
    const CLUTCH = 0;
    const HANDBRAKE = 1;
    const BRAKE = 2;
    const GAS = 3;

    const CSS = [
        "." + ROOT_CLASS + " {",
        "  position: absolute; left: 2rem; bottom: 12rem; width: 22rem; display: block;",
        "  background: rgba(0, 0, 0, 0.55); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 0.25rem;",
        "  padding: 0.35rem 0.5rem 0.4rem 0.5rem; color: #fff; cursor: pointer;",
        "}",
        "." + ROOT_CLASS + ".dragging { border-color: #bd0000; }",
        "body.hide-hud ." + ROOT_CLASS + " { visibility: hidden; }",
        "." + ROOT_CLASS + " .pg-header { display: flex; flex-direction: row; justify-content: space-between; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 0.2rem; }",
        "." + ROOT_CLASS + " .pg-legend { display: flex; flex-direction: row; }",
        "." + ROOT_CLASS + " .pg-item { display: flex; flex-direction: row; align-items: center; margin-left: 0.6rem; }",
        "." + ROOT_CLASS + " .pg-item:first-child { margin-left: 0; }",
        "." + ROOT_CLASS + " .pg-swatch { width: 0.5rem; height: 0.5rem; border-radius: 0.1rem; margin-right: 0.25rem; }",
        "." + ROOT_CLASS + " .pg-val { min-width: 2.2rem; text-align: right; }",
        "." + ROOT_CLASS + " .pg-nodata { font-size: 0.65rem; opacity: 0.6; }",
        "." + ROOT_CLASS + " .pg-plot { display: flex; flex-direction: row; align-items: stretch; height: 6rem; }",
        "." + ROOT_CLASS + " .pg-graph { position: relative; overflow: hidden; flex: 1 1 auto; height: 100%; background: rgba(255,255,255,0.04); }",
        "." + ROOT_CLASS + " .pg-grid { position: absolute; left: 0; right: 0; height: 1px; background: rgba(255,255,255,0.10); }",
        "." + ROOT_CLASS + " .pg-track { position: absolute; top: 0; left: 0; height: 100%; width: 200%; }",
        "." + ROOT_CLASS + " .pg-bar { position: absolute; top: 0; height: 100%; transform-origin: 50% 100%; transform: scaleY(0); opacity: 0.75; }",
        "." + ROOT_CLASS + " .pg-bars { display: flex; flex-direction: row; margin-left: 0.4rem; height: 100%; }",
        "." + ROOT_CLASS + " .pg-lvl { position: relative; width: 0.45rem; margin-left: 0.2rem; background: rgba(255,255,255,0.08); overflow: hidden; }",
        "." + ROOT_CLASS + " .pg-lvl > div { position: absolute; left: 0; right: 0; top: 0; bottom: 0; transform-origin: 50% 100%; transform: scaleY(0); }"
    ].join("\n");

    const clamp = function (x, lo, hi) {
        if (x < lo) { return lo; }

        if (x > hi) { return hi; }

        return x;
    };

    /** The stylesheet is shared by every widget on the page; inject it once. */
    const injectStyle = function () {
        if (document.getElementById(STYLE_ID)) { return; }

        const style = document.createElement("style");

        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    };

    /** The widget's markup: legend, one 2N-bar strip per trace, level bars. */
    const markup = function () {
        const barW = 100 / (2 * N);
        const barWStr = (barW + 0.02).toFixed(4);
        let legend = "";
        let tracks = "";
        let levels = "";

        TRACES.forEach(function (trace, index) {
            const bars = [];
            let j;

            legend += "<div class=\"pg-item\"><div class=\"pg-swatch\" style=\"background:" + trace.color + "\"></div>"
                + trace.label + "<div class=\"pg-val\">0%</div></div>";

            for (j = 0; j < 2 * N; j += 1) {
                bars.push("<div class=\"pg-bar\" style=\"left:" + (j * barW).toFixed(4) + "%;width:" + barWStr
                    + "%;background:" + trace.color + "\"></div>");
            }

            tracks += "<div class=\"pg-track\" data-trace=\"" + index + "\">" + bars.join("") + "</div>";
            levels += "<div class=\"pg-lvl\"><div style=\"background:" + trace.color + "\"></div></div>";
        });

        return "<div class=\"pg-header\">"
            + "<div class=\"pg-legend\">" + legend + "</div>"
            + "<div class=\"pg-nodata\">waiting for car data</div>"
            + "</div>"
            + "<div class=\"pg-plot\">"
            + "<div class=\"pg-graph\">"
            + "<div class=\"pg-grid\" style=\"top:25%\"></div>"
            + "<div class=\"pg-grid\" style=\"top:50%\"></div>"
            + "<div class=\"pg-grid\" style=\"top:75%\"></div>"
            + tracks
            + "</div>"
            + "<div class=\"pg-bars\">" + levels + "</div>"
            + "</div>";
    };

    /**
     * Build (or, on a root that already carries the markup, re-use) the DOM and
     * return the widget's state. Everything the loop touches is looked up once.
     */
    const create = function (root) {
        injectStyle();
        root.classList.add(ROOT_CLASS);

        if (!root.querySelector(".pg-plot")) { root.innerHTML = markup(); }

        const tracks = Array.prototype.map.call(root.querySelectorAll(".pg-track"), function (el) {
            return { el: el, bars: Array.prototype.slice.call(el.querySelectorAll(".pg-bar")) };
        });

        return {
            root: root,
            tracks: tracks,
            levels: Array.prototype.slice.call(root.querySelectorAll(".pg-lvl > div")),
            vals: Array.prototype.slice.call(root.querySelectorAll(".pg-val")),
            noData: root.querySelector(".pg-nodata"),
            head: 0,                    // index of the last committed sample
            lastIncoming: -1,           // slot that last received the live value
            lastSampleAt: 0,            // timestamp of the last committed sample
            rafId: 0,
            lastLog: 0,
            lastPct: TRACES.map(function () { return -1; }),
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
        const idx = (state.head + 1) % N;

        TRACES.forEach(function (trace, t) {
            const scale = "scaleY(" + v[t].toFixed(3) + ")";
            const bars = state.tracks[t].bars;

            bars[idx].style.transform = scale;
            bars[idx + N].style.transform = scale;
        });

        state.head = idx;
    };

    /** Called every frame; `frac` (0..1) is how far we are towards the next sample. */
    const renderFrame = function (state, v, frac) {
        const head = state.head;
        const incoming = (head + 1) % N;
        // strip is 200% wide; bar `head` at the right edge is shift = -(head+1)/(2N).
        // Advancing by `frac` of a bar slides the incoming bar into view continuously.
        const shift = -((head + 1 + frac) / (2 * N)) * 100;
        const shiftStr = "translateX(" + shift.toFixed(4) + "%)";
        const slotAdvanced = incoming !== state.lastIncoming;

        TRACES.forEach(function (trace, t) {
            const track = state.tracks[t];
            const scale = "scaleY(" + v[t].toFixed(3) + ")";
            const pct = Math.round(v[t] * 100);

            track.el.style.transform = shiftStr;

            if (scale !== state.lastScale[t]) {
                state.lastScale[t] = scale;
                track.bars[incoming].style.transform = scale;
                track.bars[incoming + N].style.transform = scale;
                state.levels[t].style.transform = scale;
            } else if (slotAdvanced) {
                // value unchanged but the incoming slot moved on: it still needs the live value
                track.bars[incoming].style.transform = scale;
                track.bars[incoming + N].style.transform = scale;
            }

            if (pct !== state.lastPct[t]) {
                state.lastPct[t] = pct;
                state.vals[t].textContent = pct + "%";
            }
        });

        state.lastIncoming = incoming;
    };

    /** One animation frame: commit due samples, then draw. Reschedules itself. */
    const tick = function (state, now) {
        state.rafId = requestAnimationFrame(function (next) { tick(state, next); });

        const v = readModel();

        if (!v) {
            state.lastSampleAt = 0;

            if (now - state.lastLog > LOG_EVERY_MS) {
                state.lastLog = now;
                console.log("[PedalGraph] ModelCurrentCar not available yet");
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
        if (document.body.classList.contains("hide-hud")) { return; }

        renderFrame(state, v, clamp((now - state.lastSampleAt) / SAMPLE_MS, 0, 1));

        if (state.noData.textContent) { state.noData.textContent = ""; }

        if (now - state.lastLog > LOG_EVERY_MS) {
            state.lastLog = now;
            console.log("[PedalGraph] sampling ok thr=" + v[GAS].toFixed(2) + " brk=" + v[BRAKE].toFixed(2)
                + " clu=" + v[CLUTCH].toFixed(2) + " hbk=" + v[HANDBRAKE].toFixed(2));
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
        state.root.classList.add("dragging");
    };

    const onMouseMove = function (state, e) {
        if (!state.dragging) { return; }

        moveTo(state, e.clientX - state.dragOffset.x, e.clientY - state.dragOffset.y);
    };

    const onMouseUp = function (state) {
        if (!state.dragging) { return; }

        state.dragging = false;
        state.root.classList.remove("dragging");
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
        console.log("[PedalGraph] widget attached, bars per trace=" + N + ", history rate=" + SAMPLE_HZ + " Hz");

        return state;
    };

    /** Stop the loop and release the listeners. The DOM is left in place. */
    const detach = function (state) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
        state.dragging = false;
        state.root.classList.remove("dragging");

        if (state.handlers) {
            state.root.removeEventListener("mousedown", state.handlers.down);
            window.removeEventListener("mousemove", state.handlers.move);
            window.removeEventListener("mouseup", state.handlers.up);
            state.handlers = null;
        }
    };

    return {
        SAMPLE_HZ: SAMPLE_HZ,
        WINDOW_S: WINDOW_S,
        N: N,
        STORAGE_KEY: STORAGE_KEY,
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
        const root = document.getElementById("pedalgraph");

        if (root) { PedalGraph.attach(root); }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
}());
