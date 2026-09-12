/**
 * Harmonic Drive cycloid tooth profile — shared math core (rev 2).
 *
 * Implements the fully-conjugate cycloid tooth profile (CTP) of:
 *   Yao, Y.; Lu, L.; Chen, X.; Xie, Y.; Yang, Y.; Xing, J.
 *   "A Novel Cycloid Tooth Profile for Harmonic Drive with Fully Conjugate
 *   Features." Actuators 2025, 14(4), 187. https://doi.org/10.3390/act14040187
 *
 * This is a full rewrite over the first version of this file. The first
 * version used the paper's closed-form D/U-cycloid equations (Eq. 11-13)
 * directly as an APPROXIMATION of the conjugate flank, with a hand-tuned
 * clearance-safe fillet standing in for the dedendum. This version instead
 * runs the actual construction the paper (and Sec. 3.2-3.4 in particular)
 * describes:
 *
 *   - the flexspline addendum flank is the tooth-angle-truncated x-halved
 *     cycloid of Eq. (11), truncated at parameter tE where the joint tangent
 *     angle equals alpha0 (Sec. 3.3) instead of running to the pitch-line
 *     cusp at t=0;
 *   - the dedendum flank is that SAME curve rotated 180 degrees about the
 *     pitch point (Eq. 12's point symmetry), not a separately-tuned fillet;
 *   - the circular-spline tooth space is computed as the actual numerical
 *     ENVELOPE (Eq. 14-15) of the flexspline tooth swept through one full
 *     wave-generator engagement — implemented here as a max-radius
 *     rasterization over angular bins, which sidesteps solving the envelope
 *     condition in closed form and is what makes "fully conjugate" true
 *     rather than approximate;
 *   - the elliptical wave-generator neutral line (Eq. 8) uses the paper's
 *     own closed form for the minor semi-axis b (via the mid-line
 *     inextensibility condition), not the arc-length bisection the first
 *     version of this file used (both agree to float precision - the
 *     bisection was a correct but slower way to the same answer).
 *
 * Deliberately out of scope: the S-tooth (double circular arc) alternative
 * profile, pancake-style dual output spline, and backlash/strain/mesh
 * performance metrics are additional features some other CTP tools built on
 * this same paper offer; only the cup-style cycloid path is implemented
 * here.
 */

(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // Small numeric helpers
  // ---------------------------------------------------------------------

  function bisect(f, lo, hi, iters) {
    iters = iters || 60;
    let flo = f(lo);
    for (let i = 0; i < iters; i++) {
      const mid = 0.5 * (lo + hi);
      const fm = f(mid);
      if (fm > 0 === flo > 0) {
        lo = mid;
        flo = fm;
      } else {
        hi = mid;
      }
    }
    return 0.5 * (lo + hi);
  }

  // ---------------------------------------------------------------------
  // Derived geometry
  // ---------------------------------------------------------------------

  const DEFAULTS = {
    module: 1.25,
    zf: 100, // flexspline tooth count
    zc: 102, // circular spline tooth count
    w0Ratio: 1.0, // radial deflection / module (w0*)
    ha: 1.0, // addendum height to the tip apex, in modules
    hd: 1.0, // dedendum depth to the root circle, in modules
    toothAngle: 9.17, // deg — cycloid joint tooth angle alpha0 (paper's Table 2 case)
    toothThickness: 0.5, // fraction of circular pitch given to the tooth (<=0.5)
    rootFillet: 0.15, // module units — tangent fillet at the root land
    clearance: 0.05, // module units — backlash cut into the circular-spline slot
    wallFlex: 0.75, // mm — flexspline wall thickness under the root
    wallCirc: 3.0, // mm — circular-spline wall thickness behind the slot
  };

  /** Max cycloid tooth angle before the flank truncates to nothing. */
  function maxToothAngle(s0, ha) {
    return Math.atan(s0 / (2 * ha));
  }

  /** Joint parameter tE such that the truncated-cycloid flank's tangent
   * angle at the pitch line equals alpha0 (Sec. 3.3). Solved by bisection
   * on tan(alpha0) = s0*sin(t) / (ha*(pi - t + sin t)), monotonic in t. */
  function solveJointParam(s0, ha, alpha0) {
    if (!(alpha0 > 0)) return 0;
    const target = Math.tan(alpha0);
    return bisect((t) => s0 * Math.sin(t) / (ha * (Math.PI - t + Math.sin(t))) - target, 0, Math.PI);
  }

  function deriveGeometry(input) {
    const m = input.module ?? DEFAULTS.module;
    const zf = Math.round(input.zf ?? DEFAULTS.zf);
    const zc = Math.round(input.zc ?? DEFAULTS.zc);
    const w0Ratio = input.w0Ratio ?? DEFAULTS.w0Ratio;
    const haStar = input.ha ?? DEFAULTS.ha;
    const hdStar = input.hd ?? DEFAULTS.hd;
    const rootFilletStar = input.rootFillet ?? DEFAULTS.rootFillet;
    const clearanceStar = input.clearance ?? DEFAULTS.clearance;
    const toothThicknessFrac = Math.min(0.5, Math.max(1e-3, input.toothThickness ?? DEFAULTS.toothThickness));
    const wallFlex = input.wallFlex ?? DEFAULTS.wallFlex;
    const wallCirc = input.wallCirc ?? DEFAULTS.wallCirc;

    const rp = (m * zf) / 2; // flexspline pitch / neutral radius
    const w0 = w0Ratio * m; // radial deflection at the major axis

    // Elliptical neutral line (Eq. 8): a = major semi-axis, b from midline
    // inextensibility (closed form; equivalent to the arc-length integral
    // condition, verified against the paper's own worked example).
    const a = rp + w0;
    let b = (1 / 9) * (12 * rp - 7 * a + 4 * Math.sqrt(Math.max(0, a * (3 * rp - 2 * a))));
    if (!(b > 0)) b = 1e-6;

    const s0 = (toothThicknessFrac * Math.PI * m) / 2; // half tooth thickness at pitch
    const ha = haStar * m;
    const hd = hdStar * m;
    const rootFillet = rootFilletStar * m;
    const clearance = clearanceStar * m;

    let alpha0 = ((input.toothAngle ?? DEFAULTS.toothAngle) * Math.PI) / 180;
    alpha0 = Math.max(0, Math.min(alpha0, 0.98 * maxToothAngle(s0, ha)));
    const tE = solveJointParam(s0, ha, alpha0);

    const warnings = [];
    if (zc <= zf) warnings.push("서큘러스플라인 잇수(zc)는 플렉스스플라인 잇수(zf)보다 많아야 합니다.");
    const stroke = a - b;
    const strokeMargin = ha + hd + clearance - stroke;
    if (strokeMargin < 0) {
      warnings.push(
        "이 높이(ha+hd)로는 파형발생기 반경 스트로크를 다 감당하지 못합니다 — ha*/hd*를 늘리거나 w0*를 줄이세요."
      );
    }

    return {
      m,
      zf,
      zc,
      rp,
      rm: rp,
      w0,
      a,
      b,
      ha,
      hd,
      haStar,
      hdStar,
      s0,
      toothThickness: toothThicknessFrac,
      rootFillet,
      clearance,
      alpha0,
      tE,
      halfPitch: (Math.PI * m) / 2, // half circular pitch, arc length at rp
      wallFlex,
      wallCirc,
      stroke,
      strokeMargin,
      warnings,
      feasible: zc > zf && strokeMargin >= 0 && wallFlex > 0,
    };
  }

  // ---------------------------------------------------------------------
  // Wave-generator deformation (Eq. 4, 8)
  // ---------------------------------------------------------------------

  /** Radial displacement w, tangential displacement v and section deflection
   * mu of the deformed flexspline neutral line at angle psi from the major
   * axis. */
  function waveDeform(d, psi) {
    const { a, b } = d;
    const s = Math.sin(psi),
      c = Math.cos(psi);
    const D = a * a * s * s + b * b * c * c;
    const rho = (a * b) / Math.sqrt(D);
    const rhoP = (-a * b * (a * a - b * b) * Math.sin(2 * psi)) / (2 * Math.pow(D, 1.5));
    const mu = -Math.atan2(rhoP, rho);
    // First-order tangential displacement from midline inextensibility
    // (dv/dpsi = -w); higher-order terms are ~(w0/rm)^2 and dropped, matching
    // the paper's own approximation order.
    const v = (-d.w0 / 2) * Math.sin(2 * psi);
    return { rho, w: rho - d.rm, v, mu };
  }

  /** Rotate a tooth-local point (x tangential, y radial-from-pitch-line) into
   * a deformed cross-section with rotation mu, returning (tangential,
   * radial) offsets from that section's neutral point. The local frame
   * (x=tangential, y=radial) is left-handed w.r.t. (e_r, e_theta), so the
   * physical rotation applied here is +mu (not the textbook -mu) for the
   * tooth's own radial axis to end up along the deformed midline's outward
   * normal. */
  function rotateIntoSection(x, y, cosMu, sinMu) {
    return { t: x * cosMu + y * sinMu, r: -x * sinMu + y * cosMu };
  }

  /** Place a sectioned (tangential t, radial r) offset at body angle theta
   * and neutral radius R, in the polar convention (matches everywhere a
   * tooth point is placed: radius R+r, angle theta + t/(R+r)). */
  function polarPlace(R, theta, t, r) {
    const rad = R + r;
    const ang = theta + t / (rad || 1);
    return { x: rad * Math.cos(ang), y: rad * Math.sin(ang), rad, ang };
  }

  // ---------------------------------------------------------------------
  // Tooth flank curves
  // ---------------------------------------------------------------------

  /** Normalized x-halved cycloid (Eq. 11), truncated at t=tE and rescaled so
   * u=0 lands on the pitch point and u=1 on the crest (t=pi). Returns the
   * fractional (x, y) position in [0,1]x[0,1]. */
  function cycloidUnit(u, tE) {
    const t = tE + (Math.PI - tE) * u;
    const XE = tE - Math.sin(tE),
      cE = Math.cos(tE);
    return {
      fx: (t - Math.sin(t) - XE) / (Math.PI - XE),
      fy: (cE - Math.cos(t)) / (1 + cE),
    };
  }

  /** Addendum flank as a function of u in [0,1]: u=0 at the pitch point
   * (s0, 0), u=1 at the crest (0, ha). */
  function addendumFlank(d) {
    return (u) => {
      const c = cycloidUnit(u, d.tE);
      return { x: d.s0 * (1 - c.fx), y: d.ha * c.fy };
    };
  }

  /** Dedendum flank: the addendum flank rotated 180 degrees about the pitch
   * point (s0, 0) — Eq. (12)'s point symmetry — so (x,y) -> (2*s0 - x, -y).
   * The root crest this puts at x=2*s0 sets the root-land width: at the
   * default 50/50 tooth thickness that's exactly half the circular pitch,
   * so at full depth neighboring teeth meet with zero root land. */
  function dedendumFlank(addFn, s0) {
    return (u) => {
      const q = addFn(u);
      return { x: 2 * s0 - q.x, y: -q.y };
    };
  }

  // ---------------------------------------------------------------------
  // Arc-length-uniform sampling and tangent-fillet fitting
  // ---------------------------------------------------------------------

  function resampleByArcLength(fn, uEnd, n) {
    const M = 300;
    const pts = [];
    for (let i = 0; i <= M; i++) pts.push(fn((uEnd * i) / M));
    const cum = [0];
    for (let i = 1; i <= M; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    const total = cum[M];
    const out = [];
    let j = 0;
    for (let i = 0; i <= n; i++) {
      const target = (total * i) / n;
      while (j < M - 1 && cum[j + 1] < target) j++;
      const seg = cum[j + 1] - cum[j];
      const f = seg > 1e-15 ? (target - cum[j]) / seg : 0;
      out.push({
        x: pts[j].x + (pts[j + 1].x - pts[j].x) * Math.min(f, 1),
        y: pts[j].y + (pts[j + 1].y - pts[j].y) * Math.min(f, 1),
      });
    }
    out[n] = pts[M];
    return out;
  }

  function flankArcLength(fn, uEnd) {
    const M = 100;
    let L = 0,
      prev = fn(0);
    for (let i = 1; i <= M; i++) {
      const q = fn((uEnd * i) / M);
      L += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    return L;
  }

  /** Tangent fillet of radius rf where a flank (running pitch -> root, so
   * u=1 is deepest) meets the flat root land at y=-hd. Returns the fillet
   * centre and the flank parameter u at the tangency point, found by
   * bisecting for the u whose offset-by-rf point (toward the void) sits at
   * height -hd+rf. */
  function fitRootFillet(hd, flankFn, rf) {
    if (!(rf > 0)) return null;
    const target = -hd + rf;
    const h = 1e-5;
    function centreAt(u) {
      const q = flankFn(u);
      const a = flankFn(Math.max(0, u - h)),
        b = flankFn(Math.min(1, u + h));
      const tx = b.x - a.x,
        ty = b.y - a.y;
      const L = Math.hypot(tx, ty) || 1;
      const nx = -ty / L,
        ny = tx / L; // normal toward the void
      return { x: q.x + rf * nx, y: q.y + rf * ny, px: q.x, py: q.y };
    }
    if (centreAt(0).y < target || centreAt(1).y > target) return null;
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 80; i++) {
      const mid = 0.5 * (lo + hi);
      if (centreAt(mid).y > target) lo = mid;
      else hi = mid;
    }
    const u = 0.5 * (lo + hi);
    const c = centreAt(u);
    return { cx: c.x, cy: target, r: rf, u, px: c.px, py: c.py };
  }

  const geomCache = new Map();

  /** Solve the tooth's fixed shape (flank functions + root fillet) once per
   * distinct parameter set — the fillet fit is a nested bisection too
   * expensive to redo per sample call. */
  function toothGeometry(d) {
    const key = [d.m, d.ha, d.hd, d.rootFillet, d.tE, d.s0].join("|");
    if (geomCache.has(key)) return geomCache.get(key);

    const addFn = addendumFlank(d);
    const dedFn = dedendumFlank(addFn, d.s0);
    const hdEff = Math.min(d.hd, d.ha); // point-symmetric dedendum can't exceed ha
    const atFullDepth = hdEff > d.ha - 1e-9;
    const rf = atFullDepth ? 0 : Math.min(d.rootFillet, hdEff * 0.45);
    const fil = rf > 0 ? fitRootFillet(hdEff, dedFn, rf) : null;

    const g = { addFn, dedFn, hdEff, fil };
    if (geomCache.size > 128) geomCache.clear();
    geomCache.set(key, g);
    return g;
  }

  /** Radius of curvature of the addendum flank at its crest (u=1) — the
   * cycloid's crest is the flat end of Eq. (11) and is naturally round
   * rather than an input, unlike a capped profile. */
  function crestRadius(addFn) {
    const h = 1e-4;
    const p0 = addFn(1 - 2 * h),
      p1 = addFn(1 - h),
      p2 = addFn(1);
    const x1 = (p2.x - p0.x) / (2 * h),
      y1 = (p2.y - p0.y) / (2 * h);
    const x2 = (p2.x - 2 * p1.x + p0.x) / (h * h),
      y2 = (p2.y - 2 * p1.y + p0.y) / (h * h);
    const k = Math.abs(x1 * y2 - y1 * x2);
    return k > 1e-12 ? Math.pow(x1 * x1 + y1 * y1, 1.5) / k : Infinity;
  }

  /** One full tooth polyline, right-half mirrored to the left, in local
   * tooth coordinates (x tangential from the tooth axis, y radial from the
   * pitch line). `inflate` offsets the whole curve outward along its normal
   * (used to cut clearance into the conjugate spline slot). */
  function toothProfile(d, inflate, samplesPerFlank) {
    const n = Math.max(6, samplesPerFlank || 24);
    const g = toothGeometry(d);
    const { addFn, dedFn, fil, hdEff } = g;
    const uRoot = fil ? fil.u : 1;

    const Ld = flankArcLength(dedFn, uRoot),
      La = flankArcLength(addFn, 1);
    const nd = Math.max(3, Math.round((n * Ld) / (Ld + La)));
    const na = Math.max(3, n - nd);
    const ded = resampleByArcLength(dedFn, uRoot, nd);
    const arcStep = Math.PI / Math.max(8, n / 2);

    const filArc = [];
    if (fil) {
      const a0 = Math.atan2(fil.py - fil.cy, fil.px - fil.cx);
      const a1 = -Math.PI / 2;
      let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const nf = Math.max(4, Math.ceil(Math.abs(da) / arcStep));
      for (let i = 1; i <= nf; i++) {
        const aa = a0 + (da * i) / nf;
        filArc.push({ x: fil.cx + fil.r * Math.cos(aa), y: fil.cy + fil.r * Math.sin(aa) });
      }
    } else {
      filArc.push(dedFn(uRoot));
    }
    const add = resampleByArcLength(addFn, 1, na).slice(1);

    const right = [];
    for (let i = filArc.length - 1; i >= 0; i--) right.push(filArc[i]);
    for (let i = ded.length - 1; i >= 0; i--) right.push(ded[i]);
    for (let i = 0; i < add.length; i++) right.push(add[i]);

    // Left half is the mirror, minus the shared crest point; crest included once.
    const pts = [];
    for (let i = 0; i < right.length - 1; i++) pts.push({ x: -right[i].x, y: right[i].y });
    for (let i = right.length - 1; i >= 0; i--) pts.push({ x: right[i].x, y: right[i].y });

    return inflate ? offsetPolyline(pts, inflate) : pts;
  }

  function offsetPolyline(pts, dist) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      out.push({ x: pts[i].x - (dy / len) * dist, y: pts[i].y + (dx / len) * dist });
    }
    return out;
  }

  /** The tooth plus flat root land out to a full half flexspline pitch on
   * each side — this is what actually sweeps through a spline slot as the
   * wave generator turns, so the conjugate envelope has to be built from
   * this, not the bare tooth (otherwise the tooth tip can dig into the
   * root-land material at the major axis undetected). */
  function toothWithRootLand(d, inflate, samplesPerFlank) {
    const tooth = toothProfile(d, inflate, samplesPerFlank);
    const yRoot = -toothGeometry(d).hdEff + (inflate || 0);
    const xEnd = d.halfPitch;
    const xL = tooth[0].x,
      xR = tooth[tooth.length - 1].x;
    const nL = 10;
    const pts = [];
    if (xL + xEnd > 1e-9) {
      for (let i = 0; i < nL; i++) pts.push({ x: -xEnd + (xL + xEnd) * (i / nL), y: yRoot });
    }
    for (const p of tooth) pts.push(p);
    if (xEnd - xR > 1e-9) {
      for (let i = 1; i <= nL; i++) pts.push({ x: xR + (xEnd - xR) * (i / nL), y: yRoot });
    }
    return pts;
  }

  // ---------------------------------------------------------------------
  // Full-gear profile assembly
  // ---------------------------------------------------------------------

  /** Full undeformed (as-manufactured) flexspline outer profile: every
   * tooth plus the root land between them, one continuous closed CCW loop
   * in global mm coordinates, using the polar placement convention
   * (radius rp+y, angle theta + x/(rp+y)). */
  function flexsplineProfile(d, zf, samplesPerFlank) {
    const tooth = toothProfile(d, 0, samplesPerFlank || 48);
    const g = toothGeometry(d);
    const rootR = d.rp - g.hdEff;
    const pitchAngle = (2 * Math.PI) / zf;
    const outer = [];
    for (let k = 0; k < zf; k++) {
      const theta0 = k * pitchAngle;
      for (const pt of tooth) {
        const ang = theta0 + pt.x / d.rp;
        const r = d.rp + pt.y;
        outer.push({ x: r * Math.cos(ang), y: r * Math.sin(ang) });
      }
      const a0 = theta0 + tooth[tooth.length - 1].x / d.rp;
      const a1 = theta0 + pitchAngle + tooth[0].x / d.rp;
      const arcN = 10;
      if ((a1 - a0) * rootR > 1e-9) {
        for (let i = 1; i < arcN; i++) {
          const aa = a0 + (a1 - a0) * (i / arcN);
          outer.push({ x: rootR * Math.cos(aa), y: rootR * Math.sin(aa) });
        }
      }
    }
    return { outer, rootRadius: rootR, tipRadius: d.rp + d.ha };
  }

  /** Accumulate a Cartesian-interpolated (angle, radius) line segment into a
   * max-radius-per-angular-bin envelope. Anything crossing outside the
   * pitch window [-halfPitch, halfPitch] is periodic with this same slot, so
   * it is re-added shifted by whole pitches rather than discarded. */
  function rasterizeSegment(env, nBins, halfPitch, a0, r0, a1, r1) {
    if (a0 > a1) {
      [a0, a1] = [a1, a0];
      [r0, r1] = [r1, r0];
    }
    const pitch = 2 * halfPitch;
    const kLo = Math.floor((-halfPitch - a1) / pitch);
    const kHi = Math.ceil((halfPitch - a0) / pitch);
    for (let k = kLo; k <= kHi; k++) {
      rasterizeCore(env, nBins, halfPitch, a0 + k * pitch, r0, a1 + k * pitch, r1);
    }
  }

  function rasterizeCore(env, nBins, halfPitch, a0, r0, a1, r1) {
    if (a1 < -halfPitch || a0 > halfPitch) return;
    const binW = (2 * halfPitch) / nBins;
    const b0 = Math.max(0, Math.floor((a0 + halfPitch) / binW));
    const b1 = Math.min(nBins - 1, Math.floor((a1 + halfPitch) / binW));
    for (let b = b0; b <= b1; b++) {
      const ac = -halfPitch + (b + 0.5) * binW;
      let r;
      if (a1 - a0 < 1e-12) r = Math.max(r0, r1);
      else {
        const f = Math.max(0, Math.min(1, (ac - a0) / (a1 - a0)));
        r = r0 + f * (r1 - r0);
      }
      if (r > env[b]) env[b] = r;
    }
  }

  /**
   * The conjugate tooth-space envelope for a rigid spline with zs teeth
   * (Eq. 14-15's envelope, computed numerically): sweep the flexspline
   * tooth (with its root land) through one full wave-generator engagement
   * and record, per angular bin within one spline pitch, the MAXIMUM radius
   * the flexspline material ever reaches there. That maximum-radius curve
   * is exactly the boundary the rigid spline tooth space must clear to
   * never interfere while remaining "fully conjugate" (touching, not
   * gapping, wherever the flexspline actually sweeps).
   */
  function conjugateSlot(d, zs, zf, clearance, nBins) {
    nBins = nBins || 256;
    const pitch = (2 * Math.PI) / zs;
    const halfPitch = pitch / 2;
    const dz = zs - zf; // 0 would be a degenerate same-count case; CS always has dz>0 here
    const tooth = toothWithRootLand(d, clearance, 28);
    const env = new Float64Array(nBins);

    const steps = 500;
    const phiMax = Math.PI / 2 / (1 + dz / zf);
    for (let s = 0; s <= steps; s++) {
      const phi = -phiMax + (2 * phiMax * s) / steps;
      const thetaBody = (-phi * dz) / zf; // gear-ratio drift of the FS body
      const psi = thetaBody - phi; // angle from the WG major axis
      const def = waveDeform(d, psi);
      const theta = thetaBody + def.v / d.rm;
      const R = def.rho;
      const cosM = Math.cos(def.mu),
        sinM = Math.sin(def.mu);

      let prevA = null,
        prevR = null;
      for (const pt of tooth) {
        const sec = rotateIntoSection(pt.x, pt.y, cosM, sinM);
        const pl = polarPlace(R, theta, sec.t, sec.r);
        if (prevA !== null) rasterizeSegment(env, nBins, halfPitch, prevA, prevR, pl.ang, pl.rad);
        prevA = pl.ang;
        prevR = pl.rad;
      }
    }

    // The kinematics are symmetric about the major axis; enforce it exactly.
    for (let j = 0; j < nBins / 2; j++) {
      const mj = nBins - 1 - j;
      const mx = Math.max(env[j], env[mj]);
      env[j] = mx;
      env[mj] = mx;
    }

    // Floor: angular bins the flexspline never sweeps (near the minor axis)
    // must still clear the flexspline tip there. Blended with a smooth max
    // so the crest meets the swept flanks without a sharp cusp; the blend
    // only ever adds clearance, never removes any.
    const rFloor = waveDeform(d, Math.PI / 2).rho + d.ha + clearance;
    const blend = Math.max(clearance, 0.02 * d.m);
    for (let k = 0; k < nBins; k++) {
      const e = env[k] - rFloor;
      env[k] = rFloor + 0.5 * (e + Math.sqrt(e * e + blend * blend));
    }

    return { radii: env, halfPitch, nBins };
  }

  /** Full internal-spline profile (one continuous closed loop, all zs teeth
   * spaces), built from the conjugate envelope. */
  function splineProfile(d, zs, zf, wall, clearance) {
    const slot = conjugateSlot(d, zs, zf, clearance);
    const inner = [];
    let maxR = 0;
    const pitch = (2 * Math.PI) / zs;
    for (let k = 0; k < zs; k++) {
      const base = k * pitch;
      for (let b = 0; b < slot.nBins; b++) {
        const ang = base - slot.halfPitch + (b + 0.5) * ((2 * slot.halfPitch) / slot.nBins);
        const r = slot.radii[b];
        if (r > maxR) maxR = r;
        inner.push({ x: r * Math.cos(ang), y: r * Math.sin(ang) });
      }
    }
    return { inner, outerRadius: maxR + wall, slotBottomRadius: maxR };
  }

  // ---------------------------------------------------------------------
  // Wave generator cam (for the 3D solid, unchanged model from rev 1)
  // ---------------------------------------------------------------------

  function waveGeneratorCam(d, nSeg) {
    nSeg = nSeg || 240;
    const pts = [];
    for (let i = 0; i <= nSeg; i++) {
      const phi = (2 * Math.PI * i) / nSeg;
      const def = waveDeform(d, phi);
      const r = def.rho - d.wallFlex / 2;
      pts.push({ x: r * Math.sin(phi), y: r * Math.cos(phi) });
    }
    return pts;
  }

  function circlePoints(r, cx, cy, nSeg) {
    cx = cx || 0;
    cy = cy || 0;
    nSeg = nSeg || 180;
    const pts = [];
    for (let i = 0; i <= nSeg; i++) {
      const a = (2 * Math.PI * i) / nSeg;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  // ---------------------------------------------------------------------
  // Backlash measurement
  // ---------------------------------------------------------------------

  /** Geometric backlash (mm, at the pitch radius) for the fully-engaged
   * tooth at the major axis: hold the wave generator fixed and find the
   * angular span the rigid spline can rotate through before either flank of
   * that tooth contacts the slot envelope. */
  function measureBacklash(d, zs, zf, clearance) {
    const slot = conjugateSlot(d, zs, zf, clearance, 1024);
    const env = slot.radii,
      nBins = slot.nBins;
    const hp = slot.halfPitch,
      binW = (2 * hp) / nBins,
      csPitch = 2 * hp;
    const tooth = toothProfile(d, 0, 28);

    function envAt(ang) {
      const f = (ang + hp) / binW - 0.5;
      const i0 = Math.floor(f),
        t = f - i0;
      const lo = i0 < 0 ? 0 : i0 >= nBins ? nBins - 1 : i0;
      const hi = i0 + 1 < 0 ? 0 : i0 + 1 >= nBins ? nBins - 1 : i0 + 1;
      return env[lo] + (env[hi] - env[lo]) * t;
    }

    const def = waveDeform(d, 0),
      R = def.rho;
    const cosM = Math.cos(def.mu),
      sinM = Math.sin(def.mu);
    const ang = [],
      rad = [];
    for (const pt of tooth) {
      const sec = rotateIntoSection(pt.x, pt.y, cosM, sinM);
      const pl = polarPlace(R, 0, sec.t, sec.r);
      ang.push(pl.ang);
      rad.push(pl.rad);
    }

    function minGap(phi) {
      let g = Infinity;
      for (let j = 0; j < ang.length; j++) {
        let m = (ang[j] - phi) % csPitch;
        if (m > hp) m -= csPitch;
        else if (m < -hp) m += csPitch;
        const gg = envAt(m) - rad[j];
        if (gg < g) g = gg;
      }
      return g;
    }

    const nScan = 160,
      dphi = (2 * hp) / nScan;
    let best = -Infinity,
      bestI = 0;
    const gs = new Float64Array(nScan + 1);
    for (let s = 0; s <= nScan; s++) {
      gs[s] = minGap(-hp + s * dphi);
      if (gs[s] > best) {
        best = gs[s];
        bestI = s;
      }
    }
    if (best <= 0) return 0;

    function wall(dir) {
      let s2 = bestI;
      while (s2 + dir >= 0 && s2 + dir <= nScan && gs[s2 + dir] > 0) s2 += dir;
      let inPhi = -hp + s2 * dphi;
      const outPhi = inPhi + dir * dphi;
      if (s2 + dir < 0 || s2 + dir > nScan) return inPhi;
      let lo = inPhi,
        hi = outPhi;
      for (let it = 0; it < 22; it++) {
        const mid = 0.5 * (lo + hi);
        if (minGap(mid) > 0) lo = mid;
        else hi = mid;
      }
      return lo;
    }
    return (wall(1) - wall(-1)) * d.rp;
  }

  // ---------------------------------------------------------------------
  // Top-level API
  // ---------------------------------------------------------------------

  function generate(input) {
    const d = deriveGeometry(input);
    const flex = flexsplineProfile(d, d.zf);
    const circ = splineProfile(d, d.zc, d.zf, d.wallCirc, d.clearance);
    return { d, flex, circ };
  }

  function computeMetrics(input, gen) {
    const d = gen ? gen.d : deriveGeometry(input);
    const parts = gen || generate(input);
    const pitchDia = d.m * d.zf;
    const outerDia = 2 * parts.circ.outerRadius;
    const ratio = Math.abs(d.zf / (d.zc - d.zf));

    const psiC = 0.5 * Math.acos(0.9); // angle where w(psi) = 0.9*w0
    const teethMesh = Math.round((d.zf * (2 * psiC)) / Math.PI);

    const backlash = measureBacklash(d, d.zc, d.zf, d.clearance);
    const fsStrainPct = ((d.wallFlex / 2) * (3 * d.w0)) / (d.rm * d.rm) * 100;

    const g = toothGeometry(d);
    const tipR = crestRadius(g.addFn);
    const tp = toothProfile(d, 0, 28);
    const rootLand = Math.max(0, 2 * d.halfPitch - (tp[tp.length - 1].x - tp[0].x));

    return {
      ratio,
      pitchDia,
      outerDia,
      w0: d.w0,
      deflPct: (d.w0 / d.rm) * 100,
      teethMesh,
      teethPct: (100 * teethMesh) / d.zf,
      backlash,
      fsStrainPct,
      toothHeight: d.ha + d.hd,
      tipRadius: tipR,
      toothThicknessMm: 2 * d.s0,
      circularPitch: 2 * d.halfPitch,
      rootLand,
      toothAngleDeg: (d.alpha0 * 180) / Math.PI,
      stroke: d.stroke,
      strokeMargin: d.strokeMargin,
    };
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  const HDMath = {
    DEFAULTS,
    deriveGeometry,
    waveDeform,
    toothProfile,
    toothWithRootLand,
    flexsplineProfile,
    conjugateSlot,
    splineProfile,
    measureBacklash,
    generate,
    computeMetrics,
    waveGeneratorCam,
    circlePoints,
    maxToothAngle,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HDMath;
  } else {
    global.HDMath = HDMath;
  }
})(typeof window !== "undefined" ? window : globalThis);
