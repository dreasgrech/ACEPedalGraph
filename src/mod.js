/**
 * PedalGraph -- loader entry point.
 *
 * Loaded by the AceMods loader on hud.html after pedalgraph.js (order from mod.json).
 * The stylesheet is already linked by the loader. All this file does is give the
 * widget a root element inside the HUD's positioning container and start it.
 */
(function () {
    const CONTAINER_SELECTOR = ".absolutecenter";
    const log = window.AceMods ? AceMods.logger("[PedalGraph]") : function (m) { console.log("[PedalGraph] " + m); };

    const container = document.querySelector(CONTAINER_SELECTOR);

    if (!container) {
        log("no " + CONTAINER_SELECTOR + " on this page; not attaching");

        return;
    }

    if (document.getElementById(PedalGraph.ROOT_ID)) {
        log("root already present; not attaching twice");

        return;
    }

    const root = document.createElement("div");

    root.id = PedalGraph.ROOT_ID;
    container.appendChild(root);
    PedalGraph.attach(root);
}());
