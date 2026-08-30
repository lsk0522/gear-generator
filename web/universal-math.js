/**
 * Universal gear set math core — mirrors the 2D sketch geometry used by the
 * UniversalGearGenerator Fusion 360 add-in bundled in this repo
 * (fusion360_addin/UniversalGearGenerator/UniversalGearGenerator.py) before
 * it extrudes/lofts/sweeps those sketches into 3D. The web preview is
 * intentionally 2D-only, so it renders exactly the flat profiles the add-in
 * starts from — same tooth-count math, same simplified (non-involute)
 * tooth outline, same radii formulas.
 *
 * All lengths in millimeters, angles in radians.
 */
(function (global) {
  "use strict";

  const RIGHT_HAND = "우선 / Right Hand";
  const LEFT_HAND = "좌선 / Left Hand";

  const GEAR_TYPES = [
    "평기어 세트 (Spur Pair)",
    "헬리컬 기어 세트 (Helical Pair)",
    "내치 기어 세트 (Internal Gear Set)",
    "베벨 기어 세트 (Bevel Pair)",
    "웜 기어 세트 (Worm + Wheel)",
    "랙 피니언 세트 (Rack + Pinion)",
  ];

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function polar(r, a, cx, cy) {
    return { x: (cx || 0) + r * Math.cos(a), y: (cy || 0) + r * Math.sin(a) };
  }

  // Mirrors add_external_gear_outline(): 4 points/tooth (root, rising flank
  // tip, falling flank tip, root).
  function externalGearOutline(zTeeth, rootR, tipR, rotation, cx, cy) {
    zTeeth = Math.max(6, Math.round(zTeeth));
    rotation = rotation || 0;
    const pitch = (2 * Math.PI) / zTeeth;
    const pts = [];
    for (let i = 0; i < zTeeth; i++) {
      const a0 = rotation + i * pitch;
      pts.push(polar(rootR, a0 - pitch * 0.45, cx, cy));
      pts.push(polar(tipR, a0 - pitch * 0.18, cx, cy));
      pts.push(polar(tipR, a0 + pitch * 0.18, cx, cy));
      pts.push(polar(rootR, a0 + pitch * 0.45, cx, cy));
    }
    return pts;
  }

  // Mirrors add_internal_gear_profile(): outer circle loop + inward-facing
  // toothed inner loop (render/DXF as two separate closed loops).
  function internalGearProfile(zTeeth, innerRootR, innerTipR, outerR, rotation, nSegOuter) {
    zTeeth = Math.max(8, Math.round(zTeeth));
    rotation = rotation || 0;
    const pitch = (2 * Math.PI) / zTeeth;
    const outer = circlePoints(outerR, 0, 0, nSegOuter || 180);
    const inner = [];
    for (let i = 0; i < zTeeth; i++) {
      const a0 = rotation + i * pitch;
      inner.push(polar(innerRootR, a0 - pitch * 0.45));
      inner.push(polar(innerTipR, a0 - pitch * 0.18));
      inner.push(polar(innerTipR, a0 + pitch * 0.18));
      inner.push(polar(innerRootR, a0 + pitch * 0.45));
    }
    return { outer, inner };
  }

  // Mirrors add_rack_tooth(): one trapezoid per tooth.
  function rackToothPoints(xCenter, moduleMm, baseY, tipY) {
    const pitch = Math.PI * moduleMm;
    const topW = pitch * 0.42;
    const botW = pitch * 0.82;
    return [
      { x: xCenter - botW / 2, y: baseY },
      { x: xCenter - topW / 2, y: tipY },
      { x: xCenter + topW / 2, y: tipY },
      { x: xCenter + botW / 2, y: baseY },
    ];
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

  // Mirrors derive_teeth().
  function deriveTeeth(ratio, pinionTeeth, advanced, gearTeethValue, gearTypeIdx, wormStarts) {
    const pinion = Math.max(6, Math.round(pinionTeeth));
    if (gearTypeIdx === 4) {
      const starts = Math.max(1, Math.round(wormStarts));
      const wheel = Math.max(8, Math.round(ratio * starts));
      return [starts, wheel];
    }
    let gear;
    if (advanced && gearTeethValue > 0) gear = Math.max(6, Math.round(gearTeethValue));
    else gear = Math.max(6, Math.round(pinion * ratio));
    return [pinion, gear];
  }

  function pitchRootTip(moduleMm, z) {
    const pitchR = (moduleMm * z) / 2;
    const rootR = Math.max(moduleMm * 0.8, pitchR - 1.25 * moduleMm);
    const tipR = pitchR + moduleMm;
    return { pitchR, rootR, tipR };
  }

  const DEFAULTS = {
    gearIdx: 0,
    ratio: 3,
    module: 2,
    advanced: false,
    pinionTeeth: 20,
    gearTeeth: 0,
    pressureAngleDeg: 20,
    face: 16,
    hole: 5,
    helixAngleDeg: 20,
    hand: RIGHT_HAND,
    coneAngleDeg: 45,
    wormStarts: 1,
    wormPitchDia: 16,
  };

  // Mirrors collect_parameters() + build_*_pair()/build_*_set() dispatchers.
  // Returns one unified object; renderer picks the sub-object matching gearIdx.
  function deriveParams(input) {
    const gearIdx = input.gearIdx ?? DEFAULTS.gearIdx;
    const ratio = Math.max(1, input.ratio ?? DEFAULTS.ratio);
    const module = Math.max(0.01, input.module ?? DEFAULTS.module);
    const advanced = input.advanced ?? DEFAULTS.advanced;

    let pinionTeeth = input.pinionTeeth ?? DEFAULTS.pinionTeeth;
    let gearTeeth = input.gearTeeth ?? DEFAULTS.gearTeeth;
    let pressureAngle = (input.pressureAngleDeg ?? DEFAULTS.pressureAngleDeg) * (Math.PI / 180);
    let face = input.face ?? DEFAULTS.face;
    let hole = input.hole ?? DEFAULTS.hole;
    let helixAngle = Math.abs((input.helixAngleDeg ?? DEFAULTS.helixAngleDeg) * (Math.PI / 180));
    let hand = input.hand ?? DEFAULTS.hand;
    let coneAngle = Math.abs((input.coneAngleDeg ?? DEFAULTS.coneAngleDeg) * (Math.PI / 180));
    let wormStarts = input.wormStarts ?? DEFAULTS.wormStarts;
    let wormPitchDia = input.wormPitchDia ?? DEFAULTS.wormPitchDia;

    if (!advanced) {
      pinionTeeth = 20;
      gearTeeth = 0;
      pressureAngle = Math.PI / 9; // 20deg
      face = module * 8;
      hole = module * 2.5;
      helixAngle = Math.PI / 9;
      hand = RIGHT_HAND;
      coneAngle = Math.PI / 4;
      wormStarts = 1;
      wormPitchDia = module * 8;
    }

    face = Math.max(face, module * 2);
    helixAngle = clamp(helixAngle, (1 * Math.PI) / 180, (40 * Math.PI) / 180);
    coneAngle = clamp(coneAngle, (15 * Math.PI) / 180, (75 * Math.PI) / 180);

    const warnings = [];
    const out = {
      gearIdx,
      gearTypeName: GEAR_TYPES[gearIdx] || GEAR_TYPES[0],
      ratio,
      module,
      advanced,
      pinionTeeth,
      gearTeeth,
      pressureAngle,
      face,
      hole,
      helixAngle,
      hand,
      coneAngle,
      wormStarts,
      wormPitchDia,
      warnings,
    };

    if (gearIdx === 0) Object.assign(out, spurParams(out));
    else if (gearIdx === 1) Object.assign(out, helicalParams(out));
    else if (gearIdx === 2) Object.assign(out, internalParams(out));
    else if (gearIdx === 3) Object.assign(out, bevelParams(out));
    else if (gearIdx === 4) Object.assign(out, wormParams(out));
    else if (gearIdx === 5) Object.assign(out, rackParams(out));

    out.feasible = warnings.length === 0;
    return out;
  }

  function spurParams(p) {
    const [z1, z2] = deriveTeeth(p.ratio, p.pinionTeeth, p.advanced, p.gearTeeth, 0, p.wormStarts);
    const g1 = pitchRootTip(p.module, z1);
    const g2 = pitchRootTip(p.module, z2);
    // exact standard centre distance so the involute pair meshes
    const center = p.module * ((z1 + z2) / 2);
    return {
      z1,
      z2,
      drawModule: p.module,
      pitchR1: g1.pitchR,
      rootR1: g1.rootR,
      tipR1: g1.tipR,
      pitchR2: g2.pitchR,
      rootR2: g2.rootR,
      tipR2: g2.tipR,
      center,
      actualRatio: z2 / z1,
      summary: `${z1} : ${z2}  (실제비 ${(z2 / z1).toFixed(2)}:1)`,
    };
  }

  function twistAngle(faceMm, helixAngleRad, pitchRMm, hand) {
    let twist = (faceMm * Math.tan(Math.abs(helixAngleRad))) / Math.max(pitchRMm, 0.001);
    if (hand === LEFT_HAND) twist = -twist;
    return twist;
  }

  function helicalParams(p) {
    const [z1, z2] = deriveTeeth(p.ratio, p.pinionTeeth, p.advanced, p.gearTeeth, 1, p.wormStarts);
    const beta = p.helixAngle;
    // transverse module in the drawn (transverse) plane
    const mt = p.module / Math.cos(beta);
    const g1 = pitchRootTip(mt, z1);
    const g2 = pitchRootTip(mt, z2);
    const center = mt * ((z1 + z2) / 2);
    const opposite = p.hand === RIGHT_HAND ? LEFT_HAND : RIGHT_HAND;
    return {
      z1,
      z2,
      drawModule: mt,
      pitchR1: g1.pitchR,
      rootR1: g1.rootR,
      tipR1: g1.tipR,
      pitchR2: g2.pitchR,
      rootR2: g2.rootR,
      tipR2: g2.tipR,
      center,
      twist1: twistAngle(p.face, beta, g1.pitchR, p.hand),
      twist2: twistAngle(p.face, beta, g2.pitchR, opposite),
      actualRatio: z2 / z1,
      summary: `${z1} : ${z2}  (헬릭스각 ${((beta * 180) / Math.PI).toFixed(1)}°, ${p.hand}, 전단모듈 ${mt.toFixed(3)})`,
    };
  }

  function internalParams(p) {
    let [z1, z2] = deriveTeeth(p.ratio, p.pinionTeeth, p.advanced, p.gearTeeth, 2, p.wormStarts);
    if (z2 <= z1 + 4) z2 = z1 + Math.max(8, Math.round(z1 * 0.5));
    // exact internal centre distance = r_ring - r_pinion
    const offset = (p.module * (z2 - z1)) / 2;
    const ringPitchR = (p.module * z2) / 2;
    const innerRootR = ringPitchR + 1.25 * p.module;
    const innerTipR = Math.max(p.module, ringPitchR - p.module);
    const outerR = innerRootR + 3 * p.module;
    const pin = pitchRootTip(p.module, z1);
    return {
      z1,
      z2,
      drawModule: p.module,
      offset,
      innerRootR,
      innerTipR,
      outerR,
      pinionPitchR: pin.pitchR,
      pinionRootR: pin.rootR,
      pinionTipR: pin.tipR,
      summary: `피니언 ${z1}T / 링 ${z2}T`,
    };
  }

  function bevelParams(p) {
    const [z1, z2] = deriveTeeth(p.ratio, p.pinionTeeth, p.advanced, p.gearTeeth, 3, p.wormStarts);
    const offset = p.module * ((z1 + z2) / 2) + p.module * 2;
    const g1 = pitchRootTip(p.module, z1);
    const g2 = pitchRootTip(p.module, z2);
    const taper1 = clamp(p.face * Math.tan(p.coneAngle), p.module * 0.5, g1.pitchR * 0.65);
    const taper2 = clamp(p.face * Math.tan(p.coneAngle), p.module * 0.5, g2.pitchR * 0.65);
    const rootSmall1 = Math.max(p.module * 0.8, g1.rootR - taper1);
    const tipSmall1 = Math.max(rootSmall1 + p.module * 0.4, g1.tipR - taper1);
    const rootSmall2 = Math.max(p.module * 0.8, g2.rootR - taper2);
    const tipSmall2 = Math.max(rootSmall2 + p.module * 0.4, g2.tipR - taper2);
    return {
      z1,
      z2,
      offset,
      rootBig1: g1.rootR,
      tipBig1: g1.tipR,
      rootSmall1,
      tipSmall1,
      rootBig2: g2.rootR,
      tipBig2: g2.tipR,
      rootSmall2,
      tipSmall2,
      summary: `${z1} : ${z2}  (원추각 ${((p.coneAngle * 180) / Math.PI).toFixed(1)}°)`,
    };
  }

  function wormParams(p) {
    const [starts, wheelTeeth] = deriveTeeth(p.ratio, p.pinionTeeth, p.advanced, p.gearTeeth, 4, p.wormStarts);
    const wormD = p.wormPitchDia > 0 ? p.wormPitchDia : p.module * 8;
    const wormPitchR = wormD / 2;
    const wormRootR = Math.max(p.module * 0.8, wormPitchR - 0.8 * p.module);
    const wormOuterR = wormPitchR + 0.8 * p.module;
    const wheel = pitchRootTip(p.module, wheelTeeth);
    const wheelCenter = wormD / 2 + (p.module * wheelTeeth) / 2 + p.module * 1.2;
    const leadAngle = Math.max(
      Math.atan((Math.PI * p.module * starts) / Math.max(Math.PI * wormD, 0.001)),
      (8 * Math.PI) / 180
    );
    return {
      starts,
      wheelTeeth,
      wormPitchR,
      wormRootR,
      wormOuterR,
      wheelCenter,
      wheelPitchR: wheel.pitchR,
      wheelRootR: wheel.rootR,
      wheelTipR: wheel.tipR,
      leadAngle,
      wheelTwist: twistAngle(p.face, leadAngle, wheel.pitchR, p.hand),
      summary: `웜 ${starts}줄 / 웜휠 ${wheelTeeth}T  (감속비 ≈ ${(wheelTeeth / starts).toFixed(2)}:1)`,
    };
  }

  function rackParams(p) {
    const [z1, zRack] = deriveTeeth(p.ratio, p.pinionTeeth, p.advanced, p.gearTeeth, 5, p.wormStarts);
    const g1 = pitchRootTip(p.module, z1);
    // pinion pitch circle tangent to rack pitch line: centre at +r1 above it
    const pinionCenterY = g1.pitchR;
    const pitch = Math.PI * p.module;
    const rackLength = zRack * pitch;
    const rackTipY = 2.25 * p.module;
    const rackBarH = 2 * p.module;
    return {
      z1,
      zRack,
      drawModule: p.module,
      pitchR1: g1.pitchR,
      rootR1: g1.rootR,
      tipR1: g1.tipR,
      pinionCenterY,
      pitch,
      rackLength,
      rackTipY,
      rackBarH,
      summary: `피니언 ${z1}T / 랙 ${zRack}칸`,
    };
  }

  const UniMath = {
    RIGHT_HAND,
    LEFT_HAND,
    GEAR_TYPES,
    DEFAULTS,
    externalGearOutline,
    internalGearProfile,
    rackToothPoints,
    circlePoints,
    deriveTeeth,
    pitchRootTip,
    deriveParams,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = UniMath;
  } else {
    global.UniMath = UniMath;
  }
})(typeof window !== "undefined" ? window : globalThis);
