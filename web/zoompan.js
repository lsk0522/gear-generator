/**
 * Lightweight zoom / pan for every preview SVG. Works by transforming the
 * <svg> element itself (CSS transform), so it survives the frequent inner
 * re-renders and animation without any cooperation from the render code.
 *   • wheel        → zoom toward the cursor
 *   • drag         → pan
 *   • double-click → reset
 */
(function () {
  "use strict";

  function attach(svg) {
    let scale = 1,
      tx = 0,
      ty = 0,
      dragging = false,
      startX = 0,
      startY = 0;

    function apply() {
      svg.style.transformOrigin = "center center";
      svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    }

    svg.style.cursor = "grab";
    svg.style.touchAction = "none";

    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newScale = Math.min(10, Math.max(0.4, scale * f));
        const k = newScale / scale;
        // keep the point under the cursor roughly fixed
        tx = cx - (cx - tx) * k;
        ty = cy - (cy - ty) * k;
        scale = newScale;
        apply();
      },
      { passive: false }
    );

    svg.addEventListener("pointerdown", (e) => {
      dragging = true;
      startX = e.clientX - tx;
      startY = e.clientY - ty;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (_) {}
      svg.style.cursor = "grabbing";
    });
    svg.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      tx = e.clientX - startX;
      ty = e.clientY - startY;
      apply();
    });
    function end() {
      dragging = false;
      svg.style.cursor = "grab";
    }
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("dblclick", (e) => {
      e.preventDefault();
      scale = 1;
      tx = 0;
      ty = 0;
      apply();
    });
  }

  function init() {
    [
      "#svg-main",
      "#svg-detail",
      "#cy-svg-main",
      "#cy-svg-detail",
      "#un-svg-main",
      "#un-svg-detail",
      "#pl-svg-main",
      "#pl-svg-detail",
    ].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) attach(el);
    });
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
