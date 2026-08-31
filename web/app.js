(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    m: $("#in-m"),
    OD: $("#in-od"),
    ID: $("#in-id"),
    haStar: $("#in-ha"),
    hfStar: $("#in-hf"),
    w0Star: $("#in-w0"),
    csRim: $("#in-csrim"),
    toothDiff: $("#in-toothdiff"),
    rotation: $("#in-rotation"),
    rotationVal: $("#in-rotation-val"),
    resultGrid: $("#result-grid"),
    warnings: $("#warnings"),
    svgMain: $("#svg-main"),
    svgDetail: $("#svg-detail"),
    dlCS: $("#dl-cs"),
    dlFS: $("#dl-fs"),
    dlWG: $("#dl-wg"),
    dlAll: $("#dl-all"),
  };

  let lastParams = null;

  function num(el, fallback) {
    const v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  }

  function readInputs() {
    return {
      m: num(els.m, 1.0),
      OD: num(els.OD, 120),
      ID: num(els.ID, 109),
      haStar: num(els.haStar, 1.0),
      hfStar: num(els.hfStar, 1.25),
      w0Star: num(els.w0Star, 1.0),
      csRim: num(els.csRim, 3.0) * num(els.m, 1.0),
      toothDiff: Math.max(2, Math.round(num(els.toothDiff, 2))),
    };
  }

  // ------------------------------------------------------------------
  // SVG helpers
  // ------------------------------------------------------------------

  function fmt(n) {
    return n.toFixed(3);
  }

  function loopToPathD(loop, scale, rotAngle) {
    const c = Math.cos(rotAngle),
      s = Math.sin(rotAngle);
    let d = "";
    loop.forEach((pt, i) => {
      const rx = pt.x * c - pt.y * s;
      const ry = pt.x * s + pt.y * c;
      const X = (rx * scale).toFixed(2);
      const Y = (-ry * scale).toFixed(2); // flip Y for SVG
      d += (i === 0 ? "M" : "L") + X + "," + Y + " ";
    });
    return d + "Z";
  }

  function circlePathD(r, scale) {
    const R = r * scale;
    return `M ${R},0 A ${R},${R} 0 1 0 ${-R},0 A ${R},${R} 0 1 0 ${R},0 Z`;
  }

  function buildRingPath(loops, scale, rotAngle) {
    return loops.map((loop) => loopToPathD(loop, scale, rotAngle)).join(" ");
  }

  function svgEl(tag, attrs) {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function clear(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  // ------------------------------------------------------------------
  // Main render
  // ------------------------------------------------------------------

  function render() {
    const input = readInputs();
    const p = HDMath.deriveHDParams(input);
    lastParams = p;

    renderResults(p);
    renderWarnings(p);
    renderMainSvg(p);
    renderDetailSvg(p);
    wireDownloads(p);
  }

  function renderResults(p) {
    const rows = [
      ["감속비 (N = z1/2)", p.ratio.toFixed(2) + " : 1", true],
      ["FS 잇수 (z1)", p.z1, false],
      ["CS 잇수 (z2)", p.z2, false],
      ["FS 피치 반경 (R1)", fmt(p.R1) + " mm", false],
      ["CS 피치 반경 (R2)", fmt(p.R2) + " mm", false],
      ["FS 이끝원 반경 (Ra1)", fmt(p.Ra1) + " mm", false],
      ["CS 이끝원 반경 (Ra2)", fmt(p.Ra2) + " mm", false],
      ["FS 이뿌리원 반경 (Rf1)", fmt(p.Rf1) + " mm", false],
      ["CS 이뿌리원 반경 (Rf2)", fmt(p.Rf2) + " mm", false],
      ["FS 벽 두께", fmt(p.wallFS) + " mm", false],
      ["FS 중립선 반경 (rm)", fmt(p.rm) + " mm", false],
      ["WG 장축 반경 (ρa)", fmt(p.rhoA) + " mm", false],
      ["WG 단축 반경 (ρb)", fmt(p.rhoB) + " mm", false],
      ["CS 구조 외경", fmt(p.csOuterActual) + " mm", false],
      ["FS 내경(보어)", fmt(p.ID) + " mm", false],
    ];
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
    if (!p.feasible) {
      const d = document.createElement("div");
      d.className = "error";
      d.textContent = "✕ 현재 입력 조합으로는 기하학적으로 성립하지 않는 하모닉 드라이브입니다. 모듈/외경/내경을 조정해주세요.";
      els.warnings.appendChild(d);
    }
  }

  const mainFit = ViewFit.make(),
    detailFit = ViewFit.make();

  function renderMainSvg(p) {
    const svg = els.svgMain;
    clear(svg);
    const W = 900,
      H = 900;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const scale = ViewFit.fit(mainFit, W, 0.46, p.csOuterActual / 2, 0, 0).scale;
    const g = svgEl("g", { transform: `translate(${W / 2},${H / 2})` });
    svg.appendChild(g);

    const rot = ((num(els.rotation, 0) || 0) * Math.PI) / 180;
    // wave generator rotates the FS deformation pattern; here we simply spin
    // the FS ring itself for an illustrative "meshing position" preview.
    const nSegDisplay = p.z2 > 140 ? 6 : p.z2 > 60 ? 10 : 16;

    // CS: outer circle + inner (addendum) circle + notches, evenodd
    const csOuter = HDMath.circlePoints(p.csOuterActual / 2, 220);
    const csInner = HDMath.circlePoints(p.Ra2, 220);
    const csNotches = HDMath.buildCSRingTeethPoints(p, nSegDisplay, 0);
    const csPath = svgEl("path", {
      d: buildRingPath([csOuter, csInner, ...csNotches], scale, 0),
      "fill-rule": "evenodd",
      class: "cs-fill",
    });
    csPath.style.fill = "var(--cs-fill)";
    csPath.style.stroke = "var(--cs-stroke)";
    csPath.style.strokeWidth = "1";
    g.appendChild(csPath);

    // FS: hub circle (root) + bore circle + teeth, evenodd, rotated by `rot`
    const fsHub = HDMath.circlePoints(p.Rf1, 220);
    const fsBore = HDMath.circlePoints(p.bore, 220);
    const fsTeeth = HDMath.buildFSRingTeethPoints(p, nSegDisplay, 0);
    const fsPath = svgEl("path", {
      d: buildRingPath([fsHub, fsBore, ...fsTeeth], scale, rot),
      "fill-rule": "evenodd",
    });
    fsPath.style.fill = "var(--fs-fill)";
    fsPath.style.stroke = "var(--fs-stroke)";
    fsPath.style.strokeWidth = "1";
    fsPath.style.opacity = "0.92";
    g.appendChild(fsPath);

    // Wave generator cam outline
    const wg = HDMath.buildWaveGeneratorCam(p, 240);
    const wgPath = svgEl("path", {
      d: loopToPathD(wg, scale, rot),
      fill: "none",
    });
    wgPath.style.stroke = "var(--wg-stroke)";
    wgPath.style.strokeWidth = "1.4";
    wgPath.style.strokeDasharray = "4 3";
    g.appendChild(wgPath);

    // reference pitch circles (dashed, thin)
    for (const r of [p.R1, p.R2]) {
      const c = svgEl("path", { d: circlePathD(r, scale), fill: "none" });
      c.style.stroke = "#ffffff33";
      c.style.strokeWidth = "0.75";
      c.style.strokeDasharray = "2 4";
      g.appendChild(c);
    }
  }

  function renderDetailSvg(p) {
    const svg = els.svgDetail;
    clear(svg);
    const W = 500,
      H = 500;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    // zoom on a handful of teeth near the top (angle 0) — steady across edits
    const scale = ViewFit.fit(detailFit, W, 0.52, p.m, 0, 0).scale;
    const g = svgEl("g", { transform: `translate(${W / 2},${H * 0.72})` });
    svg.appendChild(g);

    const nTeeth = 3;
    const csOuter = HDMath.circlePoints(p.csOuterActual / 2, 400);
    const csInner = HDMath.circlePoints(p.Ra2, 400);
    const csAll = HDMath.buildCSRingTeethPoints(p, 40, 0);
    const csSubset = [];
    for (let k = -nTeeth; k <= nTeeth; k++) {
      csSubset.push(csAll[((k % p.z2) + p.z2) % p.z2]);
    }
    const csPath = svgEl("path", {
      d: buildRingPath([csOuter, csInner, ...csSubset], scale, 0),
      "fill-rule": "evenodd",
    });
    csPath.style.fill = "var(--cs-fill)";
    csPath.style.stroke = "var(--cs-stroke)";
    csPath.style.strokeWidth = "1.2";
    g.appendChild(csPath);

    const rot = ((num(els.rotation, 0) || 0) * Math.PI) / 180;
    const fsHub = HDMath.circlePoints(p.Rf1, 400);
    const fsBore = HDMath.circlePoints(p.bore, 400);
    const fsAll = HDMath.buildFSRingTeethPoints(p, 40, 0);
    const fsSubset = [];
    for (let k = -nTeeth; k <= nTeeth; k++) {
      fsSubset.push(fsAll[((k % p.z1) + p.z1) % p.z1]);
    }
    const fsPath = svgEl("path", {
      d: buildRingPath([fsHub, fsBore, ...fsSubset], scale, rot),
      "fill-rule": "evenodd",
    });
    fsPath.style.fill = "var(--fs-fill)";
    fsPath.style.stroke = "var(--fs-stroke)";
    fsPath.style.strokeWidth = "1.2";
    fsPath.style.opacity = "0.92";
    g.appendChild(fsPath);
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

  function wireDownloads(p) {
    const nSegDxf = 24;

    els.dlCS.onclick = () => {
      const outer = HDMath.circlePoints(p.csOuterActual / 2, 360);
      const inner = HDMath.circlePoints(p.Ra2, 360);
      const notches = HDMath.buildCSRingTeethPoints(p, nSegDxf, 0);
      const dxf = DXFWriter.buildDXF([
        { layer: "CS_OUTER", loops: [outer] },
        { layer: "CS_ADDENDUM", loops: [inner] },
        { layer: "CS_TEETH", loops: notches },
      ]);
      download("circular_spline.dxf", dxf);
    };

    els.dlFS.onclick = () => {
      const hub = HDMath.circlePoints(p.Rf1, 360);
      const bore = HDMath.circlePoints(p.bore, 360);
      const teeth = HDMath.buildFSRingTeethPoints(p, nSegDxf, 0);
      const dxf = DXFWriter.buildDXF([
        { layer: "FS_ROOT", loops: [hub] },
        { layer: "FS_BORE", loops: [bore] },
        { layer: "FS_TEETH", loops: teeth },
      ]);
      download("flexspline.dxf", dxf);
    };

    els.dlWG.onclick = () => {
      const wg = HDMath.buildWaveGeneratorCam(p, 360);
      const dxf = DXFWriter.buildDXF([{ layer: "WG_CAM", loops: [wg] }]);
      download("wave_generator_cam.dxf", dxf);
    };

    els.dlAll.onclick = () => {
      const csOuter = HDMath.circlePoints(p.csOuterActual / 2, 360);
      const csInner = HDMath.circlePoints(p.Ra2, 360);
      const csNotches = HDMath.buildCSRingTeethPoints(p, nSegDxf, 0);
      const fsHub = HDMath.circlePoints(p.Rf1, 360);
      const fsBore = HDMath.circlePoints(p.bore, 360);
      const fsTeeth = HDMath.buildFSRingTeethPoints(p, nSegDxf, 0);
      const wg = HDMath.buildWaveGeneratorCam(p, 360);
      const dxf = DXFWriter.buildDXF([
        { layer: "CS_OUTER", loops: [csOuter] },
        { layer: "CS_ADDENDUM", loops: [csInner] },
        { layer: "CS_TEETH", loops: csNotches },
        { layer: "FS_ROOT", loops: [fsHub] },
        { layer: "FS_BORE", loops: [fsBore] },
        { layer: "FS_TEETH", loops: fsTeeth },
        { layer: "WG_CAM", loops: [wg] },
      ]);
      download("harmonic_drive_full.dxf", dxf);
    };
  }

  // ------------------------------------------------------------------
  // Wire up inputs
  // ------------------------------------------------------------------

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  [els.m, els.OD, els.ID, els.haStar, els.hfStar, els.w0Star, els.csRim, els.toothDiff].forEach(
    (el) => el && el.addEventListener("input", scheduleRender)
  );

  els.rotation.addEventListener("input", () => {
    els.rotationVal.textContent = els.rotation.value + "°";
    scheduleRender();
  });

  // double-click a preview to re-fit it to the current geometry
  [els.svgMain, els.svgDetail].forEach((svg, i) =>
    svg.addEventListener("dblclick", () => {
      ViewFit.reset(i === 0 ? mainFit : detailFit);
      render();
    })
  );

  render();
})();
