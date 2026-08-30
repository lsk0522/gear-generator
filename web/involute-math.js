/**
 * True involute gear geometry — replaces the simplified straight-flank
 * "4 points per tooth" approximation with standard full-depth involute
 * profiles so that a meshing pair actually rolls without interference
 * (like geargenerator.com). Web-only; the Fusion add-in keeps its own math.
 *
 * Standard 20° full-depth system:
 *   pitch radius   r  = m*z/2
 *   base radius    rb = r*cos(alpha)
 *   addendum       ha = ha*·m           (ha* = 1)
 *   dedendum       hf = hf*·m           (hf* = 1.25)
 *   tip radius     ra = r + ha
 *   root radius    rf = r - hf
 *   tooth thickness at pitch circle = p/2 = π·m/2  → angular = π/z
 *
 * All lengths in mm, angles in rad. Points are {x, y}.
 */
(function (global) {
  "use strict";

  function inv(a) {
    return Math.tan(a) - a;
  }

  function polar(R, ang, cx, cy) {
    return { x: (cx || 0) + R * Math.cos(ang), y: (cy || 0) + R * Math.sin(ang) };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /**
   * One external involute gear as a single closed loop of {x,y} points.
   * opts: { alpha (rad, default 20°), ha (default 1), hf (default 1.25),
   *         flankSteps (default 14), rootSteps (default 4), tipSteps (default 4) }
   */
  function involuteGear(z, m, rotation, cx, cy, opts) {
    z = Math.max(4, Math.round(z));
    opts = opts || {};
    const alpha = opts.alpha != null ? opts.alpha : (20 * Math.PI) / 180;
    const ha = opts.ha != null ? opts.ha : 1.0;
    const hf = opts.hf != null ? opts.hf : 1.25;
    const flankSteps = opts.flankSteps || 22;
    const rootSteps = opts.rootSteps || 4;
    const tipSteps = opts.tipSteps || 4;
    // small circumferential backlash (mm at pitch) so meshing flanks clear
    const backlash = opts.backlash != null ? opts.backlash : 0.05 * m;
    rotation = rotation || 0;

    const r = (m * z) / 2;
    const rb = r * Math.cos(alpha);
    const ra = r + ha * m;
    let rf = r - hf * m;
    rf = Math.max(rf, m * 0.1);

    // half tooth angle at pitch circle, reduced by half the backlash per flank
    const psi = Math.PI / (2 * z) - backlash / 2 / r;
    const invA = inv(alpha);
    // Involute begins at the base circle; if the root is below the base
    // circle we drop a radial line from base down to root, otherwise the
    // usable flank starts at the root radius.
    const rStart = Math.max(rb, rf);

    // half-angle of the flank offset at radius R (0 at pitch-side reference)
    function flankOffset(R) {
      const aR = Math.acos(clamp(rb / R, -1, 1));
      return psi + invA - inv(aR); // + = one side; tooth spans [-off,+off]
    }

    const toothPitch = (2 * Math.PI) / z;
    const pts = [];

    for (let k = 0; k < z; k++) {
      const base = rotation + k * toothPitch;

      // ----- right flank: root -> tip (offset negative side) -----
      if (rf < rb) {
        // radial segment from root up to base circle at the base-circle offset
        const offBase = flankOffset(rb);
        pts.push(polar(rf, base - offBase, cx, cy));
      }
      for (let i = 0; i <= flankSteps; i++) {
        const R = rStart + ((ra - rStart) * i) / flankSteps;
        pts.push(polar(R, base - flankOffset(R), cx, cy));
      }

      // ----- tip arc: right tip -> left tip -----
      const offTip = flankOffset(ra);
      for (let i = 1; i < tipSteps; i++) {
        const ang = base - offTip + ((2 * offTip) * i) / tipSteps;
        pts.push(polar(ra, ang, cx, cy));
      }

      // ----- left flank: tip -> root (offset positive side) -----
      for (let i = 0; i <= flankSteps; i++) {
        const R = ra - ((ra - rStart) * i) / flankSteps;
        pts.push(polar(R, base + flankOffset(R), cx, cy));
      }
      if (rf < rb) {
        const offBase = flankOffset(rb);
        pts.push(polar(rf, base + offBase, cx, cy));
      }

      // ----- root land: this tooth's left root -> next tooth's right root -----
      const offRoot = rf < rb ? flankOffset(rb) : flankOffset(rf);
      const rootStartAng = base + offRoot;
      const rootEndAng = base + toothPitch - offRoot;
      for (let i = 1; i < rootSteps; i++) {
        const ang = rootStartAng + ((rootEndAng - rootStartAng) * i) / rootSteps;
        pts.push(polar(rf, ang, cx, cy));
      }
    }

    return pts;
  }

  /**
   * Internal (ring) gear inner toothed boundary as a single closed loop.
   * The teeth point inward: tip radius is SMALLER than pitch, root LARGER.
   * Uses the conjugate involute space so a standard external pinion of the
   * same module meshes. Returned loop is the inner hole boundary; pair it
   * with an outer circle and even-odd fill.
   */
  function involuteRing(z, m, rotation, cx, cy, opts) {
    z = Math.max(8, Math.round(z));
    opts = opts || {};
    const alpha = opts.alpha != null ? opts.alpha : (20 * Math.PI) / 180;
    const ha = opts.ha != null ? opts.ha : 1.0;
    const hf = opts.hf != null ? opts.hf : 1.25;
    const flankSteps = opts.flankSteps || 14;
    const rootSteps = opts.rootSteps || 4;
    const tipSteps = opts.tipSteps || 4;
    rotation = rotation || 0;

    const r = (m * z) / 2;
    const rb = r * Math.cos(alpha);
    // internal: addendum toward centre (smaller), dedendum outward (larger)
    const ra = r - ha * m; // tip (innermost)
    const rf = r + hf * m; // root (outermost of the tooth space)
    const rInnerFlank = Math.max(rb, ra);

    const psi = Math.PI / (2 * z);
    const invA = inv(alpha);

    function flankOffset(R) {
      const aR = Math.acos(clamp(rb / Math.max(R, rb), -1, 1));
      return psi + invA - inv(aR);
    }

    const toothPitch = (2 * Math.PI) / z;
    const pts = [];

    for (let k = 0; k < z; k++) {
      const base = rotation + k * toothPitch;

      // land at root radius (outermost) between tooth k-1 and k
      const offRoot = flankOffset(rf);
      const landStart = base - toothPitch + offRoot;
      const landEnd = base - offRoot;
      for (let i = 1; i < rootSteps; i++) {
        const ang = landStart + ((landEnd - landStart) * i) / rootSteps;
        pts.push(polar(rf, ang, cx, cy));
      }

      // right flank: root(large R) -> tip(small R), negative side
      for (let i = 0; i <= flankSteps; i++) {
        const R = rf - ((rf - rInnerFlank) * i) / flankSteps;
        pts.push(polar(R, base - flankOffset(R), cx, cy));
      }
      // tip arc across (innermost)
      const offTip = flankOffset(rInnerFlank);
      for (let i = 1; i < tipSteps; i++) {
        const ang = base - offTip + ((2 * offTip) * i) / tipSteps;
        pts.push(polar(ra, ang, cx, cy));
      }
      // left flank: tip -> root, positive side
      for (let i = 0; i <= flankSteps; i++) {
        const R = rInnerFlank + ((rf - rInnerFlank) * i) / flankSteps;
        pts.push(polar(R, base + flankOffset(R), cx, cy));
      }
    }
    return pts;
  }

  /**
   * Involute rack: straight-flanked teeth whose flank angle equals the
   * pressure angle (an involute of an infinite-radius gear). Meshes with a
   * pinion of the same module. Pitch line at y = pitchLineY; teeth point +y.
   * xShift lets the rack translate as the pinion rotates.
   * Returns { teeth: [loop,...], bar: loop }.
   */
  function involuteRack(z, m, pitchLineY, xShift, xMin, xMax, opts) {
    opts = opts || {};
    const alpha = opts.alpha != null ? opts.alpha : (20 * Math.PI) / 180;
    const ha = opts.ha != null ? opts.ha : 1.0;
    const hf = opts.hf != null ? opts.hf : 1.25;
    const p = Math.PI * m;
    const ta = Math.tan(alpha);
    const halfAtPitch = p / 4;
    const tipY = pitchLineY + ha * m;
    const rootY = pitchLineY - hf * m;
    const halfTip = halfAtPitch - ha * m * ta;
    const halfRoot = halfAtPitch + hf * m * ta;

    const teeth = [];
    // center teeth around x=0, span enough to cover [xMin,xMax] after shift
    const nEachSide = Math.ceil((xMax - xMin) / p) + 2;
    for (let i = -nEachSide; i <= nEachSide; i++) {
      const xc = i * p + (xShift % p);
      if (xc < xMin - p || xc > xMax + p) continue;
      teeth.push([
        { x: xc - halfRoot, y: rootY },
        { x: xc - halfTip, y: tipY },
        { x: xc + halfTip, y: tipY },
        { x: xc + halfRoot, y: rootY },
      ]);
    }
    const bar = [
      { x: xMin, y: rootY },
      { x: xMax, y: rootY },
      { x: xMax, y: pitchLineY - hf * m - 2 * m },
      { x: xMin, y: pitchLineY - hf * m - 2 * m },
    ];
    return { teeth, bar, tipY, rootY };
  }

  function circlePoints(R, cx, cy, nSeg) {
    cx = cx || 0;
    cy = cy || 0;
    nSeg = nSeg || 120;
    const pts = [];
    for (let i = 0; i <= nSeg; i++) {
      const a = (2 * Math.PI * i) / nSeg;
      pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    }
    return pts;
  }

  const Involute = {
    inv,
    involuteGear,
    involuteRing,
    involuteRack,
    circlePoints,
    baseRadius: (z, m, alpha) => ((m * z) / 2) * Math.cos(alpha != null ? alpha : (20 * Math.PI) / 180),
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Involute;
  else global.Involute = Involute;
})(typeof window !== "undefined" ? window : globalThis);
