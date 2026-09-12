(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    module: $("#in-module"),
    zf: $("#in-zf"),
    zc: $("#in-zc"),
    ratio: $("#in-ratio"),
    w0: $("#in-w0"),
    ha: $("#in-ha"),
    hd: $("#in-hd"),
    toothAngle: $("#in-toothangle"),
    toothThickness: $("#in-toothick"),
    rootFillet: $("#in-rootfillet"),
    clearance: $("#in-clearance"),
    wallFlex: $("#in-wallflex"),
    wallCirc: $("#in-wallcirc"),
    rotation: $("#in-rotation"),
    rotationVal: $("#in-rotation-val"),
    resultGrid: $("#result-grid"),
    metricGrid: $("#metric-grid"),
    warnings: $("#warnings"),
    svgMain: $("#svg-main"),
    svgDetail: $("#svg-detail"),
    dlCS: $("#dl-cs"),
    dlFS: $("#dl-fs"),
    dlWG: $("#dl-wg"),
    dlAll: $("#dl-all"),
  };

  if (!els.module) return; // HD panel not present on this page

  function num(el, fallback) {
    const v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  }

  // zc follows from zf and the typed reduction ratio, so any whole ratio is
  // exact (zc = zf + zf/ratio). Editing zc directly recomputes the ratio.
  function linkRatio(fromRatio) {
    const zf = Math.round(num(els.zf, 100));
    if (fromRatio) {
      const ratio = Math.max(1, Math.round(num(els.ratio, 50)));
      els.zc.value = zf + Math.round(zf / ratio);
    } else {
      const zc = Math.round(num(els.zc, 102));
      const dz = Math.max(1, zc - zf);
      els.ratio.value = Math.round(zf / dz);
    }
  }

  function readInputs() {
    return {
      module: num(els.module, 1.25),
      zf: Math.round(num(els.zf, 100)),
      zc: Math.round(num(els.zc, 102)),
      w0Ratio: num(els.w0, 1.0),
      ha: num(els.ha, 1.0),
      hd: num(els.hd, 1.0),
      toothAngle: num(els.toothAngle, 9.17),
      toothThickness: num(els.toothThickness, 0.5),
      rootFillet: num(els.rootFillet, 0.15),
      clearance: num(els.clearance, 0.05),
      wallFlex: num(els.wallFlex, 0.75),
      wallCirc: num(els.wallCirc, 3.0),
    };
  }

  function fmt(n, digits) {
    return n.toFixed(digits == null ? 3 : digits);
  }

  function loopToPathD(loop, scale, rotAngle) {
    const c = Math.cos(rotAngle || 0),
      s = Math.sin(rotAngle || 0);
    let d = "";
    loop.forEach((pt, i) => {
      const rx = pt.x * c - pt.y * s;
      const ry = pt.x * s + pt.y * c;
      const X = (rx * scale).toFixed(2);
      const Y = (-ry * scale).toFixed(2);
      d += (i === 0 ? "M" : "L") + X + "," + Y + " ";
    });
    return d + "Z";
  }

  function svgEl(tag, attrs) {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function clear(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function render() {
    const input = readInputs();
    const d = HDMath.deriveGeometry(input);

    if (!d.feasible) {
      renderInfeasible(d);
      return;
    }

    const gen = HDMath.generate(input);
    const metrics = HDMath.computeMetrics(input, gen);

    renderResults(d, gen);
    renderMetrics(metrics);
    renderWarnings(d);
    renderMainSvg(d, gen);
    renderDetailSvg(d, gen);
    wireDownloads(d, gen);
  }

  function renderInfeasible(d) {
    els.warnings.innerHTML = d.warnings.map((w) => `<div class="error">✕ ${w}</div>`).join("");
    els.resultGrid.innerHTML = "";
    els.metricGrid.innerHTML = "";
    clear(els.svgMain);
    clear(els.svgDetail);
  }

  function renderResults(d, gen) {
    const rows = [
      ["감속비 (zf / (zc−zf))", "1 : " + Math.round(d.zf / (d.zc - d.zf)), true],
      ["플렉스스플라인 잇수 (zf)", d.zf, false],
      ["서큘러스플라인 잇수 (zc)", d.zc, false],
      ["피치 반경 (rp)", fmt(d.rp) + " mm", false],
      ["WG 장/단축 (a / b)", fmt(d.a) + " / " + fmt(d.b) + " mm", false],
      ["이빨각 α0 (적용값)", fmt((d.alpha0 * 180) / Math.PI, 2) + "°", false],
      ["이뿌리 필렛 반경", fmt(d.rootFillet) + " mm", false],
      ["FS 벽 두께 / CS 벽 두께", fmt(d.wallFlex, 2) + " / " + fmt(d.wallCirc, 2) + " mm", false],
      ["FS 이끝원 / 이뿌리원", fmt(gen.flex.tipRadius) + " / " + fmt(gen.flex.rootRadius) + " mm", false],
      ["CS 외경", fmt(2 * gen.circ.outerRadius) + " mm", false],
    ];
    els.resultGrid.innerHTML = rows
      .map(
        ([k, v, hl]) =>
          `<div class="row${hl ? " hl" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`
      )
      .join("");
  }

  function renderMetrics(m) {
    const rows = [
      ["반경 변형(w0)", fmt(m.w0) + ` mm (${fmt(m.deflPct, 1)}%)`],
      ["맞물린 이 개수", Math.round(m.teethMesh) + ` (${fmt(m.teethPct, 0)}%)`],
      ["백래시(기하학적)", fmt(m.backlash) + " mm"],
      ["플렉스스플라인 변형률", fmt(m.fsStrainPct, 3) + " %"],
      ["이 높이", fmt(m.toothHeight) + " mm"],
      ["이끝 반경(자연 형성)", fmt(m.tipRadius) + " mm"],
      ["이 두께 / 원주피치", fmt(m.toothThicknessMm) + " / " + fmt(m.circularPitch) + " mm"],
      ["이뿌리 랜드", fmt(m.rootLand) + " mm"],
      ["스트로크 여유", fmt(m.strokeMargin * 1000, 0) + " µm"],
    ];
    els.metricGrid.innerHTML = rows
      .map(([k, v]) => `<div class="row"><div class="k">${k}</div><div class="v">${v}</div></div>`)
      .join("");
  }

  function renderWarnings(d) {
    els.warnings.innerHTML = d.warnings.map((w) => `<div class="warning">⚠ ${w}</div>`).join("");
  }

  function renderMainSvg(d, gen) {
    const svg = els.svgMain;
    clear(svg);
    const W = 900,
      H = 900;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const outerR = gen.circ.outerRadius;
    const scale = (W * 0.46) / outerR;
    const g = svgEl("g", { transform: `translate(${W / 2},${H / 2})` });
    svg.appendChild(g);

    // Circular spline: outer circle + inner (conjugate slot) boundary, evenodd
    const csOuter = HDMath.circlePoints(outerR, 0, 0, 300);
    const csPath = svgEl("path", {
      d: loopToPathD(csOuter, scale, 0) + " " + loopToPathD(gen.circ.inner, scale, 0),
      "fill-rule": "evenodd",
    });
    csPath.style.fill = "var(--cs-fill)";
    csPath.style.stroke = "var(--cs-stroke)";
    csPath.style.strokeWidth = "1";
    g.appendChild(csPath);

    // Flexspline: outer (teeth) boundary + bore circle, evenodd, rotated by slider
    const rot = ((num(els.rotation, 0) || 0) * Math.PI) / 180;
    const bore = HDMath.circlePoints(gen.flex.rootRadius - d.wallFlex, 0, 0, 300);
    const fsPath = svgEl("path", {
      d: loopToPathD(gen.flex.outer, scale, rot) + " " + loopToPathD(bore, scale, rot),
      "fill-rule": "evenodd",
    });
    fsPath.style.fill = "var(--fs-fill)";
    fsPath.style.stroke = "var(--fs-stroke)";
    fsPath.style.strokeWidth = "1";
    fsPath.style.opacity = "0.92";
    g.appendChild(fsPath);

    const wg = HDMath.waveGeneratorCam(d, 240);
    const wgPath = svgEl("path", { d: loopToPathD(wg, scale, rot), fill: "none" });
    wgPath.style.stroke = "var(--wg-stroke)";
    wgPath.style.strokeWidth = "1.4";
    wgPath.style.strokeDasharray = "4 3";
    g.appendChild(wgPath);

    for (const r of [d.rp]) {
      const c = svgEl("path", { d: loopToPathD(HDMath.circlePoints(r, 0, 0, 200), scale, 0), fill: "none" });
      c.style.stroke = "#ffffff33";
      c.style.strokeWidth = "0.75";
      c.style.strokeDasharray = "2 4";
      g.appendChild(c);
    }
  }

  function renderDetailSvg(d, gen) {
    const svg = els.svgDetail;
    clear(svg);
    const W = 500,
      H = 500;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const scale = 220 / d.m;
    const g = svgEl("g", { transform: `translate(${W / 2},${H * 0.7})` });
    svg.appendChild(g);

    const outerR = gen.circ.outerRadius;
    const csOuter = HDMath.circlePoints(outerR, 0, 0, 400);
    const csPath = svgEl("path", {
      d: loopToPathD(csOuter, scale, 0) + " " + loopToPathD(gen.circ.inner, scale, 0),
      "fill-rule": "evenodd",
    });
    csPath.style.fill = "var(--cs-fill)";
    csPath.style.stroke = "var(--cs-stroke)";
    csPath.style.strokeWidth = "1.2";
    g.appendChild(csPath);

    const rot = ((num(els.rotation, 0) || 0) * Math.PI) / 180;
    const bore = HDMath.circlePoints(gen.flex.rootRadius - d.wallFlex, 0, 0, 400);
    const fsPath = svgEl("path", {
      d: loopToPathD(gen.flex.outer, scale, rot) + " " + loopToPathD(bore, scale, rot),
      "fill-rule": "evenodd",
    });
    fsPath.style.fill = "var(--fs-fill)";
    fsPath.style.stroke = "var(--fs-stroke)";
    fsPath.style.strokeWidth = "1.2";
    fsPath.style.opacity = "0.92";
    g.appendChild(fsPath);
  }

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

  function wireDownloads(d, gen) {
    els.dlCS.onclick = () => {
      const outer = HDMath.circlePoints(gen.circ.outerRadius, 0, 0, 360);
      const dxf = DXFWriter.buildDXF([
        { layer: "CS_OUTER", loops: [outer] },
        { layer: "CS_SLOT", loops: [gen.circ.inner] },
      ]);
      download("circular_spline.dxf", dxf);
    };

    els.dlFS.onclick = () => {
      const bore = HDMath.circlePoints(gen.flex.rootRadius - d.wallFlex, 0, 0, 360);
      const dxf = DXFWriter.buildDXF([
        { layer: "FS_TEETH", loops: [gen.flex.outer] },
        { layer: "FS_BORE", loops: [bore] },
      ]);
      download("flexspline.dxf", dxf);
    };

    els.dlWG.onclick = () => {
      const wg = HDMath.waveGeneratorCam(d, 360);
      const dxf = DXFWriter.buildDXF([{ layer: "WG_CAM", loops: [wg] }]);
      download("wave_generator_cam.dxf", dxf);
    };

    els.dlAll.onclick = () => {
      const csOuter = HDMath.circlePoints(gen.circ.outerRadius, 0, 0, 360);
      const fsBore = HDMath.circlePoints(gen.flex.rootRadius - d.wallFlex, 0, 0, 360);
      const wg = HDMath.waveGeneratorCam(d, 360);
      const dxf = DXFWriter.buildDXF([
        { layer: "CS_OUTER", loops: [csOuter] },
        { layer: "CS_SLOT", loops: [gen.circ.inner] },
        { layer: "FS_TEETH", loops: [gen.flex.outer] },
        { layer: "FS_BORE", loops: [fsBore] },
        { layer: "WG_CAM", loops: [wg] },
      ]);
      download("harmonic_drive_full.dxf", dxf);
    };
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  els.zf.addEventListener("input", () => {
    linkRatio(false);
    scheduleRender();
  });
  els.zc.addEventListener("input", () => {
    linkRatio(false);
    scheduleRender();
  });
  els.ratio.addEventListener("input", () => {
    linkRatio(true);
    scheduleRender();
  });

  [
    els.module,
    els.w0,
    els.ha,
    els.hd,
    els.toothAngle,
    els.toothThickness,
    els.rootFillet,
    els.clearance,
    els.wallFlex,
    els.wallCirc,
  ].forEach((el) => el && el.addEventListener("input", scheduleRender));

  els.rotation.addEventListener("input", () => {
    els.rotationVal.textContent = els.rotation.value + "°";
    scheduleRender();
  });

  linkRatio(false);
  render();
})();
