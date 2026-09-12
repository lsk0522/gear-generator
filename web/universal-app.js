(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    type: $("#un-type"),
    ratio: $("#un-ratio"),
    ratioR: $("#un-ratio-r"),
    ratioVal: $("#un-ratio-val"),
    module: $("#un-module"),
    moduleR: $("#un-module-r"),
    moduleVal: $("#un-module-val"),
    pa: $("#un-pa"),
    paR: $("#un-pa-r"),
    paVal: $("#un-pa-val"),
    bl: $("#un-bl"),
    blR: $("#un-bl-r"),
    blVal: $("#un-bl-val"),
    advanced: $("#un-advanced"),
    pinionTeeth: $("#un-pinionTeeth"),
    gearTeeth: $("#un-gearTeeth"),
    face: $("#un-face"),
    hole: $("#un-hole"),
    helixAngle: $("#un-helixAngle"),
    hand: $("#un-hand"),
    coneAngle: $("#un-coneAngle"),
    wormStarts: $("#un-wormStarts"),
    wormPitchDia: $("#un-wormPitchDia"),
    drive: $("#un-drive"),
    driveVal: $("#un-drive-val"),
    play: $("#un-play"),
    resultGrid: $("#un-result-grid"),
    warnings: $("#un-warnings"),
    svgMain: $("#un-svg-main"),
    svgDetail: $("#un-svg-detail"),
    dl1: $("#un-dl-1"),
    dl2: $("#un-dl-2"),
    dlAll: $("#un-dl-all"),
  };

  if (!els.type) return; // panel not present

  const ALPHA = (20 * Math.PI) / 180;

  // involute options from the live pressure-angle / backlash inputs
  function optOf(p) {
    return { alpha: p.pressureAngle != null ? p.pressureAngle : ALPHA, backlash: p.backlash };
  }

  function num(el, fallback) {
    const v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  }

  function readInputs() {
    return {
      gearIdx: parseInt(els.type.value, 10),
      ratio: num(els.ratio, 3),
      module: num(els.module, 2),
      advanced: els.advanced.checked,
      pinionTeeth: Math.round(num(els.pinionTeeth, 20)),
      gearTeeth: Math.round(num(els.gearTeeth, 0)),
      pressureAngleDeg: num(els.pa, 20),
      backlashFactor: num(els.bl, 0.05),
      face: num(els.face, 16),
      hole: num(els.hole, 5),
      helixAngleDeg: num(els.helixAngle, 20),
      hand: els.hand.value,
      coneAngleDeg: num(els.coneAngle, 45),
      wormStarts: Math.round(num(els.wormStarts, 1)),
      wormPitchDia: num(els.wormPitchDia, 16),
    };
  }

  // Mirrors set_advanced_visibility() in UniversalGearGenerator.py.
  function updateFieldVisibility() {
    const gearIdx = parseInt(els.type.value, 10);
    const adv = els.advanced.checked;
    const wraps = {
      pinionTeeth: "un-f-pinionTeeth",
      gearTeeth: "un-f-gearTeeth",
      pressureAngle: "un-f-pressureAngle",
      face: "un-f-face",
      hole: "un-f-hole",
      helixAngle: "un-f-helixAngle",
      hand: "un-f-hand",
      coneAngle: "un-f-coneAngle",
      wormStarts: "un-f-wormStarts",
      wormPitchDia: "un-f-wormPitchDia",
    };
    for (const id of Object.values(wraps)) {
      const el = document.getElementById(id);
      if (el) el.style.display = adv ? "" : "none";
    }
    if (adv) {
      document.getElementById(wraps.helixAngle).style.display = [1, 2].includes(gearIdx) ? "" : "none";
      document.getElementById(wraps.hand).style.display = [1, 2, 4].includes(gearIdx) ? "" : "none";
      // bevel pitch angles are derived from the tooth ratio (Σ = 90°),
      // so the manual cone-angle field is not used.
      document.getElementById(wraps.coneAngle).style.display = "none";
      document.getElementById(wraps.wormStarts).style.display = gearIdx === 4 ? "" : "none";
      document.getElementById(wraps.wormPitchDia).style.display = gearIdx === 4 ? "" : "none";
      document.getElementById(wraps.hole).style.display = gearIdx !== 5 ? "" : "none";
      document.getElementById(wraps.gearTeeth).style.display = gearIdx !== 4 ? "" : "none";
    }
  }

  function fmt(n) {
    return n.toFixed(3);
  }

  function svgEl(tag, attrs) {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function clear(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function loopToPathD(loop, scale) {
    let d = "";
    loop.forEach((pt, i) => {
      const X = (pt.x * scale).toFixed(2);
      const Y = (-pt.y * scale).toFixed(2);
      d += (i === 0 ? "M" : "L") + X + "," + Y + " ";
    });
    return d + "Z";
  }

  function ringPathD(loops, scale) {
    return loops.map((loop) => loopToPathD(loop, scale)).join(" ");
  }

  function circlePathD(r, cx, cy, scale) {
    const R = r * scale,
      CX = (cx || 0) * scale,
      CY = -(cy || 0) * scale;
    return `M ${CX + R},${CY} A ${R},${R} 0 1 0 ${CX - R},${CY} A ${R},${R} 0 1 0 ${CX + R},${CY} Z`;
  }

  function fillPath(g, d, fillVar, strokeVar, sw, opacity, evenodd) {
    const attrs = { d };
    if (evenodd) attrs["fill-rule"] = "evenodd";
    const path = svgEl("path", attrs);
    path.style.fill = fillVar ? `var(${fillVar})` : "none";
    path.style.stroke = `var(${strokeVar})`;
    path.style.strokeWidth = sw || "1.2";
    if (opacity) path.style.opacity = opacity;
    g.appendChild(path);
    return path;
  }

  // The line-of-centres pitch point where meshing contact happens — the best
  // place to zoom in and confirm the teeth roll without interference.
  function contactPoint(p) {
    switch (p.gearIdx) {
      case 0:
      case 1:
        return { x: p.pitchR1, y: 0 };
      case 2:
        return { x: p.offset + p.pitchR1, y: 0 };
      case 3:
        return { x: p.pitchR1 || p.rootBig1, y: 0 };
      case 4:
        return { x: p.wormPitchR, y: 0 };
      case 5:
        return { x: 0, y: 0 };
      default:
        return { x: 0, y: 0 };
    }
  }

  function mainExtent(p) {
    switch (p.gearIdx) {
      case 0:
      case 1:
        return Math.max(p.tipR1, p.center + p.tipR2) + p.drawModule * 2;
      case 2:
        return p.outerR + p.drawModule * 2;
      case 3:
        return p.R * 1.05;
      case 4:
        return Math.max(p.wormOuterR, p.wheelCenter + p.wheelTipR) + p.module * 2;
      case 5:
        return Math.max(p.rackLength / 2, p.pitchR1 * 2) + p.drawModule * 2;
      default:
        return 100;
    }
  }

  // ------------------------------------------------------------------
  // Scene builders (drive = pinion/gear1 rotation in radians)
  // ------------------------------------------------------------------
  // ---- bevel: axial (side) cross-section, Σ = 90°, apex at origin ----
  // Draws the two pitch cones meeting at the apex plus each gear as a solid
  // frustum band straddling its own axis — the classic bevel-pair section.
  function bevelAxial(g, p, scale) {
    const a = p.module,
      d = 1.25 * p.module,
      R = p.R,
      b = p.b;
    const thA = Math.atan(a / R),
      thF = Math.atan(d / R);
    const gDir = (ang, r) => ({ x: r * Math.cos(ang), y: r * Math.sin(ang) }); // gear axis +x
    const pDir = (ang, r) => ({ x: r * Math.sin(ang), y: r * Math.cos(ang) }); // pinion axis +y

    function dashLine(pt, strokeVar, dash, w, op) {
      const el = svgEl("line", { x1: 0, y1: 0, x2: (pt.x * scale).toFixed(2), y2: (-pt.y * scale).toFixed(2) });
      el.style.stroke = strokeVar;
      el.style.strokeWidth = w || "0.8";
      if (dash) el.style.strokeDasharray = dash;
      if (op) el.style.opacity = op;
      g.appendChild(el);
    }

    // shaft axes (dash-dot)
    dashLine(gDir(0, R * 1.15), "#ffffff35", "8 3 2 3", "0.9");
    dashLine(pDir(0, R * 1.15), "#ffffff35", "8 3 2 3", "0.9");

    // translucent pitch cones (apex wedge spanning ±delta out to R)
    function coneWedge(dirFn, delta, strokeVar) {
      const pts = [{ x: 0, y: 0 }];
      const N = 10;
      for (let i = 0; i <= N; i++) pts.push(dirFn(-delta + (2 * delta * i) / N, R));
      const path = svgEl("path", { d: loopToPathD(pts, scale) });
      path.style.fill = `var(${strokeVar})`;
      path.style.opacity = "0.12";
      path.style.stroke = "none";
      g.appendChild(path);
    }
    coneWedge(gDir, p.delta2, "--g2-stroke");
    coneWedge(pDir, p.delta1, "--g1-stroke");

    function frustum(dirFn, delta, fillVar, strokeVar) {
      const fa = delta + thA; // face-cone half-angle span
      const rf = delta - thF;
      // solid teeth/rim band straddling the axis (outer end)
      const poly = [dirFn(fa, R - b), dirFn(fa, R), dirFn(-fa, R), dirFn(-fa, R - b)];
      fillPath(g, loopToPathD(poly, scale), fillVar, strokeVar, "1.4");
      // hub connecting the inner band edge back toward the apex
      const hi = dirFn(rf, R - b),
        him = dirFn(-rf, R - b);
      const ha2 = dirFn(rf, (R - b) * 0.25),
        him2 = dirFn(-rf, (R - b) * 0.25);
      fillPath(g, loopToPathD([ha2, hi, him, him2], scale), fillVar, strokeVar, "1", "0.5");
      // pitch cone element lines (both sides), dashed
      dashLine(dirFn(delta, R + 1.5 * p.module), `var(${strokeVar})`, "5 4", "0.9", "0.75");
      dashLine(dirFn(-delta, R + 1.5 * p.module), `var(${strokeVar})`, "5 4", "0.9", "0.4");
    }

    // gear first (bigger, behind), then pinion
    frustum(gDir, p.delta2, "--g2-fill", "--g2-stroke");
    frustum(pDir, p.delta1, "--g1-fill", "--g1-stroke");

    // apex + common pitch line (where the pair meshes)
    dashLine(gDir(p.delta2, R), "#ffffffaa", "", "1.6", "0.9");
    const apex = svgEl("circle", { cx: 0, cy: 0, r: 3.5 });
    apex.style.fill = "#ffffffcc";
    g.appendChild(apex);
  }

  // ---- bevel: Tredgold back-cone equivalent spur gears (true tooth form) ----
  function bevelTredgold(g, p, scale, drive) {
    const opt = optOf(p);
    const m = p.module;
    const z1 = p.zv1r,
      z2 = p.zv2r;
    const center = p.rv1 + p.rv2;
    const th = drive;
    const phase2 = z2 % 2 === 0 ? -Math.PI / z2 : 0;
    const a2 = phase2 - th * (z1 / z2);
    fillPath(g, loopToPathD(Involute.involuteGear(z1, m, th, 0, 0, opt), scale), "--g1-fill", "--g1-stroke");
    fillPath(g, loopToPathD(Involute.involuteGear(z2, m, a2, center, 0, opt), scale), "--g2-fill", "--g2-stroke");
    pitchCircle(g, p.rv1, 0, 0, scale);
    pitchCircle(g, p.rv2, center, 0, scale);
  }

  function buildScene(g, p, scale, drive, detail) {
    const pm = p.drawModule || p.module;
    const opt = optOf(p);

    if (p.gearIdx === 0 || p.gearIdx === 1) {
      // external involute pair
      const th = drive;
      const phase2 = (p.z2 % 2 === 0 ? -Math.PI / p.z2 : 0);
      const a2 = phase2 - th * (p.z1 / p.z2);
      if (p.gearIdx === 1) {
        // helical: show the twisted top section faintly behind
        fillPath(g, loopToPathD(Involute.involuteGear(p.z1, pm, th + p.twist1, 0, 0, opt), scale), null, "--g1-stroke", "1", "0.35");
        fillPath(g, loopToPathD(Involute.involuteGear(p.z2, pm, a2 + p.twist2, p.center, 0, opt), scale), null, "--g2-stroke", "1", "0.35");
      }
      fillPath(g, loopToPathD(Involute.involuteGear(p.z1, pm, th, 0, 0, opt), scale), "--g1-fill", "--g1-stroke");
      fillPath(g, loopToPathD(Involute.involuteGear(p.z2, pm, a2, p.center, 0, opt), scale), "--g2-fill", "--g2-stroke");
      centreHole(g, p, 0, 0, scale);
      centreHole(g, p, p.center, 0, scale);
      pitchCircle(g, p.pitchR1, 0, 0, scale);
      pitchCircle(g, p.pitchR2, p.center, 0, scale);
    } else if (p.gearIdx === 2) {
      // internal: ring + pinion, same direction
      const th = drive;
      const phaseRing = Math.PI / p.z2;
      const ringAng = phaseRing + th * (p.z1 / p.z2);
      const ringInner = Involute.involuteRing(p.z2, pm, ringAng, 0, 0, opt);
      const ringOuter = Involute.circlePoints(p.outerR, 0, 0, 220);
      fillPath(g, ringPathD([ringOuter, ringInner], scale), "--g1-fill", "--g1-stroke", "1.2", null, true);
      fillPath(g, loopToPathD(Involute.involuteGear(p.z1, pm, th, p.offset, 0, opt), scale), "--g2-fill", "--g2-stroke");
      centreHole(g, p, p.offset, 0, scale);
      pitchCircle(g, p.pitchR1, p.offset, 0, scale);
      pitchCircle(g, (pm * p.z2) / 2, 0, 0, scale);
    } else if (p.gearIdx === 3) {
      // bevel pair: main = axial cone section, detail = Tredgold spur gears
      if (detail) bevelTredgold(g, p, scale, drive);
      else bevelAxial(g, p, scale);
    } else if (p.gearIdx === 4) {
      // worm (root circle + start marks) driving an involute wheel
      const th = drive;
      const root = fillPath(g, circlePathD(p.wormRootR, 0, 0, scale), "--g1-fill", "--g1-stroke");
      fillPath(g, circlePathD(p.wormOuterR, 0, 0, scale), null, "--g1-stroke", "1");
      for (let s = 0; s < p.starts; s++) {
        const a = (2 * Math.PI * s) / p.starts + th;
        const line = svgEl("line", {
          x1: (p.wormRootR * Math.cos(a) * scale).toFixed(2),
          y1: (-p.wormRootR * Math.sin(a) * scale).toFixed(2),
          x2: (p.wormOuterR * Math.cos(a) * scale).toFixed(2),
          y2: (-p.wormOuterR * Math.sin(a) * scale).toFixed(2),
        });
        line.style.stroke = "var(--g1-stroke)";
        line.style.strokeWidth = "2";
        g.appendChild(line);
      }
      const wheelAng = -th * (p.starts / p.wheelTeeth);
      fillPath(g, loopToPathD(Involute.involuteGear(p.wheelTeeth, p.module, wheelAng, p.wheelCenter, 0, opt), scale), "--g2-fill", "--g2-stroke");
      pitchCircle(g, p.wheelPitchR, p.wheelCenter, 0, scale);
    } else if (p.gearIdx === 5) {
      // rack + pinion. pinion above rack, rack pitch line at y=0.
      const th = drive;
      const rack = Involute.involuteRack(p.zRack, p.module, 0, -p.pitchR1 * th, -p.rackLength / 2, p.rackLength / 2, opt);
      fillPath(g, loopToPathD(rack.bar, scale), "--g1-fill", "--g1-stroke", "1.2");
      for (const tooth of rack.teeth) fillPath(g, loopToPathD(tooth, scale), "--g1-fill", "--g1-stroke", "1");
      // pinion tooth should point down into the rack: offset rotation by -90°
      fillPath(g, loopToPathD(Involute.involuteGear(p.z1, p.module, th - Math.PI / 2, 0, p.pitchR1, opt), scale), "--g2-fill", "--g2-stroke");
      centreHole(g, p, 0, p.pitchR1, scale);
      pitchCircle(g, p.pitchR1, 0, p.pitchR1, scale);
    }
  }

  function centreHole(g, p, cx, cy, scale) {
    if (!p.hole || p.hole <= 0) return;
    fillPath(g, circlePathD(p.hole / 2, cx, cy, scale), null, "--border", "1");
  }

  function pitchCircle(g, r, cx, cy, scale) {
    const c = svgEl("path", { d: circlePathD(r, cx, cy, scale), fill: "none" });
    c.style.stroke = "#ffffff33";
    c.style.strokeWidth = "0.75";
    c.style.strokeDasharray = "3 4";
    g.appendChild(c);
  }

  const mainFit = ViewFit.make(),
    detailFit = ViewFit.make();

  function renderMainSvg(p, drive) {
    const svg = els.svgMain;
    clear(svg);
    const W = 900,
      H = 900;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    // desired centre: mid-point between the two parts
    let idealMidX = 0,
      idealMidY = 0;
    if (p.gearIdx === 0 || p.gearIdx === 1) idealMidX = p.center / 2;
    else if (p.gearIdx === 3) idealMidX = p.R * 0.32;
    else if (p.gearIdx === 4) idealMidX = p.wheelCenter / 2;
    else if (p.gearIdx === 2) idealMidX = p.offset / 2;
    // sticky fit — steady view during live edits, auto-refit on big changes
    const f = ViewFit.fit(mainFit, W, 0.46, mainExtent(p), idealMidX, idealMidY);
    const scale = f.scale,
      midX = f.midX,
      midY = f.midY;
    const g = svgEl("g", { transform: `translate(${W / 2 - midX * scale},${H / 2 + midY * scale})` });
    svg.appendChild(g);
    buildScene(g, p, scale, drive, false);
  }

  function renderDetailSvg(p, drive) {
    const svg = els.svgDetail;
    clear(svg);
    const W = 500,
      H = 500;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const pm = p.drawModule || p.module;
    // show roughly a 7-module-wide window around the contact point
    const cp = p.gearIdx === 3 ? { x: p.rv1, y: 0 } : contactPoint(p);
    const f = ViewFit.fit(detailFit, W, 0.5, 7 * pm, cp.x, cp.y);
    const scale = f.scale;
    const g = svgEl("g", { transform: `translate(${W / 2 - f.midX * scale},${H / 2 + f.midY * scale})` });
    svg.appendChild(g);
    buildScene(g, p, scale, drive, true);
  }

  function renderResults(p) {
    const rows = [
      ["기어 종류", p.gearTypeName, true],
      ["요약", p.summary, false],
      ["치형", `인벌류트 (압력각 ${((p.pressureAngle * 180) / Math.PI).toFixed(1)}°, 백래시 ${(p.backlash / p.module).toFixed(2)}·m)`, false],
      ["모듈", fmt(p.module) + " mm", false],
      ["감속비 (입력)", p.ratio.toFixed(2) + " : 1", false],
    ];
    if (p.gearIdx === 0 || p.gearIdx === 1) {
      rows.push(
        ["피니언 잇수 (z1)", p.z1, false],
        ["기어 잇수 (z2)", p.z2, false],
        ["실제 감속비", p.actualRatio.toFixed(3) + " : 1", false],
        ["피니언 피치 반경", fmt(p.pitchR1) + " mm", false],
        ["기어 피치 반경", fmt(p.pitchR2) + " mm", false],
        ["축간 거리", fmt(p.center) + " mm", false]
      );
      if (p.z1 < 17) p.warnings.push(`피니언 잇수 ${p.z1} < 17 → 표준 인벌류트에서 언더컷(치 뿌리 간섭)이 생길 수 있습니다.`);
    } else if (p.gearIdx === 2) {
      rows.push(
        ["피니언 잇수", p.z1, false],
        ["링 잇수", p.z2, false],
        ["피니언 오프셋", fmt(p.offset) + " mm", false],
        ["링 외경", fmt(p.outerR * 2) + " mm", false]
      );
      if (p.z2 - p.z1 < 10) p.warnings.push("내치 기어에서 링-피니언 잇수차가 작으면(<10) 치 간섭이 생기기 쉽습니다.");
    } else if (p.gearIdx === 3) {
      rows.push(
        ["피니언 잇수 (z1)", p.z1, false],
        ["기어 잇수 (z2)", p.z2, false],
        ["축각 Σ", "90°", false],
        ["피치각 δ1 / δ2", `${((p.delta1 * 180) / Math.PI).toFixed(1)}° / ${((p.delta2 * 180) / Math.PI).toFixed(1)}°`, false],
        ["외부 원추거리 R", fmt(p.R) + " mm", false],
        ["페이스폭 b", fmt(p.b) + " mm", false],
        ["등가 잇수 zv1 / zv2", `${p.zv1.toFixed(1)} / ${p.zv2.toFixed(1)}`, false]
      );
      p.warnings.push("베벨은 원뿔형 3D입니다. 메인=축단면(Σ=90°), 확대=Tredgold 등가 평기어(치형·맞물림)로 표현합니다.");
    } else if (p.gearIdx === 4) {
      rows.push(
        ["웜 줄 수", p.starts, false],
        ["웜휠 잇수", p.wheelTeeth, false],
        ["웜 피치 반경", fmt(p.wormPitchR) + " mm", false],
        ["리드각", ((p.leadAngle * 180) / Math.PI).toFixed(1) + " deg", false]
      );
      p.warnings.push("웜은 3D에서 나선 스윕입니다. 2D는 웜 단면(원)과 인벌류트 웜휠만 보여줍니다.");
    } else if (p.gearIdx === 5) {
      rows.push(
        ["피니언 잇수", p.z1, false],
        ["랙 칸 수", p.zRack, false],
        ["랙 길이", fmt(p.rackLength) + " mm", false]
      );
      if (p.z1 < 17) p.warnings.push(`피니언 잇수 ${p.z1} < 17 → 언더컷 가능.`);
    }
    els.resultGrid.innerHTML = rows
      .map(([k, v, hl]) => `<div class="row${hl ? " hl" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`)
      .join("");
  }

  function renderWarnings(p) {
    els.warnings.innerHTML = "";
    for (const w of p.warnings) {
      const d = document.createElement("div");
      d.className = "warning";
      d.textContent = "⚠ " + w;
      els.warnings.appendChild(d);
    }
  }

  // ------------------------------------------------------------------
  // DXF export (static, drive = 0)
  // ------------------------------------------------------------------
  function download(filename, text) {
    const blob = new Blob([text], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function part1Layers(p) {
    const pm = p.drawModule || p.module;
    const opt = optOf(p);
    if (p.gearIdx === 0 || p.gearIdx === 1)
      return [{ layer: "PINION", loops: [Involute.involuteGear(p.z1, pm, 0, 0, 0, opt)] }];
    if (p.gearIdx === 2) {
      const phaseRing = Math.PI / p.z2;
      return [
        { layer: "RING_OUTER", loops: [Involute.circlePoints(p.outerR, 0, 0, 360)] },
        { layer: "RING_TEETH", loops: [Involute.involuteRing(p.z2, pm, phaseRing, 0, 0, opt)] },
      ];
    }
    if (p.gearIdx === 3)
      return [{ layer: "BEVEL_PINION_TREDGOLD", loops: [Involute.involuteGear(p.zv1r, p.module, 0, 0, 0, opt)] }];
    if (p.gearIdx === 4)
      return [
        { layer: "WORM_ROOT", loops: [Involute.circlePoints(p.wormRootR, 0, 0, 240)] },
        { layer: "WORM_OUTER", loops: [Involute.circlePoints(p.wormOuterR, 0, 0, 240)] },
      ];
    if (p.gearIdx === 5) {
      const rack = Involute.involuteRack(p.zRack, p.module, 0, 0, -p.rackLength / 2, p.rackLength / 2, opt);
      return [{ layer: "RACK", loops: [rack.bar, ...rack.teeth] }];
    }
    return [];
  }

  function part2Layers(p) {
    const pm = p.drawModule || p.module;
    const opt = optOf(p);
    if (p.gearIdx === 0 || p.gearIdx === 1) {
      const phase2 = p.z2 % 2 === 0 ? -Math.PI / p.z2 : 0;
      return [{ layer: "GEAR", loops: [Involute.involuteGear(p.z2, pm, phase2, p.center, 0, opt)] }];
    }
    if (p.gearIdx === 2) return [{ layer: "PINION", loops: [Involute.involuteGear(p.z1, pm, 0, p.offset, 0, opt)] }];
    if (p.gearIdx === 3)
      return [{ layer: "BEVEL_GEAR_TREDGOLD", loops: [Involute.involuteGear(p.zv2r, p.module, 0, p.rv1 + p.rv2, 0, opt)] }];
    if (p.gearIdx === 4) return [{ layer: "WHEEL", loops: [Involute.involuteGear(p.wheelTeeth, p.module, 0, p.wheelCenter, 0, opt)] }];
    if (p.gearIdx === 5) return [{ layer: "PINION", loops: [Involute.involuteGear(p.z1, p.module, -Math.PI / 2, 0, p.pitchR1, opt)] }];
    return [];
  }

  function wireDownloads(p) {
    els.dl1.onclick = () => download("universal_part1.dxf", DXFWriter.buildDXF(part1Layers(p)));
    els.dl2.onclick = () => download("universal_part2.dxf", DXFWriter.buildDXF(part2Layers(p)));
    els.dlAll.onclick = () =>
      download("universal_gear_set_full.dxf", DXFWriter.buildDXF([...part1Layers(p), ...part2Layers(p)]));
  }

  // ------------------------------------------------------------------
  // Render + animation
  // ------------------------------------------------------------------
  let currentParams = null;

  function driveRad() {
    return (num(els.drive, 0) * Math.PI) / 180;
  }

  function redrawGeometry() {
    if (!currentParams) return;
    const d = driveRad();
    renderMainSvg(currentParams, d);
    renderDetailSvg(currentParams, d);
  }

  function updateLabels() {
    els.ratioVal.textContent = (+num(els.ratio, 3)).toFixed(1);
    els.moduleVal.textContent = (+num(els.module, 2)).toFixed(1) + " mm";
    els.paVal.textContent = (+num(els.pa, 20)).toFixed(1) + "°";
    els.blVal.textContent = (+num(els.bl, 0.05)).toFixed(2) + " ×m";
  }

  function render() {
    updateFieldVisibility();
    updateLabels();
    const input = readInputs();
    const p = UniMath.deriveParams(input);
    currentParams = p;
    renderResults(p);
    renderWarnings(p);
    redrawGeometry();
    wireDownloads(p);
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  // keep each number box and its slider in sync, then render
  function pair(numEl, rangeEl) {
    if (!numEl || !rangeEl) return;
    numEl.addEventListener("input", () => {
      rangeEl.value = numEl.value;
      scheduleRender();
    });
    rangeEl.addEventListener("input", () => {
      numEl.value = rangeEl.value;
      scheduleRender();
    });
  }
  pair(els.ratio, els.ratioR);
  pair(els.module, els.moduleR);
  pair(els.pa, els.paR);
  pair(els.bl, els.blR);

  [
    els.type,
    els.advanced,
    els.pinionTeeth,
    els.gearTeeth,
    els.face,
    els.hole,
    els.helixAngle,
    els.hand,
    els.coneAngle,
    els.wormStarts,
    els.wormPitchDia,
  ].forEach((el) => el && el.addEventListener("input", scheduleRender));

  // switching gear type is a big change — let the view re-fit to it
  els.type.addEventListener("change", () => {
    ViewFit.reset(mainFit);
    ViewFit.reset(detailFit);
  });

  // double-click a preview to re-fit it to the current geometry
  [els.svgMain, els.svgDetail].forEach((svg, i) =>
    svg.addEventListener("dblclick", () => {
      ViewFit.reset(i === 0 ? mainFit : detailFit);
      redrawGeometry();
    })
  );

  els.drive.addEventListener("input", () => {
    els.driveVal.textContent = els.drive.value + "°";
    redrawGeometry();
  });

  // play / pause meshing animation
  let playing = false;
  let rafId = null;
  let lastT = 0;
  function tick(t) {
    if (!playing) return;
    if (!lastT) lastT = t;
    const dt = (t - lastT) / 1000;
    lastT = t;
    let v = num(els.drive, 0) + dt * 45; // 45 deg/sec
    v = ((v % 360) + 360) % 360;
    els.drive.value = v.toFixed(1);
    els.driveVal.textContent = Math.round(v) + "°";
    redrawGeometry();
    rafId = requestAnimationFrame(tick);
  }
  els.play.addEventListener("click", () => {
    playing = !playing;
    els.play.textContent = playing ? "⏸ 정지" : "▶ 재생";
    if (playing) {
      lastT = 0;
      rafId = requestAnimationFrame(tick);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
    }
  });

  // pause the animation when the tab is hidden to save CPU
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playing) {
      playing = false;
      els.play.textContent = "▶ 재생";
      if (rafId) cancelAnimationFrame(rafId);
    }
  });

  render();
})();
