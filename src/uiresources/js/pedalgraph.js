// PedalGraph - Assetto Corsa EVO HUD widget
// Scrolling time graph of throttle, brake, clutch and handbrake input.
//
// Data source: window.ModelCurrentCar (UICurrentCarState mirrored into the Gameface UI
// every frame by ksUI.perFrameAllModelUpdate). Fields used, all 0..1:
//   gas_percent, brake_percent, clutch_percent, handbrake_percent
//
// Rendering notes (important for Cohtml/Renoir):
//   The first prototype redrew four SVG paths every frame. Renoir re-tessellates SVG
//   geometry on every change and the game's allocator ran out of chunks within seconds
//   ("Unable to allocate chunk from buddy allocator"), crashing the game.
//   This version only ever changes CSS transforms on a fixed set of elements, which is
//   the same technique the stock HUD uses for its gauges. No geometry is rebuilt.
//
//   Each trace is a strip of 2*N thin bars (two identical halves). A new sample writes
//   one bar in each half and slides the strip left by one bar, so the newest sample is
//   always at the right edge and the wrap-around is invisible.
//
//   Smoothness: samples are committed to the history at a fixed SAMPLE_HZ, but every
//   rendered frame (a) slides the strip by the fractional time since the last sample,
//   so the scroll is continuous at any frame rate, and (b) writes the live pedal value
//   into the incoming bar at the right edge, so the newest value never lags a sample.
//   Style writes whose value did not change are skipped.

console.log("[PedalGraph] script loaded, source=" + (window.PEDALGRAPH_SOURCE || "unknown") + ", url=" + location.href);

const SAMPLE_HZ = 50;              // history resolution, independent of frame rate
const WINDOW_S = 5;                // visible history in seconds
const N = SAMPLE_HZ * WINDOW_S;    // bars per trace (250)
const SAMPLE_MS = 1000 / SAMPLE_HZ;
const WINDOW_MS = WINDOW_S * 1000;
const LOG_EVERY_MS = 60000;
const STORAGE_KEY = "acepedalgraph.pos";

const TRACES = [
    { key: "clutch_percent",    label: "CLU", color: "#3aa6ff" },
    { key: "handbrake_percent", label: "HBK", color: "#ffb020" },
    { key: "brake_percent",     label: "BRK", color: "#ff1418" },
    { key: "gas_percent",       label: "THR", color: "#44ea78" },
];

const CSS = [
    "ace-pedalgraph {",
    "  position: absolute; left: 2rem; bottom: 12rem; width: 22rem; display: block;",
    "  background: rgba(0, 0, 0, 0.55); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 0.25rem;",
    "  padding: 0.35rem 0.5rem 0.4rem 0.5rem; color: #fff; cursor: pointer;",
    "}",
    "ace-pedalgraph.dragging { border-color: #bd0000; }",
    "body.hide-hud ace-pedalgraph { visibility: hidden; }",
    "ace-pedalgraph .pg-header { display: flex; flex-direction: row; justify-content: space-between; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 0.2rem; }",
    "ace-pedalgraph .pg-legend { display: flex; flex-direction: row; }",
    "ace-pedalgraph .pg-item { display: flex; flex-direction: row; align-items: center; margin-left: 0.6rem; }",
    "ace-pedalgraph .pg-item:first-child { margin-left: 0; }",
    "ace-pedalgraph .pg-swatch { width: 0.5rem; height: 0.5rem; border-radius: 0.1rem; margin-right: 0.25rem; }",
    "ace-pedalgraph .pg-val { min-width: 2.2rem; text-align: right; }",
    "ace-pedalgraph .pg-nodata { font-size: 0.65rem; opacity: 0.6; }",
    "ace-pedalgraph .pg-plot { display: flex; flex-direction: row; align-items: stretch; height: 6rem; }",
    "ace-pedalgraph .pg-graph { position: relative; overflow: hidden; flex: 1 1 auto; height: 100%; background: rgba(255,255,255,0.04); }",
    "ace-pedalgraph .pg-grid { position: absolute; left: 0; right: 0; height: 1px; background: rgba(255,255,255,0.10); }",
    "ace-pedalgraph .pg-track { position: absolute; top: 0; left: 0; height: 100%; width: 200%; }",
    "ace-pedalgraph .pg-bar { position: absolute; top: 0; height: 100%; transform-origin: 50% 100%; transform: scaleY(0); opacity: 0.75; }",
    "ace-pedalgraph .pg-bars { display: flex; flex-direction: row; margin-left: 0.4rem; height: 100%; }",
    "ace-pedalgraph .pg-lvl { position: relative; width: 0.45rem; margin-left: 0.2rem; background: rgba(255,255,255,0.08); overflow: hidden; }",
    "ace-pedalgraph .pg-lvl > div { position: absolute; left: 0; right: 0; top: 0; bottom: 0; transform-origin: 50% 100%; transform: scaleY(0); }",
].join("\n");

function clamp(x, lo, hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}

class PedalGraph extends HTMLElement {

    constructor() {
        super();
        this.built = false;
        this.tracks = [];          // per trace: { el, bars: [2N elements] }
        this.levels = [];          // per trace: level bar element
        this.vals = [];            // per trace: numeric readout element
        this.noData = null;
        this.head = 0;             // index of the last committed sample
        this.lastSampleAt = 0;     // timestamp of the last committed sample
        this.rafId = 0;
        this.lastLog = 0;
        this.lastPct = [];
        this.lastScale = [];       // last scaleY string written per trace (live bar + level)
        this.dragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.tick = this.tick.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
    }

    // ---- lifecycle ----------------------------------------------------------------

    connectedCallback() {
        if (!this.built) {
            this.build();
            this.built = true;
        }
        this.addEventListener("mousedown", this.onMouseDown);
        window.addEventListener("mousemove", this.onMouseMove);
        window.addEventListener("mouseup", this.onMouseUp);

        this.restorePosition();

        if (!this.rafId) {
            this.lastSampleAt = 0;
            this.rafId = requestAnimationFrame(this.tick);
        }
        console.log("[PedalGraph] widget attached, bars per trace=" + N + ", history rate=" + SAMPLE_HZ + " Hz");
    }

    disconnectedCallback() {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
        this.removeEventListener("mousedown", this.onMouseDown);
        window.removeEventListener("mousemove", this.onMouseMove);
        window.removeEventListener("mouseup", this.onMouseUp);
        this.dragging = false;
    }

    build() {
        if (!document.getElementById("pedalgraph-style")) {
            const style = document.createElement("style");
            style.id = "pedalgraph-style";
            style.textContent = CSS;
            document.head.appendChild(style);
        }

        const barW = 100 / (2 * N);   // percent of the (200% wide) track
        const barWStr = (barW + 0.02).toFixed(4);
        let legend = "";
        let tracks = "";
        let levels = "";
        for (let t = 0; t < TRACES.length; t++) {
            const tr = TRACES[t];
            legend += '<div class="pg-item"><div class="pg-swatch" style="background:' + tr.color + '"></div>' + tr.label + '<div class="pg-val">0%</div></div>';
            const bars = [];
            for (let j = 0; j < 2 * N; j++) {
                bars.push('<div class="pg-bar" style="left:' + (j * barW).toFixed(4) + '%;width:' + barWStr + '%;background:' + tr.color + '"></div>');
            }
            tracks += '<div class="pg-track" data-trace="' + t + '">' + bars.join("") + '</div>';
            levels += '<div class="pg-lvl"><div style="background:' + tr.color + '"></div></div>';
        }

        this.innerHTML =
            '<div class="pg-header">' +
                '<div class="pg-legend">' + legend + '</div>' +
                '<div class="pg-nodata">waiting for car data</div>' +
            '</div>' +
            '<div class="pg-plot">' +
                '<div class="pg-graph">' +
                    '<div class="pg-grid" style="top:25%"></div>' +
                    '<div class="pg-grid" style="top:50%"></div>' +
                    '<div class="pg-grid" style="top:75%"></div>' +
                    tracks +
                '</div>' +
                '<div class="pg-bars">' + levels + '</div>' +
            '</div>';

        this.tracks = Array.from(this.querySelectorAll(".pg-track")).map(el => ({
            el: el,
            bars: Array.from(el.querySelectorAll(".pg-bar"))
        }));
        this.levels = Array.from(this.querySelectorAll(".pg-lvl > div"));
        this.vals = Array.from(this.querySelectorAll(".pg-val"));
        this.noData = this.querySelector(".pg-nodata");
        this.lastPct = TRACES.map(() => -1);
        this.lastScale = TRACES.map(() => "");
    }

    // ---- data -----------------------------------------------------------------------

    readModel() {
        const car = window["ModelCurrentCar"];
        if (!car || car.has_focused_car === false) return null;
        const v = [];
        for (let t = 0; t < TRACES.length; t++) {
            const x = car[TRACES[t].key];
            v.push(typeof x === "number" ? clamp(x, 0, 1) : 0);
        }
        return v;
    }

    tick(now) {
        this.rafId = requestAnimationFrame(this.tick);

        const v = this.readModel();
        if (!v) {
            this.lastSampleAt = 0;
            if (now - this.lastLog > LOG_EVERY_MS) {
                this.lastLog = now;
                console.log("[PedalGraph] ModelCurrentCar not available yet");
            }
            return;
        }

        // first sample, or a stall longer than the whole window: restart the clock
        // instead of replaying hundreds of identical samples
        if (this.lastSampleAt === 0 || now - this.lastSampleAt > WINDOW_MS) {
            this.lastSampleAt = now;
        }

        // commit history at the fixed rate (catches up after short hitches)
        while (now - this.lastSampleAt >= SAMPLE_MS) {
            this.lastSampleAt += SAMPLE_MS;
            this.commitSample(v);
        }

        // nothing to draw while the HUD is toggled off; history keeps recording
        if (document.body.classList.contains("hide-hud")) return;

        const frac = clamp((now - this.lastSampleAt) / SAMPLE_MS, 0, 1);
        this.renderFrame(v, frac);

        if (this.noData.textContent) this.noData.textContent = "";
        if (now - this.lastLog > LOG_EVERY_MS) {
            this.lastLog = now;
            console.log("[PedalGraph] sampling ok thr=" + v[3].toFixed(2) + " brk=" + v[2].toFixed(2) +
                " clu=" + v[0].toFixed(2) + " hbk=" + v[1].toFixed(2));
        }
    }

    // Write a sample into the next history slot. Visible bars are head+1 .. head+N
    // (second half of the strip), newest at the right edge.
    commitSample(v) {
        const idx = (this.head + 1) % N;
        for (let t = 0; t < TRACES.length; t++) {
            const scale = "scaleY(" + v[t].toFixed(3) + ")";
            const bars = this.tracks[t].bars;
            bars[idx].style.transform = scale;
            bars[idx + N].style.transform = scale;
        }
        this.head = idx;
    }

    // Called every frame. `frac` (0..1) is how far we are towards the next sample.
    renderFrame(v, frac) {
        const head = this.head;
        const incoming = (head + 1) % N;
        // strip is 200% wide; bar `head` at the right edge is shift = -(head+1)/(2N).
        // Advancing by `frac` of a bar slides the incoming bar into view continuously.
        const shift = -((head + 1 + frac) / (2 * N)) * 100;
        const shiftStr = "translateX(" + shift.toFixed(4) + "%)";
        for (let t = 0; t < TRACES.length; t++) {
            const trk = this.tracks[t];
            trk.el.style.transform = shiftStr;

            const scale = "scaleY(" + v[t].toFixed(3) + ")";
            if (scale !== this.lastScale[t]) {
                this.lastScale[t] = scale;
                trk.bars[incoming].style.transform = scale;
                trk.bars[incoming + N].style.transform = scale;
                this.levels[t].style.transform = scale;
            } else if (incoming !== this.lastIncoming) {
                // value unchanged but the incoming slot advanced: it still needs the live value
                trk.bars[incoming].style.transform = scale;
                trk.bars[incoming + N].style.transform = scale;
            }

            const pct = Math.round(v[t] * 100);
            if (pct !== this.lastPct[t]) {
                this.lastPct[t] = pct;
                this.vals[t].textContent = pct + "%";
            }
        }
        this.lastIncoming = incoming;
    }

    // ---- drag / position ------------------------------------------------------------

    onMouseDown(e) {
        this.dragging = true;
        const r = this.getBoundingClientRect();
        this.dragOffset.x = e.clientX - r.left;
        this.dragOffset.y = e.clientY - r.top;
        this.classList.add("dragging");
    }

    onMouseMove(e) {
        if (!this.dragging) return;
        this.moveTo(e.clientX - this.dragOffset.x, e.clientY - this.dragOffset.y);
    }

    onMouseUp() {
        if (!this.dragging) return;
        this.dragging = false;
        this.classList.remove("dragging");
        this.savePosition();
    }

    // Place the widget at viewport coordinates, clamped so it stays fully on screen.
    moveTo(clientX, clientY) {
        const parent = this.parentElement.getBoundingClientRect();
        const w = this.offsetWidth, h = this.offsetHeight;
        const x = clamp(clientX - parent.left, 0, Math.max(0, parent.width - w));
        const y = clamp(clientY - parent.top, 0, Math.max(0, parent.height - h));
        this.style.left = Math.round(x) + "px";
        this.style.top = Math.round(y) + "px";
        this.style.bottom = "auto";
    }

    // Stored as fractions of the parent so the position survives resolution changes.
    savePosition() {
        try {
            const parent = this.parentElement.getBoundingClientRect();
            const r = this.getBoundingClientRect();
            const pos = {
                fx: parent.width > 0 ? (r.left - parent.left) / parent.width : 0,
                fy: parent.height > 0 ? (r.top - parent.top) / parent.height : 0
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
        } catch (err) { /* storage unavailable */ }
    }

    restorePosition() {
        let pos = null;
        try { pos = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (err) { return; }
        if (!pos || typeof pos.fx !== "number" || typeof pos.fy !== "number") return;
        const parent = this.parentElement.getBoundingClientRect();
        this.moveTo(parent.left + pos.fx * parent.width, parent.top + pos.fy * parent.height);
    }
}

if (!customElements.get("ace-pedalgraph")) {
    customElements.define("ace-pedalgraph", PedalGraph);
    console.log("[PedalGraph] element registered");
}
