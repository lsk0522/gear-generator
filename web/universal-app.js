(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    type: $("#un-type"),
    ratio: $("#un-ratio"),
    module: $("#un-module"),
    advanced: $("#un-advanced"),
    pinionTeeth: $("#un-pinionTeeth"),
    gearTeeth: $("#un-gearTeeth"),
    pressureAngle: $("#un-pressureAngle"),
    face: $("#un-face"),
    hole: $("#un-hole"),
    helixAngle: $("#un-helixAngle"),
    hand: $("#un-hand"),
    coneAngle: $("#un-coneAngle"),
    wormStarts: $("#un-wormStarts"),
    wormPitchDia: $("#un-wormPitchDia"),
    resultGrid: $("#un-result-grid"),
    warnings: $("#un-warnings"),
    svgMain: $("#un-svg-main"),
    svgDetail: $("#un-svg-detail"),
    dl1: $("#un-dl-1"),
    dl2: $("#un-dl-2"),
    dlAll: $("#un-dl-all"),
  };

  if (!els.type) return; // panel not present

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
      pressureAngleDeg: num(els.pressureAngle, 20),
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
      document.getElementById(wraps.coneAngle).style.display = gearIdx === 3 ? "" : "none";
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

  function rectPathD(x0, y0, x1, y1, scale) {
    const X0 = x0 * scale,
      Y0 = -y0 * scale,
      X1 = x1 * scale,
      Y1 = -y1 * scale;
    return `M ${X0},${Y0} L ${X1},${Y0} L ${X1},${Y1} L ${X0},${Y1} Z`;
  }

  // ------------------------------------------------------------------
  // extents per gear type, used to fit the main SVG viewBox
  // ------------------------------------------------------------------
  function mainExtent(p) {
    switch (p.gearIdx) {
      case 0:
      case 1:
        return Math.max(p.tipR1, p.center + p.tipR2) + p.module * 2;
      case 2:
        return p.outerR + p.module * 2;
      case 3:
        return p.offset + p.tipBig2 + p.module * 2;
      case 4:
        return Math.max(p.wormOuterR, p.wheelCenter + p.wheelTipR) + p.module * 2;
      case 5:
        return Math.max(p.rackLength / 2, p.pinionCenterY + p.tipR1) + p.module * 2;
      default:
        return 100;
    }
  }

  function drawExternalGear(g, zTeeth, rootR, tipR, rotation, cx, cy, scale, fillVar, strokeVar, opacity) {
    const outline = UniMath.externalGearOutline(zTeeth, rootR, tipR, rotation, cx, cy);
    const path = svgEl("path", { d: loopToPathD(outline, scale) });
    path.style.fill = `var(${fillVar})`;
    path.style.stroke = `var(${strokeVar})`;
    path.style.strokeWidth = "1.2";
    if (opacity) path.style.opacity = opacity;
    g.appendChild(path);
    return path;
  }

  function drawDashedOutline(g, zTeeth, rootR, tipR, rotation, cx, cy, scale, strokeVar) {
    const outline = UniMath.externalGearOutline(zTeeth, rootR, tipR, rotation, cx, cy);
    const path = svgEl("path", { d: loopToPathD(outline, scale), fill: "none" });
    path.style.stroke = `var(${strokeVar})`;
    path.style.strokeWidth = "1";
    path.style.strokeDasharray = "4 3";
    path.style.opacity = "0.8";
    g.appendChild(path);
  }

  function buildScene(g, p, scale) {
    if (p.gearIdx === 0) {
      drawExternalGear(g, p.z1, p.rootR1, p.tipR1, 0, 0, 0, scale, "--g1-fill", "--g1-stroke");
      drawExternalGear(g, p.z2, p.rootR2, p.tipR2, Math.PI / Math.max(p.z2, 1), p.center, 0, scale, "--g2-fill", "--g2-stroke");
    } else if (p.gearIdx === 1) {
      drawExternalGear(g, p.z1, p.rootR1, p.tipR1, 0, 0, 0, scale, "--g1-fill", "--g1-stroke");
      drawDashedOutline(g, p.z1, p.rootR1, p.tipR1, p.twist1, 0, 0, scale, "--g1-stroke");
      drawExternalGear(g, p.z2, p.rootR2, p.tipR2, 0, p.center, 0, scale, "--g2-fill", "--g2-stroke");
      drawDashedOutline(g, p.z2, p.rootR2, p.tipR2, p.twist2, p.center, 0, scale, "--g2-stroke");
    } else if (p.gearIdx === 2) {
      const prof = UniMath.internalGearProfile(p.z2, p.innerRootR, p.innerTipR, p.outerR, 0, 220);
      const path = svgEl("path", {
        d: ringPathD([prof.outer, prof.inner], scale),
        "fill-rule": "evenodd",
      });
      path.style.fill = "var(--g1-fill)";
      path.style.stroke = "var(--g1-stroke)";
      path.style.strokeWidth = "1.2";
      g.appendChild(path);
      drawExternalGear(g, p.z1, p.pinionRootR, p.pinionTipR, 0, p.offset, 0, scale, "--g2-fill", "--g2-stroke");
    } else if (p.gearIdx === 3) {
      drawExternalGear(g, p.z1, p.rootBig1, p.tipBig1, 0, 0, 0, scale, "--g1-fill", "--g1-stroke");
      drawDashedOutline(g, p.z1, p.rootSmall1, p.tipSmall1, Math.PI / p.z1 * 0.15, 0, 0, scale, "--g1-stroke");
      drawExternalGear(g, p.z2, p.rootBig2, p.tipBig2, 0, p.offset, 0, scale, "--g2-fill", "--g2-stroke");
      drawDashedOutline(g, p.z2, p.rootSmall2, p.tipSmall2, Math.PI / p.z2 * 0.15, p.offset, 0, scale, "--g2-stroke");
    } else if (p.gearIdx === 4) {
      const root = svgEl("path", { d: circlePathD(p.wormRootR, 0, 0, scale) });
      root.style.fill = "var(--g1-fill)";
      root.style.stroke = "var(--g1-stroke)";
      root.style.strokeWidth = "1.2";
      g.appendChild(root);
      const outer = svgEl("path", { d: circlePathD(p.wormOuterR, 0, 0, scale), fill: "none" });
      outer.style.stroke = "var(--g1-stroke)";
      outer.style.strokeWidth = "1";
      outer.style.strokeDasharray = "3 3";
      g.appendChild(outer);
      for (let s = 0; s < p.starts; s++) {
        const a = (2 * Math.PI * s) / p.starts;
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
      drawExternalGear(g, p.wheelTeeth, p.wheelRootR, p.wheelTipR, 0, p.wheelCenter, 0, scale, "--g2-fill", "--g2-stroke");
      drawDashedOutline(g, p.wheelTeeth, p.wheelRootR, p.wheelTipR, p.wheelTwist, p.wheelCenter, 0, scale, "--g2-stroke");
    } else if (p.gearIdx === 5) {
      const bar = svgEl("path", { d: rectPathD(-p.rackLength / 2, -p.rackBarH, p.rackLength / 2, 0, scale) });
      bar.style.fill = "var(--g1-fill)";
      bar.style.stroke = "var(--g1-stroke)";
      bar.style.strokeWidth = "1.2";
      g.appendChild(bar);
      const startX = -p.rackLength / 2 + p.pitch / 2;
      for (let i = 0; i < p.zRack; i++) {
        const tooth = UniMath.rackToothPoints(startX + i * p.pitch, p.module, 0, p.rackTipY);
        const path = svgEl("path", { d: loopToPathD(tooth, scale) });
        path.style.fill = "var(--g1-fill)";
        path.style.stroke = "var(--g1-stroke)";
        path.style.strokeWidth = "1";
        g.appendChild(path);
      }
      drawExternalGear(g, p.z1, p.rootR1, p.tipR1, Math.PI / 2, 0, p.pinionCenterY, scale, "--g2-fill", "--g2-stroke");
    }
  }

  function renderMainSvg(p) {
    const svg = els.svgMain;
    clear(svg);
    const W = 900,
      H = 900;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const extent = mainExtent(p);
    const scale = (W * 0.46) / extent;
    const g = svgEl("g", { transform: `translate(${W / 2},${H / 2})` });
    svg.appendChild(g);
    buildScene(g, p, scale);
  }

  function renderDetailSvg(p) {
    const svg = els.svgDetail;
    clear(svg);
    const W = 500,
      H = 500;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const extent = mainExtent(p);
    const scale = ((W * 0.46) / extent) * 4;
    // focus on the primary gear/part near its rightmost point (a tooth).
    let focusX = 0,
      focusY = 0;
    if (p.gearIdx === 5) {
      focusX = 0;
      focusY = p.pinionCenterY;
    } else if (p.gearIdx === 2) {
      focusX = p.offset;
    } else if (p.gearIdx === 4) {
      focusX = 0;
    }
    const tipR = p.tipR1 || p.wormOuterR || p.pinionTipR || p.rootBig1 || 10;
    const g = svgEl("g", { transform: `translate(${W / 2 - focusX * scale + tipR * scale * 0.55},${H / 2 + focusY * scale})` });
    svg.appendChild(g);
    buildScene(g, p, scale);
  }

  function renderResults(p) {
    const rows = [
      ["기어 종류", p.gearTypeName, true],
      ["요약", p.summary, false],
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
    } else if (p.gearIdx === 2) {
      rows.push(
        ["피니언 잇수", p.z1, false],
        ["링 잇수", p.z2, false],
        ["피니언 오프셋", fmt(p.offset) + " mm", false],
        ["링 외경", fmt(p.outerR * 2) + " mm", false]
      );
    } else if (p.gearIdx === 3) {
      rows.push(
        ["피니언 잇수", p.z1, false],
        ["기어 잇수", p.z2, false],
        ["축간 오프셋", fmt(p.offset) + " mm", false],
        ["원추각", ((p.coneAngle * 180) / Math.PI).toFixed(1) + " deg", false]
      );
    } else if (p.gearIdx === 4) {
      rows.push(
        ["웜 줄 수", p.starts, false],
        ["웜휠 잇수", p.wheelTeeth, false],
        ["웜 피치 반경", fmt(p.wormPitchR) + " mm", false],
        ["웜휠 중심 거리", fmt(p.wheelCenter) + " mm", false],
        ["리드각", ((p.leadAngle * 180) / Math.PI).toFixed(1) + " deg", false]
      );
    } else if (p.gearIdx === 5) {
      rows.push(
        ["피니언 잇수", p.z1, false],
        ["랙 칸 수", p.zRack, false],
        ["랙 길이", fmt(p.rackLength) + " mm", false],
        ["피니언 중심 Y", fmt(p.pinionCenterY) + " mm", false]
      );
    }
    els.resultGrid.innerHTML = rows
      .map(
        ([k, v, hl]) =>
          `<div class="row${hl ? " hl" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`
      )
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
  // DXF export
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
    if (p.gearIdx === 0 || p.gearIdx === 1)
      return [{ layer: "PINION", loops: [UniMath.externalGearOutline(p.z1, p.rootR1, p.tipR1, 0, 0, 0)] }];
    if (p.gearIdx === 2) {
      const prof = UniMath.internalGearProfile(p.z2, p.innerRootR, p.innerTipR, p.outerR, 0, 360);
      return [{ layer: "RING_OUTER", loops: [prof.outer] }, { layer: "RING_TEETH", loops: [prof.inner] }];
    }
    if (p.gearIdx === 3) return [{ layer: "PINION_BIG", loops: [UniMath.externalGearOutline(p.z1, p.rootBig1, p.tipBig1, 0, 0, 0)] }];
    if (p.gearIdx === 4) return [{ layer: "WORM_ROOT", loops: [UniMath.circlePoints(p.wormRootR, 0, 0, 240)] }, { layer: "WORM_OUTER", loops: [UniMath.circlePoints(p.wormOuterR, 0, 0, 240)] }];
    if (p.gearIdx === 5) {
      const startX = -p.rackLength / 2 + p.pitch / 2;
      const loops = [
        [
          { x: -p.rackLength / 2, y: -p.rackBarH },
          { x: p.rackLength / 2, y: -p.rackBarH },
          { x: p.rackLength / 2, y: 0 },
          { x: -p.rackLength / 2, y: 0 },
        ],
      ];
      for (let i = 0; i < p.zRack; i++) loops.push(UniMath.rackToothPoints(startX + i * p.pitch, p.module, 0, p.rackTipY));
      return [{ layer: "RACK", loops }];
    }
    return [];
  }

  function part2Layers(p) {
    if (p.gearIdx === 0 || p.gearIdx === 1)
      return [
        {
          layer: "GEAR",
          loops: [UniMath.externalGearOutline(p.z2, p.rootR2, p.tipR2, Math.PI / Math.max(p.z2, 1), p.center, 0)],
        },
      ];
    if (p.gearIdx === 2) return [{ layer: "PINION", loops: [UniMath.externalGearOutline(p.z1, p.pinionRootR, p.pinionTipR, 0, p.offset, 0)] }];
    if (p.gearIdx === 3) return [{ layer: "GEAR_BIG", loops: [UniMath.externalGearOutline(p.z2, p.rootBig2, p.tipBig2, 0, p.offset, 0)] }];
    if (p.gearIdx === 4) return [{ layer: "WHEEL", loops: [UniMath.externalGearOutline(p.wheelTeeth, p.wheelRootR, p.wheelTipR, 0, p.wheelCenter, 0)] }];
    if (p.gearIdx === 5) return [{ layer: "PINION", loops: [UniMath.externalGearOutline(p.z1, p.rootR1, p.tipR1, Math.PI / 2, 0, p.pinionCenterY)] }];
    return [];
  }

  function wireDownloads(p) {
    els.dl1.onclick = () => download("universal_part1.dxf", DXFWriter.buildDXF(part1Layers(p)));
    els.dl2.onclick = () => download("universal_part2.dxf", DXFWriter.buildDXF(part2Layers(p)));
    els.dlAll.onclick = () =>
      download("universal_gear_set_full.dxf", DXFWriter.buildDXF([...part1Layers(p), ...part2Layers(p)]));
  }

  function render() {
    updateFieldVisibility();
    const input = readInputs();
    const p = UniMath.deriveParams(input);
    renderResults(p);
    renderWarnings(p);
    renderMainSvg(p);
    renderDetailSvg(p);
    wireDownloads(p);
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  [
    els.type,
    els.ratio,
    els.module,
    els.advanced,
    els.pinionTeeth,
    els.gearTeeth,
    els.pressureAngle,
    els.face,
    els.hole,
    els.helixAngle,
    els.hand,
    els.coneAngle,
    els.wormStarts,
    els.wormPitchDia,
  ].forEach((el) => el && el.addEventListener("input", scheduleRender));

  render();
})();
