/**
 * Cycloidal (pin-wheel) drive math core — mirrors the profile equation used
 * by the CycloidalGearGenerator Fusion 360 add-in bundled in this repo
 * (fusion360_addin/CycloidalGearGenerator/CycloidalGear.py), so the web
 * preview and the CAD add-in always agree:
 *
 *   ratio i -> pin count N = i + 1, lobes = N - 1
 *   psi = atan2( sin((1-N)t), R/(E*N) - cos((1-N)t) )
 *   x =  R cos t - Rr' cos(t+psi) - E cos(Nt)
 *   y = -R sin t + Rr' sin(t+psi) + E sin(Nt)
 *   where Rr' = Rr + disc_clearance (a larger effective roller radius
 *   shrinks the disc so it doesn't bind on the pins).
 *
 * All lengths in millimeters, angles in radians.
 */
(function (global) {
  "use strict";

  function computeProfile(R, Rr, E, N, numPoints, phase180, clearance) {
    clearance = clearance || 0;
    if (E === 0 || N === 0) return [];
    const RrEff = Rr + clearance;
    const inv = R / (E * N);
    const pts = [];
    for (let i = 0; i < numPoints; i++) {
      const a = (2 * Math.PI * i) / numPoints;
      const m = (1 - N) * a;
      const psi = Math.atan2(Math.sin(m), inv - Math.cos(m));
      const ap = a + psi;
      let x = R * Math.cos(a) - RrEff * Math.cos(ap) - E * Math.cos(N * a);
      let y = -R * Math.sin(a) + RrEff * Math.sin(ap) + E * Math.sin(N * a);
      if (phase180) {
        x = -x;
        y = -y;
      }
      pts.push({ x, y });
    }
    return pts;
  }

  const DEFAULTS = {
    ratio: 11,
    pinR: 30,
    rollerR: 3,
    ecc: 1.5,
    thickness: 5,
    points: 360,
    boreDia: 15,
    holeCount: 6,
    holePcdR: 18,
    holePinDia: 6,
    tolDisc: 0.1,
    tolBore: 0.05,
    tolHole: 0.1,
    tolPin: 0.0,
    pinLenMargin: 2,
    shaftDia: 11,
    journalDia: 14,
    gap: 1,
  };

  function deriveParams(input) {
    const ratio = input.ratio ?? DEFAULTS.ratio;
    const N = ratio + 1;
    const R = input.pinR ?? DEFAULTS.pinR;
    const Rr = input.rollerR ?? DEFAULTS.rollerR;
    const E = input.ecc ?? DEFAULTS.ecc;
    const thickness = input.thickness ?? DEFAULTS.thickness;
    const points = input.points ?? DEFAULTS.points;
    const boreDia = input.boreDia ?? DEFAULTS.boreDia;
    const holeCount = input.holeCount ?? DEFAULTS.holeCount;
    const holePcdR = input.holePcdR ?? DEFAULTS.holePcdR;
    const holePinDia = input.holePinDia ?? DEFAULTS.holePinDia;
    const tolDisc = input.tolDisc ?? DEFAULTS.tolDisc;
    const tolBore = input.tolBore ?? DEFAULTS.tolBore;
    const tolHole = input.tolHole ?? DEFAULTS.tolHole;
    const tolPin = input.tolPin ?? DEFAULTS.tolPin;
    const pinLenMargin = input.pinLenMargin ?? DEFAULTS.pinLenMargin;
    const makeBore = input.makeBore ?? true;
    const makeHoles = input.makeHoles ?? true;
    const twin = input.twin ?? false;
    const makeShaft = input.makeShaft ?? true;
    const makeRing = input.makeRing ?? true;
    const shaftDia = input.shaftDia ?? DEFAULTS.shaftDia;
    const journalDia = input.journalDia ?? DEFAULTS.journalDia;
    const gap = input.gap ?? DEFAULTS.gap;

    const warnings = [];
    if (E <= 0) warnings.push("편심량(E)이 0보다 커야 합니다.");
    if (Rr <= 0) warnings.push("핀/롤러 반지름이 0보다 커야 합니다.");
    if (2 * E >= 2 * Rr) {
      // rule of thumb: eccentricity should stay well under the roller radius
      warnings.push(
        "편심량(E)이 핀/롤러 반지름에 비해 큽니다 — 외곽선이 자기교차할 수 있습니다. E를 줄이거나 Rr을 늘려보세요."
      );
    }
    const pinPitch = (2 * Math.PI * R) / N;
    if (2 * (Rr + tolPin) >= pinPitch) {
      warnings.push("핀끼리 겹칩니다 — 핀 반지름을 줄이거나 핀 피치원 반지름(R)을 늘려주세요.");
    }

    return {
      ratio,
      N,
      lobes: N - 1,
      R,
      Rr,
      E,
      thickness,
      points,
      boreDia,
      holeCount,
      holePcdR,
      holePinDia,
      tolDisc,
      tolBore,
      tolHole,
      tolPin,
      pinLenMargin,
      makeBore,
      makeHoles,
      twin,
      makeShaft,
      makeRing,
      shaftDia,
      journalDia,
      gap,
      pinPitch,
      warnings,
      feasible: E > 0 && Rr > 0 && 2 * (Rr + tolPin) < pinPitch,
    };
  }

  // Mirrors CycloidalGear.py build_shaft(): shaft centered at origin, one
  // eccentric journal per disc (offset +E for disc 1, -E — i.e. phase180 —
  // for disc 2 of a twin stack).
  function shaftGeometry(p) {
    const shaftR = p.shaftDia / 2;
    const journalR = p.journalDia / 2;
    const journals = [{ x: p.E, y: 0, phase180: false }];
    if (p.twin) journals.push({ x: -p.E, y: 0, phase180: true });
    return { shaftR, journalR, journals };
  }

  function discOutline(p, phase180) {
    return computeProfile(p.R, p.Rr, p.E, p.N, p.points, !!phase180, p.tolDisc);
  }

  function pinCenters(p) {
    const pts = [];
    for (let k = 0; k < p.N; k++) {
      const ang = (2 * Math.PI * k) / p.N;
      pts.push({ x: p.R * Math.cos(ang), y: p.R * Math.sin(ang), r: p.Rr + p.tolPin });
    }
    return pts;
  }

  function outputHoleCenters(p) {
    const pts = [];
    const holeR = (p.holePinDia + 2 * p.E) / 2 + p.tolHole;
    for (let k = 0; k < p.holeCount; k++) {
      const ang = (2 * Math.PI * k) / p.holeCount;
      pts.push({ x: p.holePcdR * Math.cos(ang), y: p.holePcdR * Math.sin(ang), r: holeR });
    }
    return pts;
  }

  function circlePoints(r, cx, cy, nSeg) {
    cx = cx || 0;
    cy = cy || 0;
    nSeg = nSeg || 120;
    const pts = [];
    for (let i = 0; i <= nSeg; i++) {
      const a = (2 * Math.PI * i) / nSeg;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  const CycloMath = {
    DEFAULTS,
    computeProfile,
    deriveParams,
    discOutline,
    pinCenters,
    outputHoleCenters,
    shaftGeometry,
    circlePoints,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CycloMath;
  } else {
    global.CycloMath = CycloMath;
  }
})(typeof window !== "undefined" ? window : globalThis);
