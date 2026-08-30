(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const els = {
    module: $("#pl-module"),
    sun: $("#pl-sun"),
    planet: $("#pl-planet"),
    count: $("#pl-count"),
    config: $("#pl-config"),
    drive: $("#pl-drive"),
    driveVal: $("#pl-drive-val"),
    play: $("#pl-play"),
    resultGrid: $("#pl-result-grid"),
    warnings: $("#pl-warnings"),
    svgMain: $("#pl-svg-main"),
    svgDetail: $("#pl-svg-detail"),
    dlSun: $("#pl-dl-sun"),
    dlPlanet: $("#pl-dl-planet"),
    dlRing: $("#pl-dl-ring"),
    dlAll: $("#pl-dl-all"),
  };
  if (!els.sun) return;

  const ALPHA = (20 * Math.PI) / 180;
  const TAU = 2 * Math.PI;

  function num(el, fb) {
    const v = parseFloat(el.value);
    return isFinite(v) ? v : fb;
  }

  function readInputs() {
    return {
      m: num(els.module, 1.5),
      Zs: Math.max(8, Math.round(num(els.sun, 16))),
      Zp: Math.max(8, Math.round(num(els.planet, 16))),
      Np: Math.max(2, Math.round(num(els.count, 3))),
      config: els.config.value,
    };
  }

  function derive(inp) {
    const { m, Zs, Zp, Np, config } = inp;
    const Zr = Zs + 2 * Zp;
    const rs = (m * Zs) / 2;
    const rp = (m * Zp) / 2;
    const rr = (m * Zr) / 2;
    const Rc = rs + rp; // planet orbit radius = carrier arm length
    const ringOuter = rr + 1.25 * m + 2 * m;

    const warnings = [];
    if ((Zs + Zr) % Np !== 0)
      warnings.push(
        `조립 조건 불만족: (Zs+Zr)=${Zs + Zr} 가 유성 개수 ${Np}로 나누어 떨어지지 않습니다. 유성이 모두 동시에 맞물리지 않습니다.`
      );
    // adjacent planet clearance
    const chord = 2 * Rc * Math.sin(Math.PI / Np);
    if (chord <= 2 * (rp + m))
      warnings.push(`유성기어끼리 간섭합니다 — 유성 개수를 줄이거나 잇수를 조정하세요.`);
    if (Zp < 12) warnings.push(`유성 잇수 ${Zp} 가 작아 언더컷이 생길 수 있습니다.`);

    let ratioText, ratioNum;
    if (config === "ring") {
      ratioNum = 1 + Zr / Zs;
      ratioText = `1 : ${ratioNum.toFixed(3)} (링 고정)`;
    } else if (config === "sun") {
      ratioNum = 1 + Zs / Zr;
      ratioText = `1 : ${ratioNum.toFixed(3)} (선 고정)`;
    } else {
      ratioNum = -Zr / Zs;
      ratioText = `1 : ${Math.abs(ratioNum).toFixed(3)} (캐리어 고정, 역전)`;
    }

    return { m, Zs, Zp, Zr, Np, config, rs, rp, rr, Rc, ringOuter, ratioText, ratioNum, warnings };
  }

  // Kinematics: returns sun body angle (θs) and carrier angle (γ) for the
  // given drive angle D under the chosen fixed member.
  function kinematics(p, D) {
    const { Zs, Zr, config } = p;
    if (config === "ring") return { thetaS: D, gamma: (D * Zs) / (Zs + Zr) };
    if (config === "sun") return { thetaS: 0, gamma: (D * Zr) / (Zs + Zr) };
    return { thetaS: D, gamma: 0 }; // carrier fixed
  }

  // Instantaneous external-mesh clock of a planet meshing the sun.
  function planetPhase(p, beta, thetaS) {
    return beta + Math.PI - Math.PI / p.Zp + (p.Zs / p.Zp) * (beta - thetaS);
  }

  // Ring body clock so the internal ring meshes planet 0 (holds for all
  // planets when the assembly condition is met).
  function ringPhase(p, beta0, phiP0) {
    return beta0 - (p.Zp / p.Zr) * (beta0 - phiP0) - Math.PI / p.Zr;
  }

  // ---- SVG helpers ----
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
      d += (i ? "L" : "M") + (pt.x * scale).toFixed(2) + "," + (-pt.y * scale).toFixed(2) + " ";
    });
    return d + "Z";
  }
  function circlePathD(r, cx, cy, scale) {
    const R = r * scale,
      CX = (cx || 0) * scale,
      CY = -(cy || 0) * scale;
    return `M ${CX + R},${CY} A ${R},${R} 0 1 0 ${CX - R},${CY} A ${R},${R} 0 1 0 ${CX + R},${CY} Z`;
  }
  function fill(g, d, fillVar, strokeVar, sw, opacity, evenodd) {
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

  function planetCenters(p, gamma) {
    const arr = [];
    for (let k = 0; k < p.Np; k++) {
      const beta = gamma + (k * TAU) / p.Np;
      arr.push({ beta, x: p.Rc * Math.cos(beta), y: p.Rc * Math.sin(beta) });
    }
    return arr;
  }

  function buildScene(g, p, scale, D) {
    const opt = { alpha: ALPHA };
    const { thetaS, gamma } = kinematics(p, D);
    const centers = planetCenters(p, gamma);

    // ring: outer circle + internal involute (even-odd => annulus with teeth)
    const beta0 = centers[0].beta;
    const phiP0 = planetPhase(p, beta0, thetaS);
    const phiR = ringPhase(p, beta0, phiP0);
    const ringInner = Involute.involuteRing(p.Zr, p.m, phiR, 0, 0, opt);
    const ringOuterLoop = Involute.circlePoints(p.ringOuter, 0, 0, 260);
    fill(g, loopToPathD(ringOuterLoop, scale) + " " + loopToPathD(ringInner, scale), "--wg-fill", "--wg-stroke", "1.2", "0.95", true);

    // carrier arms (behind gears)
    for (const c of centers) {
      const arm = svgEl("line", {
        x1: 0,
        y1: 0,
        x2: (c.x * scale).toFixed(2),
        y2: (-c.y * scale).toFixed(2),
      });
      arm.style.stroke = "var(--accent2)";
      arm.style.strokeWidth = "6";
      arm.style.strokeLinecap = "round";
      arm.style.opacity = "0.5";
      g.appendChild(arm);
    }
    const hub = svgEl("path", { d: circlePathD(p.rs * 0.5, 0, 0, scale) });
    hub.style.fill = "var(--accent2)";
    hub.style.opacity = "0.5";
    g.appendChild(hub);

    // sun
    fill(g, loopToPathD(Involute.involuteGear(p.Zs, p.m, thetaS, 0, 0, opt), scale), "--cs-fill", "--cs-stroke", "1.2");

    // planets
    for (const c of centers) {
      const phiP = planetPhase(p, c.beta, thetaS);
      fill(g, loopToPathD(Involute.involuteGear(p.Zp, p.m, phiP, c.x, c.y, opt), scale), "--fs-fill", "--fs-stroke", "1.2");
      // planet centre pin
      const pin = svgEl("path", { d: circlePathD(p.m * 0.6, c.x, c.y, scale) });
      pin.style.fill = "var(--accent2)";
      pin.style.opacity = "0.7";
      g.appendChild(pin);
    }
  }

  function renderMain(p, D) {
    const svg = els.svgMain;
    clear(svg);
    const W = 900,
      H = 900;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const scale = (W * 0.47) / p.ringOuter;
    const g = svgEl("g", { transform: `translate(${W / 2},${H / 2})` });
    svg.appendChild(g);
    buildScene(g, p, scale, D);
  }

  function renderDetail(p, D) {
    const svg = els.svgDetail;
    clear(svg);
    const W = 500,
      H = 500;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const scale = (W * 0.5) / (8 * p.m);
    const { gamma } = kinematics(p, D);
    // focus on the sun-planet 0 contact (pitch point at radius rs along beta0)
    const beta0 = gamma;
    const fx = p.rs * Math.cos(beta0),
      fy = p.rs * Math.sin(beta0);
    const g = svgEl("g", { transform: `translate(${W / 2 - fx * scale},${H / 2 + fy * scale})` });
    svg.appendChild(g);
    buildScene(g, p, scale, D);
  }

  function renderResults(p) {
    const rows = [
      ["구성", configLabel(p.config), true],
      ["감속비", p.ratioText, true],
      ["선기어 잇수 (Zs)", p.Zs, false],
      ["유성기어 잇수 (Zp)", p.Zp, false],
      ["링기어 잇수 (Zr=Zs+2Zp)", p.Zr, false],
      ["유성기어 개수", p.Np, false],
      ["모듈", p.m.toFixed(3) + " mm", false],
      ["선 피치 반경", p.rs.toFixed(3) + " mm", false],
      ["유성 피치 반경", p.rp.toFixed(3) + " mm", false],
      ["링 피치 반경", p.rr.toFixed(3) + " mm", false],
      ["캐리어 반경 (Rc)", p.Rc.toFixed(3) + " mm", false],
    ];
    els.resultGrid.innerHTML = rows
      .map(([k, v, hl]) => `<div class="row${hl ? " hl" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`)
      .join("");
  }

  function configLabel(c) {
    return c === "ring" ? "링 고정" : c === "sun" ? "선 고정" : "캐리어 고정";
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

  // ---- DXF ----
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
  function sunLayers(p) {
    return [{ layer: "SUN", loops: [Involute.involuteGear(p.Zs, p.m, 0, 0, 0, { alpha: ALPHA })] }];
  }
  function planetLayers(p) {
    return [{ layer: "PLANET", loops: [Involute.involuteGear(p.Zp, p.m, 0, 0, 0, { alpha: ALPHA })] }];
  }
  function ringLayers(p) {
    return [
      { layer: "RING_OUTER", loops: [Involute.circlePoints(p.ringOuter, 0, 0, 360)] },
      { layer: "RING_TEETH", loops: [Involute.involuteRing(p.Zr, p.m, 0, 0, 0, { alpha: ALPHA })] },
    ];
  }
  function assemblyLayers(p) {
    // all parts in one file at drive=0 assembled positions
    const { thetaS, gamma } = kinematics(p, 0);
    const centers = planetCenters(p, gamma);
    const layers = [...sunLayers(p), ...ringLayers(p)];
    centers.forEach((c, i) => {
      const phiP = planetPhase(p, c.beta, thetaS);
      layers.push({ layer: "PLANET_" + (i + 1), loops: [Involute.involuteGear(p.Zp, p.m, phiP, c.x, c.y, { alpha: ALPHA })] });
    });
    return layers;
  }
  function wireDownloads(p) {
    els.dlSun.onclick = () => download("planetary_sun.dxf", DXFWriter.buildDXF(sunLayers(p)));
    els.dlPlanet.onclick = () => download("planetary_planet.dxf", DXFWriter.buildDXF(planetLayers(p)));
    els.dlRing.onclick = () => download("planetary_ring.dxf", DXFWriter.buildDXF(ringLayers(p)));
    els.dlAll.onclick = () => download("planetary_set_full.dxf", DXFWriter.buildDXF(assemblyLayers(p)));
  }

  // ---- render + animation ----
  let currentP = null;
  function driveRad() {
    return (num(els.drive, 0) * Math.PI) / 180;
  }
  function redraw() {
    if (!currentP) return;
    renderMain(currentP, driveRad());
    renderDetail(currentP, driveRad());
  }
  function render() {
    const p = derive(readInputs());
    currentP = p;
    renderResults(p);
    renderWarnings(p);
    redraw();
    wireDownloads(p);
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }
  [els.module, els.sun, els.planet, els.count, els.config].forEach(
    (el) => el && el.addEventListener("input", scheduleRender)
  );
  els.drive.addEventListener("input", () => {
    els.driveVal.textContent = els.drive.value + "°";
    redraw();
  });

  let playing = false,
    rafId = null,
    lastT = 0;
  function tick(t) {
    if (!playing) return;
    if (!lastT) lastT = t;
    const dt = (t - lastT) / 1000;
    lastT = t;
    let v = num(els.drive, 0) + dt * 40;
    v = ((v % 360) + 360) % 360;
    els.drive.value = v.toFixed(1);
    els.driveVal.textContent = Math.round(v) + "°";
    redraw();
    rafId = requestAnimationFrame(tick);
  }
  els.play.addEventListener("click", () => {
    playing = !playing;
    els.play.textContent = playing ? "⏸ 정지" : "▶ 재생";
    if (playing) {
      lastT = 0;
      rafId = requestAnimationFrame(tick);
    } else if (rafId) cancelAnimationFrame(rafId);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playing) {
      playing = false;
      els.play.textContent = "▶ 재생";
      if (rafId) cancelAnimationFrame(rafId);
    }
  });

  render();
})();
