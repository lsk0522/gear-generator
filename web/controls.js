/**
 * Control enhancer — progressive, non-invasive.
 *
 * Wraps every `.field > input[type=number]` in a stepper composite and, for
 * primary fields that declare both min and max, adds a synced slider. The
 * ORIGINAL input element is kept and simply re-parented, so every listener
 * and cached reference the per-tab app scripts already hold keeps working;
 * the slider and steppers just write to it and dispatch a bubbling `input`
 * event, which is exactly what a user edit looks like to those scripts.
 *
 * Loaded last so it runs after each tab's app script has initialised.
 */
(function () {
  "use strict";

  const STEP_REPEAT_DELAY = 380; // ms before press-and-hold starts repeating
  const STEP_REPEAT_RATE = 55; // ms between repeats

  function decimals(step) {
    const s = String(step);
    const i = s.indexOf(".");
    return i < 0 ? 0 : s.length - i - 1;
  }

  function attrNum(el, name) {
    const v = parseFloat(el.getAttribute(name));
    return isFinite(v) ? v : null;
  }

  /** Paint a range's filled track via the --p custom property. */
  function paintRange(range) {
    const min = attrNum(range, "min") ?? 0;
    const max = attrNum(range, "max") ?? 100;
    const v = parseFloat(range.value);
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    range.style.setProperty("--p", Math.max(0, Math.min(100, pct)) + "%");
  }

  // ---------------------------------------------------------------------
  // Stepper composite
  // ---------------------------------------------------------------------

  function stepBy(input, dir) {
    const step = attrNum(input, "step") ?? 1;
    const min = attrNum(input, "min");
    const max = attrNum(input, "max");
    const cur = parseFloat(input.value);
    let next = (isFinite(cur) ? cur : min ?? 0) + dir * step;
    if (min !== null) next = Math.max(min, next);
    if (max !== null) next = Math.min(max, next);
    input.value = next.toFixed(decimals(step));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function makeStepper(input, dir, label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctl-step";
    btn.textContent = label;
    btn.tabIndex = -1; // the number input itself is the keyboard target
    btn.setAttribute("aria-hidden", "true");

    let holdTimer = null,
      repeatTimer = null;

    function stop() {
      clearTimeout(holdTimer);
      clearInterval(repeatTimer);
      holdTimer = repeatTimer = null;
    }

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stepBy(input, dir);
      holdTimer = setTimeout(() => {
        repeatTimer = setInterval(() => stepBy(input, dir), STEP_REPEAT_RATE);
      }, STEP_REPEAT_DELAY);
      btn.setPointerCapture?.(e.pointerId);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
      btn.addEventListener(ev, stop)
    );

    return btn;
  }

  /** Wheel-adjust, but only while the input is focused, so scrolling the
   * page over a form never changes a value by accident. */
  function enableWheel(input) {
    input.addEventListener(
      "wheel",
      (e) => {
        if (document.activeElement !== input) return;
        e.preventDefault();
        stepBy(input, e.deltaY < 0 ? 1 : -1);
      },
      { passive: false }
    );
  }

  function enhanceNumber(input) {
    const field = input.closest(".field");
    if (!field || input.dataset.enhanced) return;
    // Inputs already paired with their own slider (.slider-row) are left
    // alone - their tab's script owns the two-way sync between them.
    if (input.closest(".slider-row")) return;
    input.dataset.enhanced = "1";

    const ctl = document.createElement("div");
    ctl.className = "ctl";
    input.parentNode.insertBefore(ctl, input);
    ctl.appendChild(makeStepper(input, -1, "−"));
    ctl.appendChild(input);
    ctl.appendChild(makeStepper(input, +1, "+"));
    enableWheel(input);

    // A slider needs a bounded range, and only earns its vertical space on
    // the primary fields (the two-column advanced grids stay compact unless
    // a field opts in with data-slider).
    const min = attrNum(input, "min");
    const max = attrNum(input, "max");
    const wantsSlider =
      min !== null && max !== null && (!field.closest(".adv-grid") || input.dataset.slider);
    if (!wantsSlider) return;

    const range = document.createElement("input");
    range.type = "range";
    range.className = "ctl-range";
    range.min = min;
    range.max = max;
    range.step = input.getAttribute("step") || "any";
    range.value = input.value;
    range.tabIndex = -1;
    range.setAttribute("aria-hidden", "true");
    ctl.after(range);

    range.addEventListener("input", () => {
      input.value = range.value;
      paintRange(range);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    input.__range = range;
    paintRange(range);
  }

  /** Pull every composite slider back in line with its number input. Run
   * after app handlers, so values they set programmatically (e.g. the
   * harmonic tab deriving zc from the reduction ratio) stay in sync. */
  function syncComposites(root) {
    root.querySelectorAll('input[type="number"][data-enhanced]').forEach((input) => {
      const range = input.__range;
      if (!range) return;
      if (range.value !== input.value) {
        range.value = input.value;
        paintRange(range);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Standalone ranges (.slider-row) — app scripts drive these directly,
  // including per-frame during play, without dispatching events. Rather
  // than poll forever, the paint loop is kicked by interaction and stops
  // once values go quiet.
  // ---------------------------------------------------------------------

  function watchLooseRanges() {
    const ranges = [...document.querySelectorAll('input[type="range"]:not(.ctl-range)')];
    if (!ranges.length) return;
    ranges.forEach(paintRange);

    let running = false,
      quietFrames = 0;
    const last = new Map(ranges.map((r) => [r, r.value]));

    function frame() {
      let changed = false;
      for (const r of ranges) {
        if (last.get(r) !== r.value) {
          last.set(r, r.value);
          paintRange(r);
          changed = true;
        }
      }
      quietFrames = changed ? 0 : quietFrames + 1;
      if (quietFrames > 90) {
        running = false;
        return;
      }
      requestAnimationFrame(frame);
    }

    function kick() {
      quietFrames = 0;
      if (!running) {
        running = true;
        requestAnimationFrame(frame);
      }
    }

    ranges.forEach((r) => r.addEventListener("input", () => {
      paintRange(r);
      kick();
    }));
    // play/pause buttons animate the range on their own
    document.querySelectorAll("button.dl").forEach((b) => {
      if (/play/i.test(b.id)) b.addEventListener("click", kick);
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) kick();
    });
  }

  // ---------------------------------------------------------------------

  function addBrand() {
    const bar = document.querySelector(".tabbar");
    if (!bar || bar.querySelector(".brand")) return;
    const brand = document.createElement("div");
    brand.className = "brand";
    brand.innerHTML = "<b>기어 제너레이터</b><span>v1.0</span>";
    bar.prepend(brand);
  }

  // Light/dark switch. The inline script in <head> has already applied the
  // stored choice before first paint; this only builds the control and keeps
  // it in sync, so nothing here can cause a flash.
  function addThemeSwitch() {
    const bar = document.querySelector(".tabbar");
    if (!bar || bar.querySelector(".theme-switch")) return;

    const box = document.createElement("div");
    box.className = "theme-switch";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "테마");

    const modes = [
      { id: "light", glyph: "☀", label: "라이트 테마" },
      { id: "dark", glyph: "☾", label: "다크 테마" },
    ];

    const buttons = modes.map((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.mode = m.id;
      b.textContent = m.glyph;
      b.title = m.label;
      b.setAttribute("aria-label", m.label);
      b.addEventListener("click", () => apply(m.id, true));
      box.appendChild(b);
      return b;
    });

    function apply(mode, animate) {
      const root = document.documentElement;
      if (animate && root.dataset.theme !== mode) {
        root.classList.add("theme-animating");
        clearTimeout(apply._t);
        apply._t = setTimeout(() => root.classList.remove("theme-animating"), 320);
      }
      root.dataset.theme = mode;
      try {
        localStorage.setItem("gg-theme", mode);
      } catch (e) {
        /* private mode — the switch still works for this visit */
      }
      buttons.forEach((b) =>
        b.setAttribute("aria-pressed", b.dataset.mode === mode ? "true" : "false")
      );
    }

    apply(document.documentElement.dataset.theme === "dark" ? "dark" : "light", false);
    bar.appendChild(box);
  }

  function init() {
    addBrand();
    addThemeSwitch();
    document.querySelectorAll('.field input[type="number"]').forEach(enhanceNumber);
    document.querySelectorAll(".tabpanel").forEach((panel) => {
      // bubbling, so this runs after the app's own per-input handlers have
      // had their turn at the same event
      panel.addEventListener("input", () => syncComposites(panel));
    });
    watchLooseRanges();
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
