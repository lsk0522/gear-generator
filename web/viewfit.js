/**
 * Sticky view-fit helper.
 *
 * Every preview used to recompute scale + centre on *every* keystroke / slider
 * step so it always filled the panel. The side effect was that nudging a value
 * made the whole gear pulse bigger/smaller and slide sideways — it looked like
 * the drawing was "moving" on its own.
 *
 * ViewFit keeps the last fit and only re-fits when the geometry grows or shrinks
 * past a hysteresis band (or the centre jumps a lot). Small live edits therefore
 * update the teeth *in place* with a rock-steady view; large changes (or a gear
 * type switch, via reset()) still auto-fit.
 */
(function () {
  "use strict";

  function make() {
    return { ext: 0, midX: 0, midY: 0, scale: 0 };
  }

  // c        : cache from make()
  // W        : viewBox width (px)
  // frac     : fraction of half-width the geometry should span (e.g. 0.46)
  // idealExt : current geometry half-extent in world units
  // idealMidX/Y : desired centre in world units
  function fit(c, W, frac, idealExt, idealMidX, idealMidY) {
    idealMidX = idealMidX || 0;
    idealMidY = idealMidY || 0;
    const lo = 0.8,
      hi = 1.22;
    const refit =
      !c.ext ||
      idealExt < c.ext * lo ||
      idealExt > c.ext * hi ||
      Math.abs(idealMidX - c.midX) > c.ext * 0.14 ||
      Math.abs(idealMidY - c.midY) > c.ext * 0.14;
    if (refit) {
      c.ext = idealExt;
      c.midX = idealMidX;
      c.midY = idealMidY;
      c.scale = (W * frac) / idealExt;
    }
    return c;
  }

  function reset(c) {
    c.ext = 0;
  }

  window.ViewFit = { make, fit, reset };
})();
