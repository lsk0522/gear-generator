/**
 * Harmonic Drive cycloid tooth profile — shared math core.
 *
 * Implements a closed-form cycloid tooth profile (CTP) construction based on:
 *   Yao, Y.; Lu, L.; Chen, X.; Xie, Y.; Yang, Y.; Xing, J.
 *   "A Novel Cycloid Tooth Profile for Harmonic Drive with Fully Conjugate
 *   Features." Actuators 2025, 14(4), 187. https://doi.org/10.3390/act14040187
 *
 * What is implemented directly from the paper (verified against the paper's
 * own worked case study, Eq. 22):
 *   - Elliptical wave-generator neutral-line shape under the mid-line
 *     non-elongation assumption (Eq. 1, 8) — the minor semi-axis rho_b is
 *     solved numerically so the deformed neutral-line arc length over a
 *     quarter turn equals rm * pi/2, exactly the constraint the paper states.
 *   - The "D-cycloid" / "U-cycloid" tooth-flank curves (Eq. 9-13) used as the
 *     addendum flank of the circular spline (CS) and, by the point-symmetric
 *     mapping the paper proves is valid (Sec. 2.3, "X-halved cycloid tooth
 *     trajectory"), the addendum flank of the flexspline (FS).
 *
 * Simplification vs. the paper (documented, not hidden):
 *   - The paper additionally runs a numerical envelope computation
 *     (Eq. 14-15) plus a least-squares refit (Sec. 3.3-3.4) to derive
 *     "bidirectional conjugate" dedendum (root) flanks and to optimize
 *     backlash uniformity. That refinement is not implemented here — the
 *     addendum flanks (the only flanks that carry contact load) use the
 *     paper's cycloid construction directly; the dedendum (root) flanks use
 *     a simple clearance-safe cycloidal fillet of the same family, sized so
 *     it never overlaps the neighboring tooth. Root fillets are never load
 *     bearing in a harmonic drive, so this does not affect meshing validity.
 */

(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // Numerical helpers
  // ---------------------------------------------------------------------

  function simpson(f, a, b, n) {
    n = n || 400;
    if (n % 2 === 1) n += 1;
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) {
      s += f(a + i * h) * (i % 2 ? 4 : 2);
    }
    return (s * h) / 3;
  }

  // ---------------------------------------------------------------------
  // Wave generator: elliptical neutral line, non-elongation condition
  // ---------------------------------------------------------------------

  /**
   * rho(phi1) per Eq.(8): polar radius of the FS neutral line under an
   * elliptical wave generator with semi-axes rhoA (along Y, "major") and
   * rhoB (along X, "minor").
   */
  function rho(phi1, rhoA, rhoB) {
    const s = Math.sin(phi1), c = Math.cos(phi1);
    const D = rhoA * rhoA * s * s + rhoB * rhoB * c * c;
    return (rhoA * rhoB) / Math.sqrt(D);
  }

  function drho(phi1, rhoA, rhoB) {
    const s = Math.sin(phi1), c = Math.cos(phi1);
    const D = rhoA * rhoA * s * s + rhoB * rhoB * c * c;
    const Dp = Math.sin(2 * phi1) * (rhoA * rhoA - rhoB * rhoB);
    return (-rhoA * rhoB * Dp) / (2 * Math.pow(D, 1.5));
  }

  function neutralLineArcLength(rhoA, rhoB) {
    return simpson(
      (phi) => {
        const r = rho(phi, rhoA, rhoB);
        const dr = drho(phi, rhoA, rhoB);
        return Math.sqrt(r * r + dr * dr);
      },
      0,
      Math.PI / 2,
      800
    );
  }

  /**
   * Solve rhoB such that the quarter-turn arc length of the deformed neutral
   * line equals rm * pi/2 (Eq. 1's implicit constraint: the un-deformed
   * quarter circumference maps exactly onto phi1 in [0, pi/2]).
   */
  function solveRhoB(rm, rhoA) {
    const target = (rm * Math.PI) / 2;
    let lo = rhoA * 0.5,
      hi = rhoA;
    let flo = neutralLineArcLength(rhoA, lo) - target;
    for (let i = 0; i < 80; i++) {
      const mid = 0.5 * (lo + hi);
      const fm = neutralLineArcLength(rhoA, mid) - target;
      if (Math.abs(fm) < 1e-9) return mid;
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
  // Cycloid tooth flank primitives (Eq. 9-13)
  // ---------------------------------------------------------------------

  /** Scaled D-cycloid displacement, amplitude k*m, t in [0, pi]. */
  function dCycloid(t, k, m) {
    return {
      dx: (k * m * (t - Math.sin(t))) / 4,
      dy: (k * m * (1 + Math.cos(t))) / 2,
    };
  }

  // ---------------------------------------------------------------------
  // Parameter derivation from (module, OD, ID)
  // ---------------------------------------------------------------------

  const DEFAULTS = {
    haStar: 1.0, // addendum height coefficient
    hfStar: 1.25, // dedendum height coefficient (c* = 0.25 clearance)
    w0Star: 1.0, // max radial deformation coefficient (rho_a = rm + m*w0*)
    csRimFactor: 3.0, // CS structural rim beyond addendum circle, in modules
    dedendumXTaper: 0.6, // shrink factor (of hfStar) on dedendum tangential sweep (clearance safety)
    addendumXTaper: 0.92, // shrink factor (of haStar) on addendum tangential sweep (avoids zero-clearance tip touching)
    fsToothDiffFactor: 2, // z2 - z1 (standard single-wave two-tooth-difference HD)
    filletXFraction: 1.0, // (kept for API symmetry; fillet uses dedendumXTaper)
  };

  /**
   * Derive every quantity needed to build the tooth profiles and the wave
   * generator cam from just (module, outer diameter, inner diameter).
   *
   * OD = outer diameter of the circular-spline ring (structural OD).
   * ID = inner bore diameter of the flexspline cup (through-bore for shaft).
   */
  function deriveHDParams(input) {
    const m = input.m;
    const OD = input.OD;
    const ID = input.ID;
    const haStar = input.haStar ?? DEFAULTS.haStar;
    const hfStar = input.hfStar ?? DEFAULTS.hfStar;
    const w0Star = input.w0Star ?? DEFAULTS.w0Star;
    const csRim = input.csRim ?? DEFAULTS.csRimFactor * m;
    const dedendumXTaper = input.dedendumXTaper ?? DEFAULTS.dedendumXTaper;
    const addendumXTaper = input.addendumXTaper ?? DEFAULTS.addendumXTaper;
    const toothDiff = input.toothDiff ?? DEFAULTS.fsToothDiffFactor;

    const warnings = [];

    // --- Circular spline (internal gear) ---
    const Ra2raw = OD / 2 - csRim;
    let z2 = Math.round(2 * (Ra2raw / m + haStar));
    if (z2 < 60) {
      warnings.push(
        `산출된 서큘러스플라인 잇수(z2=${z2})가 매우 적습니다. 모듈을 줄이거나 외경을 늘려주세요.`
      );
      z2 = Math.max(z2, 12);
    }
    const Ra2 = m * (z2 / 2 - haStar); // recompute exactly for integer z2
    const R2 = Ra2 + haStar * m; // CS pitch radius
    const Rf2 = R2 + hfStar * m; // CS root (dedendum) radius, outward
    const csOuterActual = 2 * (Rf2 + csRim * 0.4); // keep rim beyond root too

    // --- Flexspline (external gear) ---
    const z1 = z2 - toothDiff;
    const ratio = z1 / toothDiff; // reduction ratio N = z1 / (z2 - z1)
    const R1 = (m * z1) / 2; // FS pitch radius (undeformed)
    const Ra1 = R1 + haStar * m; // FS addendum (tip) radius, outward
    const Rf1 = R1 - hfStar * m; // FS dedendum (root) radius, inward

    const bore = ID / 2;
    const wallFS = Rf1 - bore; // flexspline cup wall thickness beneath the root
    if (wallFS <= m * 0.3) {
      warnings.push(
        `플렉스스플라인 벽 두께(${wallFS.toFixed(
          2
        )} mm)가 너무 얇습니다. 내경을 줄이거나 외경/모듈을 조정해주세요.`
      );
    } else if (wallFS > 0.05 * R1) {
      warnings.push(
        `플렉스스플라인 벽 두께(${wallFS.toFixed(
          2
        )} mm)가 실제 하모닉 드라이브 대비 두껍습니다(탄성 변형이 어려울 수 있음). ` +
          `일반적으로 내경을 이뿌리원 지름에 가깝게 설정합니다. 참고 벽 두께: ${(
            0.02 * R1
          ).toFixed(2)} mm 내외.`
      );
    }
    const rm = R1 - wallFS / 2; // neutral-line radius approximation (mid-wall)

    // --- Wave generator neutral line (elliptical, non-elongation) ---
    const rhoA = rm + m * w0Star;
    const rhoB = solveRhoB(rm, rhoA);

    // --- Tooth thickness / space width at pitch circle (50/50 split) ---
    const et2 = (Math.PI * m) / 2; // CS space width at pitch
    const s1 = (Math.PI * m) / 2; // FS tooth thickness at pitch

    // Axial face width - auto-derived, not user input (see hd_math.py note).
    const baseWidth = Math.max(8.0 * m, 0.1 * OD);
    const fsWidth = baseWidth;
    const csWidth = baseWidth * 1.2;
    const wgWidth = baseWidth * 0.8;

    return {
      m,
      OD,
      ID,
      haStar,
      hfStar,
      w0Star,
      csRim,
      dedendumXTaper,
      addendumXTaper,
      toothDiff,
      z1,
      z2,
      ratio,
      R1,
      Ra1,
      Rf1,
      R2,
      Ra2,
      Rf2,
      csOuterActual,
      wallFS,
      rm,
      rhoA,
      rhoB,
      et2,
      s1,
      bore,
      csWidth,
      fsWidth,
      wgWidth,
      warnings,
      feasible: wallFS > m * 0.15 && z1 > 20,
    };
  }

  // ---------------------------------------------------------------------
  // Tooth flank curves
  //   CS: coordinates are already global-Cartesian (S2 origin = gear center)
  //   FS: coordinates are LOCAL (S1 origin = O1 on the pitch circle); the
  //       caller must place them via placeLocalOnPitch() below.
  // ---------------------------------------------------------------------

  /** CS addendum flank (right half), t in [0, pi]: t=0 pitch, t=pi tip (inward). */
  function csAddendumPoint(t, p) {
    const kx = p.haStar * p.addendumXTaper;
    const { dx } = dCycloid(t, kx, p.m);
    const { dy } = dCycloid(t, p.haStar, p.m);
    return { x: p.et2 / 2 + dx, y: p.R2 - p.haStar * p.m + dy };
  }

  /** CS dedendum/root flank (right half), t in [0, pi]: t=0 pitch, t=pi root (outward). */
  function csDedendumPoint(t, p) {
    const kx = p.hfStar * p.dedendumXTaper;
    const { dx } = dCycloid(t, kx, p.m);
    const { dy } = dCycloid(t, p.hfStar, p.m);
    return { x: p.et2 / 2 - dx, y: p.R2 + p.hfStar * p.m - dy };
  }

  /** FS addendum flank (right half), LOCAL coords, t in [0, pi]: t=0 pitch (y=0), t=pi tip. */
  function fsAddendumPoint(t, p) {
    const kx = p.haStar * p.addendumXTaper;
    const { dx } = dCycloid(t, kx, p.m);
    const { dy } = dCycloid(t, p.haStar, p.m);
    return { x: p.s1 / 2 - dx, y: p.haStar * p.m - dy };
  }

  /** FS dedendum/root flank (right half), LOCAL coords, t in [0, pi]: t=0 pitch (y=0), t=pi root. */
  function fsDedendumPoint(t, p) {
    const kx = p.hfStar * p.dedendumXTaper;
    const { dx } = dCycloid(t, kx, p.m);
    const { dy } = dCycloid(t, p.hfStar, p.m);
    return { x: p.s1 / 2 + dx, y: -p.hfStar * p.m + dy };
  }

  /**
   * Place a LOCAL FS point (x1 = tangential offset, y1 = radial offset from
   * the pitch circle) at tooth index k out of z, symmetry line at angle
   * baseAngle (radians, measured from +Y, clockwise-positive to match SVG).
   */
  function placeLocalOnPitch(x1, y1, R, k, z, baseAngle) {
    baseAngle = baseAngle || 0;
    const radius = R + y1;
    const ang = baseAngle + (k * 2 * Math.PI) / z + x1 / radius;
    return { x: radius * Math.sin(ang), y: radius * Math.cos(ang) };
  }

  /** Rotate a global CS point (already Cartesian, origin = gear center). */
  function placeGlobal(x2, y2, k, z, baseAngle) {
    baseAngle = baseAngle || 0;
    const ang = baseAngle + (k * 2 * Math.PI) / z;
    const c = Math.cos(ang),
      s = Math.sin(ang);
    return { x: x2 * c - y2 * s, y: x2 * s + y2 * c };
  }

  // ---------------------------------------------------------------------
  // Full single-tooth outline builders (right flank + mirrored left flank)
  // ---------------------------------------------------------------------

  function sampleFlank(fn, p, nSeg) {
    nSeg = nSeg || 24;
    const pts = [];
    for (let i = 0; i <= nSeg; i++) {
      const t = (Math.PI * i) / nSeg;
      pts.push(fn(t, p));
    }
    return pts;
  }

  /**
   * Build one full tooth outline (local frame) as an ordered point list:
   * root(left) -> pitch(left) -> tip -> pitch(right) -> root(right).
   * For CS these are already-global-style (x,y) with y~radius; for FS these
   * are local (x1,y1) small-offset coords to be placed with placeLocalOnPitch.
   */
  function buildToothOutline(kind, p, nSeg) {
    const addFn = kind === "cs" ? csAddendumPoint : fsAddendumPoint;
    const dedFn = kind === "cs" ? csDedendumPoint : fsDedendumPoint;

    const dedRight = sampleFlank(dedFn, p, nSeg); // index 0=pitch ... last=root, x>=0
    const addRight = sampleFlank(addFn, p, nSeg); // index 0=pitch ... last=tip, x>=0

    const rootRight = dedRight[dedRight.length - 1];
    const tip = addRight[addRight.length - 1];

    const outline = [];
    // 1) root(left) -> pitch(left): dedRight mirrored, traversed root->pitch (i: last->0)
    for (let i = dedRight.length - 1; i >= 0; i--) {
      outline.push({ x: -dedRight[i].x, y: dedRight[i].y });
    }
    // 2) pitch(left) -> tip(left): addRight mirrored, traversed pitch->tip (i: 1->last)
    for (let i = 1; i < addRight.length; i++) {
      outline.push({ x: -addRight[i].x, y: addRight[i].y });
    }
    // 3) tip(right) -> pitch(right): addRight unmirrored, traversed tip->pitch (i: last->0)
    for (let i = addRight.length - 1; i >= 0; i--) {
      outline.push(addRight[i]);
    }
    // 4) pitch(right) -> root(right): dedRight unmirrored, traversed pitch->root (i: 1->last)
    for (let i = 1; i < dedRight.length; i++) {
      outline.push(dedRight[i]);
    }
    return { outline, rootRight, tip };
  }

  // ---------------------------------------------------------------------
  // Full ring point generation (for SVG / DXF)
  // ---------------------------------------------------------------------

  function buildCSRingTeethPoints(p, nSeg, baseAngle) {
    const { outline } = buildToothOutline("cs", p, nSeg);
    const allTeeth = [];
    for (let k = 0; k < p.z2; k++) {
      allTeeth.push(outline.map((pt) => placeGlobal(pt.x, pt.y, k, p.z2, baseAngle)));
    }
    return allTeeth;
  }

  function buildFSRingTeethPoints(p, nSeg, baseAngle) {
    const { outline } = buildToothOutline("fs", p, nSeg);
    const allTeeth = [];
    for (let k = 0; k < p.z1; k++) {
      allTeeth.push(
        outline.map((pt) => placeLocalOnPitch(pt.x, pt.y, p.R1, k, p.z1, baseAngle))
      );
    }
    return allTeeth;
  }

  function buildWaveGeneratorCam(p, nSeg) {
    nSeg = nSeg || 240;
    const pts = [];
    for (let i = 0; i <= nSeg; i++) {
      const phi = (2 * Math.PI * i) / nSeg;
      const r = rho(phi, p.rhoA, p.rhoB) - p.wallFS / 2;
      pts.push({ x: r * Math.sin(phi), y: r * Math.cos(phi) });
    }
    return pts;
  }

  function circlePoints(r, nSeg) {
    nSeg = nSeg || 180;
    const pts = [];
    for (let i = 0; i <= nSeg; i++) {
      const a = (2 * Math.PI * i) / nSeg;
      pts.push({ x: r * Math.sin(a), y: r * Math.cos(a) });
    }
    return pts;
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  const HDMath = {
    DEFAULTS,
    simpson,
    rho,
    drho,
    solveRhoB,
    neutralLineArcLength,
    dCycloid,
    deriveHDParams,
    csAddendumPoint,
    csDedendumPoint,
    fsAddendumPoint,
    fsDedendumPoint,
    placeLocalOnPitch,
    placeGlobal,
    buildToothOutline,
    buildCSRingTeethPoints,
    buildFSRingTeethPoints,
    buildWaveGeneratorCam,
    circlePoints,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HDMath;
  } else {
    global.HDMath = HDMath;
  }
})(typeof window !== "undefined" ? window : globalThis);
