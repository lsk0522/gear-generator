(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    ratio: $("#cy-ratio"),
    R: $("#cy-R"),
    Rr: $("#cy-Rr"),
    E: $("#cy-E"),
    thickness: $("#cy-thickness"),
    bore: $("#cy-bore"),
    holeCount: $("#cy-holecount"),
    holePcd: $("#cy-holepcd"),
    holeDia: $("#cy-holedia"),
    tolDisc: $("#cy-toldisc"),
    points: $("#cy-points"),
    resultGrid: $("#cy-result-grid"),
    warnings: $("#cy-warnings"),
    svgMain: $("#cy-svg-main"),
    svgDetail: $("#cy-svg-detail"),
    dlDisc: $("#cy-dl-disc"),
    dlRing: $("#cy-dl-ring"),
    dlAll: $("#cy-dl-all"),
  };

  if (!els.ratio) return; // panel not present

  function num(el, fallback) {
    const v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  }

  function readInputs() {
    return {
      ratio: Math.round(num(els.ratio, 11)),
      pinR: num(els.R, 30),
      rollerR: num(els.Rr, 3),
      ecc: num(els.E, 1.5),
      thickness: num(els.thickness, 5),
      boreDia: num(els.bore, 15),
      holeCount: Math.round(num(els.holeCount, 6)),
      holePcdR: num(els.holePcd, 18),
      holePinDia: num(els.holeDia, 6),
      tolDisc: num(els.tolDisc, 0.1),
      points: Math.round(num(els.points, 360)),
    };
  }

  function fmt(n) {
    return n.toFixed(3);
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

  function circlePathD(r, cx, cy, scale) {
    const R = r * scale,
      CX = cx * scale,
      CY = -cy * scale;
    return `M ${CX + R},${CY} A ${R},${R} 0 1 0 ${CX - R},${CY} A ${R},${R} 0 1 0 ${CX + R},${CY} Z`;
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
    const p = CycloMath.deriveParams(input);

    renderResults(p);
    renderWarnings(p);
    renderMainSvg(p);
    renderDetailSvg(p);
    wireDownloads(p);
  }

  function renderResults(p) {
    const rows = [
      ["감속비", "1 : " + p.ratio, true],
      ["핀 개수 (N)", p.N, false],
      ["로브 수 (N-1)", p.lobes, false],
      ["핀 피치원 반지름 (R)", fmt(p.R) + " mm", false],
      ["핀/롤러 반지름 (Rr)", fmt(p.Rr) + " mm", false],
      ["편심량 (E)", fmt(p.E) + " mm", false],
      ["핀 간 피치(호 길이)", fmt(p.pinPitch) + " mm", false],
      ["디스크 최대 반경", fmt(p.R + p.Rr) + " mm 근방", false],
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
      d.className = p.feasible ? "warning" : "error";
      d.textContent = (p.feasible ? "⚠ " : "✕ ") + w;
      els.warnings.appendChild(d);
    }
  }

  function buildSceneSvg(svg, p, W, H, scale, showBore) {
    clear(svg);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const g = svgEl("g", { transform: `translate(${W / 2},${H / 2})` });
    svg.appendChild(g);

    const disc = CycloMath.discOutline(p, false);
    const discPath = svgEl("path", { d: loopToPathD(disc, scale) });
    discPath.style.fill = "var(--cs-fill)";
    discPath.style.stroke = "var(--cs-stroke)";
    discPath.style.strokeWidth = "1.2";
    g.appendChild(discPath);

    if (showBore) {
      const bore = svgEl("path", { d: circlePathD(p.boreDia / 2, 0, 0, scale), fill: "none" });
      bore.style.stroke = "#ffffff55";
      bore.style.strokeWidth = "1";
      bore.style.strokeDasharray = "3 3";
      g.appendChild(bore);

      for (const h of CycloMath.outputHoleCenters(p)) {
        const c = svgEl("path", { d: circlePathD(h.r, h.x, h.y, scale), fill: "none" });
        c.style.stroke = "#ffffff55";
        c.style.strokeWidth = "1";
        g.appendChild(c);
      }
    }

    for (const pin of CycloMath.pinCenters(p)) {
      const c = svgEl("path", { d: circlePathD(pin.r, pin.x, pin.y, scale) });
      c.style.fill = "var(--fs-fill)";
      c.style.stroke = "var(--fs-stroke)";
      c.style.strokeWidth = "1";
      c.style.opacity = "0.9";
      g.appendChild(c);
    }

    return g;
  }

  function renderMainSvg(p) {
    const W = 900,
      H = 900;
    const extent = p.R + p.Rr + 4;
    const scale = (W * 0.46) / extent;
    buildSceneSvg(els.svgMain, p, W, H, scale, true);
  }

  function renderDetailSvg(p) {
    const W = 500,
      H = 500;
    // zoom on one lobe near the top
    const scale = (W * 0.42) / (2 * (p.Rr + Math.abs(p.E) + 1));
    clear(els.svgDetail);
    els.svgDetail.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const disc = CycloMath.discOutline(p, false);
    // find the point nearest angle 0 (top lobe) to center the view on it
    let best = disc[0],
      bestD = Infinity;
    for (const pt of disc) {
      const d = Math.abs(Math.atan2(pt.x, pt.y));
      if (d < bestD) {
        bestD = d;
        best = pt;
      }
    }
    const g = svgEl("g", {
      transform: `translate(${W / 2 - best.x * scale},${H / 2 + best.y * scale})`,
    });
    els.svgDetail.appendChild(g);
    const discPath = svgEl("path", { d: loopToPathD(disc, scale) });
    discPath.style.fill = "var(--cs-fill)";
    discPath.style.stroke = "var(--cs-stroke)";
    discPath.style.strokeWidth = "1.5";
    g.appendChild(discPath);
    for (const pin of CycloMath.pinCenters(p)) {
      const c = svgEl("path", { d: circlePathD(pin.r, pin.x, pin.y, scale) });
      c.style.fill = "var(--fs-fill)";
      c.style.stroke = "var(--fs-stroke)";
      c.style.strokeWidth = "1.2";
      c.style.opacity = "0.9";
      g.appendChild(c);
    }
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

  function wireDownloads(p) {
    els.dlDisc.onclick = () => {
      const disc = CycloMath.discOutline(p, false);
      const dxf = DXFWriter.buildDXF([
        { layer: "DISC", loops: [disc.map((pt) => ({ x: pt.x, y: pt.y }))] },
        { layer: "BORE", loops: [CycloMath.circlePoints(p.boreDia / 2, 0, 0, 180)] },
      ]);
      download("cycloidal_disc.dxf", dxf);
    };

    els.dlRing.onclick = () => {
      const loops = CycloMath.pinCenters(p).map((c) => CycloMath.circlePoints(c.r, c.x, c.y, 90));
      const dxf = DXFWriter.buildDXF([{ layer: "PINS", loops }]);
      download("pin_ring.dxf", dxf);
    };

    els.dlAll.onclick = () => {
      const disc = CycloMath.discOutline(p, false);
      const pinLoops = CycloMath.pinCenters(p).map((c) => CycloMath.circlePoints(c.r, c.x, c.y, 90));
      const holeLoops = CycloMath.outputHoleCenters(p).map((c) =>
        CycloMath.circlePoints(c.r, c.x, c.y, 60)
      );
      const dxf = DXFWriter.buildDXF([
        { layer: "DISC", loops: [disc] },
        { layer: "BORE", loops: [CycloMath.circlePoints(p.boreDia / 2, 0, 0, 180)] },
        { layer: "OUTPUT_HOLES", loops: holeLoops },
        { layer: "PINS", loops: pinLoops },
      ]);
      download("cycloidal_drive_full.dxf", dxf);
    };
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  [
    els.ratio,
    els.R,
    els.Rr,
    els.E,
    els.thickness,
    els.bore,
    els.holeCount,
    els.holePcd,
    els.holeDia,
    els.tolDisc,
    els.points,
  ].forEach((el) => el && el.addEventListener("input", scheduleRender));

  render();
})();
