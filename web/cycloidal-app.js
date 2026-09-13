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
    makeBore: $("#cy-makebore"),
    tolBore: $("#cy-tolbore"),
    holeCount: $("#cy-holecount"),
    makeHoles: $("#cy-makeholes"),
    holePcd: $("#cy-holepcd"),
    holeDia: $("#cy-holedia"),
    tolHole: $("#cy-tolhole"),
    tolDisc: $("#cy-toldisc"),
    tolPin: $("#cy-tolpin"),
    makeRing: $("#cy-makering"),
    pinMargin: $("#cy-pinmargin"),
    twin: $("#cy-twin"),
    gap: $("#cy-gap"),
    makeShaft: $("#cy-makeshaft"),
    shaftDia: $("#cy-shaftdia"),
    journalDia: $("#cy-journaldia"),
    points: $("#cy-points"),
    resultGrid: $("#cy-result-grid"),
    warnings: $("#cy-warnings"),
    drive: $("#cy-drive"),
    driveVal: $("#cy-drive-val"),
    play: $("#cy-play"),
    svgMain: $("#cy-svg-main"),
    svgDetail: $("#cy-svg-detail"),
    dlDisc: $("#cy-dl-disc"),
    dlRing: $("#cy-dl-ring"),
    dlShaft: $("#cy-dl-shaft"),
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
      makeBore: els.makeBore.checked,
      tolBore: num(els.tolBore, 0.05),
      holeCount: Math.round(num(els.holeCount, 6)),
      makeHoles: els.makeHoles.checked,
      holePcdR: num(els.holePcd, 18),
      holePinDia: num(els.holeDia, 6),
      tolHole: num(els.tolHole, 0.1),
      tolDisc: num(els.tolDisc, 0.1),
      tolPin: num(els.tolPin, 0),
      makeRing: els.makeRing.checked,
      pinLenMargin: num(els.pinMargin, 2),
      twin: els.twin.checked,
      gap: num(els.gap, 1),
      makeShaft: els.makeShaft.checked,
      shaftDia: num(els.shaftDia, 11),
      journalDia: num(els.journalDia, 14),
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

  // Rigid-body pose of the disc at eccentric (input) angle theta:
  // its centre orbits on radius E, and it counter-rotates 1/(N-1) as fast.
  // phase180 shifts the orbit by 180° (the second disc of a twin stack).
  function discPose(p, theta, phase180) {
    const t = phase180 ? theta + Math.PI : theta;
    return { cx: p.E * Math.cos(t), cy: p.E * Math.sin(t), phi: -theta / (p.N - 1) };
  }

  let currentP = null;
  let playing = false;

  function driveRad() {
    return (num(els.drive, 0) * Math.PI) / 180;
  }

  function redrawGeometry() {
    if (!currentP) return;
    renderMainSvg(currentP);
    renderDetailSvg(currentP);
  }

  function render() {
    const input = readInputs();
    const p = CycloMath.deriveParams(input);
    currentP = p;

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
      ["2단 디스크(twin)", p.twin ? "예 (180° 위상, 간격 " + fmt(p.gap) + " mm)" : "아니오", false],
      ["편심 축", p.makeShaft ? `축 ⌀${fmt(p.shaftDia)} / 저널 ⌀${fmt(p.journalDia)} mm` : "생성 안 함", false],
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

  function circleLoop(r, cx, cy, nSeg) {
    return CycloMath.circlePoints(r, cx, cy, nSeg || 90);
  }

  // The disc is a rigid body: discPose() is a rotation by phi followed by a
  // shift to (cx, cy), so nothing about the disc's shape depends on the drive
  // angle. Emit each outline once at the identity pose and give the moving
  // assembly an SVG transform, rather than pushing every point through that
  // pose in JS and rebuilding the path text each frame. loopToPathD negates
  // Y, so a +phi model rotation is -phi in SVG.
  //
  // The bore, output holes and journal all share the disc's pose, so they ride
  // in the same group. A circle centred on the origin is unchanged by the
  // rotation, which is why the journal can sit there rather than at (cx, cy).
  function poseTransform(pose, scale) {
    const X = (pose.cx * scale).toFixed(2),
      Y = (-pose.cy * scale).toFixed(2),
      A = ((-pose.phi * 180) / Math.PI).toFixed(3);
    return "translate(" + X + "," + Y + ") rotate(" + A + ")";
  }

  function buildSceneSvg(svg, p, W, H, scale, showBore) {
    clear(svg);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    const g = svgEl("g", { transform: "translate(" + W / 2 + "," + H / 2 + ")" });
    svg.appendChild(g);

    // fixed ring pins (housing) - drawn first, behind the disc
    if (p.makeRing) {
      for (const pin of CycloMath.pinCenters(p)) {
        const c = svgEl("path", { d: circlePathD(pin.r, pin.x, pin.y, scale) });
        c.style.fill = "var(--fs-fill)";
        c.style.stroke = "var(--fs-stroke)";
        c.style.strokeWidth = "1";
        c.style.opacity = "0.9";
        g.appendChild(c);
      }
    }

    // everything that rides with disc 1
    const disc1 = svgEl("g");
    g.appendChild(disc1);
    const discPath = svgEl("path", { d: loopToPathD(CycloMath.discOutline(p, false), scale) });
    discPath.style.fill = "var(--cs-fill)";
    discPath.style.stroke = "var(--cs-stroke)";
    discPath.style.strokeWidth = "1.2";
    discPath.style.opacity = "0.92";
    disc1.appendChild(discPath);

    // ... and with the 180-degree-opposed twin
    let disc2 = null;
    if (p.twin) {
      disc2 = svgEl("g");
      g.appendChild(disc2);
      const disc2Path = svgEl("path", {
        d: loopToPathD(CycloMath.discOutline(p, true), scale),
        fill: "none",
      });
      disc2Path.style.stroke = "var(--accent2)";
      disc2Path.style.strokeWidth = "1.2";
      disc2Path.style.strokeDasharray = "5 3";
      disc2Path.style.opacity = "0.85";
      disc2.appendChild(disc2Path);
    }

    if (showBore && p.makeBore) {
      const b = svgEl("path", {
        d: loopToPathD(circleLoop(p.boreDia / 2, 0, 0, 120), scale),
        fill: "none",
      });
      b.style.stroke = "var(--canvas-line)";
      b.style.strokeWidth = "1";
      b.style.strokeDasharray = "3 3";
      disc1.appendChild(b);
    }

    if (showBore && p.makeHoles) {
      for (const h of CycloMath.outputHoleCenters(p)) {
        const c = svgEl("path", { d: loopToPathD(circleLoop(h.r, h.x, h.y, 60), scale), fill: "none" });
        c.style.stroke = "var(--canvas-line)";
        c.style.strokeWidth = "1";
        disc1.appendChild(c);
      }
    }

    if (showBore && p.makeShaft) {
      const sg = CycloMath.shaftGeometry(p);
      // main shaft stays on the fixed axis; the journal sits at the disc centre
      const shaft = svgEl("path", { d: circlePathD(sg.shaftR, 0, 0, scale), fill: "none" });
      shaft.style.stroke = "var(--wg-stroke)";
      shaft.style.strokeWidth = "1.4";
      g.appendChild(shaft);
      const j1 = svgEl("path", { d: circlePathD(sg.journalR, 0, 0, scale), fill: "none" });
      j1.style.stroke = "var(--wg-stroke)";
      j1.style.strokeWidth = "1.4";
      disc1.appendChild(j1);
      if (disc2) {
        const j2 = svgEl("path", { d: circlePathD(sg.journalR, 0, 0, scale), fill: "none" });
        j2.style.stroke = "var(--wg-stroke)";
        j2.style.strokeWidth = "1.4";
        j2.style.strokeDasharray = "3 2";
        disc2.appendChild(j2);
      }
    }

    return { svg: svg, p: p, scale: scale, disc1: disc1, disc2: disc2, moving: disc2 ? [disc1, disc2] : [disc1] };
  }

  function poseSceneSvg(sc, p, theta) {
    sc.disc1.setAttribute("transform", poseTransform(discPose(p, theta, false), sc.scale));
    if (sc.disc2) sc.disc2.setAttribute("transform", poseTransform(discPose(p, theta, true), sc.scale));
  }

  const mainFit = ViewFit.make(),
    detailFit = ViewFit.make();

  // cached scenes, rebuilt only when the geometry or the fit scale changes
  let mainScene = null,
    detailScene = null;

  // Moving by transform alone lets the browser keep each group's rasterised
  // bitmap across frames instead of re-rasterising the disc every time; the
  // hint is what makes it do so. Only while the animation runs, since each
  // promoted layer costs a bitmap the size of its bounding box.
  function setAnimating(on) {
    for (const sc of [mainScene, detailScene]) {
      if (!sc) continue;
      for (const el of sc.moving) el.style.willChange = on ? "transform" : "";
    }
  }

  function renderMainSvg(p) {
    const W = 900,
      H = 900;
    const scale = ViewFit.fit(mainFit, W, 0.46, p.R + p.Rr + 4, 0, 0).scale;
    if (!mainScene || mainScene.p !== p || mainScene.scale !== scale) {
      mainScene = buildSceneSvg(els.svgMain, p, W, H, scale, true);
      if (playing) setAnimating(true);
    }
    poseSceneSvg(mainScene, p, driveRad());
  }

  function renderDetailSvg(p) {
    const W = 500,
      H = 500;
    // zoom on the contact zone near the top pin (angle +90 deg, i.e. +y)
    const scale = ViewFit.fit(detailFit, W, 0.21, p.Rr + Math.abs(p.E) + 1, 0, 0).scale;
    if (!detailScene || detailScene.p !== p || detailScene.scale !== scale) {
      clear(els.svgDetail);
      els.svgDetail.setAttribute("viewBox", "0 0 " + W + " " + H);
      const focus = { x: 0, y: p.R }; // the top fixed pin - where a lobe engages
      const g = svgEl("g", {
        transform: "translate(" + (W / 2 - focus.x * scale) + "," + (H / 2 + focus.y * scale) + ")",
      });
      els.svgDetail.appendChild(g);

      // fixed pins near the top
      for (const pin of CycloMath.pinCenters(p)) {
        const c = svgEl("path", { d: circlePathD(pin.r, pin.x, pin.y, scale) });
        c.style.fill = "var(--fs-fill)";
        c.style.stroke = "var(--fs-stroke)";
        c.style.strokeWidth = "1.2";
        c.style.opacity = "0.9";
        g.appendChild(c);
      }
      // posed disc, showing the lobe/pin engagement
      const disc1 = svgEl("g");
      g.appendChild(disc1);
      const discPath = svgEl("path", { d: loopToPathD(CycloMath.discOutline(p, false), scale) });
      discPath.style.fill = "var(--cs-fill)";
      discPath.style.stroke = "var(--cs-stroke)";
      discPath.style.strokeWidth = "1.5";
      discPath.style.opacity = "0.92";
      disc1.appendChild(discPath);

      detailScene = { svg: els.svgDetail, p: p, scale: scale, disc1: disc1, disc2: null, moving: [disc1] };
      if (playing) setAnimating(true);
    }
    poseSceneSvg(detailScene, p, driveRad());
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
      const layers = [{ layer: "DISC", loops: [CycloMath.discOutline(p, false)] }];
      if (p.makeBore) layers.push({ layer: "BORE", loops: [CycloMath.circlePoints(p.boreDia / 2, 0, 0, 180)] });
      if (p.makeHoles)
        layers.push({
          layer: "OUTPUT_HOLES",
          loops: CycloMath.outputHoleCenters(p).map((c) => CycloMath.circlePoints(c.r, c.x, c.y, 60)),
        });
      if (p.twin) layers.push({ layer: "DISC2", loops: [CycloMath.discOutline(p, true)] });
      download("cycloidal_disc.dxf", DXFWriter.buildDXF(layers));
    };

    els.dlRing.onclick = () => {
      if (!p.makeRing) return;
      const loops = CycloMath.pinCenters(p).map((c) => CycloMath.circlePoints(c.r, c.x, c.y, 90));
      const dxf = DXFWriter.buildDXF([{ layer: "PINS", loops }]);
      download("pin_ring.dxf", dxf);
    };

    els.dlShaft.onclick = () => {
      if (!p.makeShaft) return;
      const sg = CycloMath.shaftGeometry(p);
      const layers = [{ layer: "SHAFT", loops: [CycloMath.circlePoints(sg.shaftR, 0, 0, 120)] }];
      sg.journals.forEach((j, i) => {
        layers.push({ layer: "JOURNAL_" + (i + 1), loops: [CycloMath.circlePoints(sg.journalR, j.x, j.y, 90)] });
      });
      download("eccentric_shaft.dxf", DXFWriter.buildDXF(layers));
    };

    els.dlAll.onclick = () => {
      const layers = [{ layer: "DISC", loops: [CycloMath.discOutline(p, false)] }];
      if (p.twin) layers.push({ layer: "DISC2", loops: [CycloMath.discOutline(p, true)] });
      if (p.makeBore) layers.push({ layer: "BORE", loops: [CycloMath.circlePoints(p.boreDia / 2, 0, 0, 180)] });
      if (p.makeHoles)
        layers.push({
          layer: "OUTPUT_HOLES",
          loops: CycloMath.outputHoleCenters(p).map((c) => CycloMath.circlePoints(c.r, c.x, c.y, 60)),
        });
      if (p.makeShaft) {
        const sg = CycloMath.shaftGeometry(p);
        layers.push({ layer: "SHAFT", loops: [CycloMath.circlePoints(sg.shaftR, 0, 0, 120)] });
        sg.journals.forEach((j, i) => {
          layers.push({ layer: "JOURNAL_" + (i + 1), loops: [CycloMath.circlePoints(sg.journalR, j.x, j.y, 90)] });
        });
      }
      if (p.makeRing)
        layers.push({
          layer: "PINS",
          loops: CycloMath.pinCenters(p).map((c) => CycloMath.circlePoints(c.r, c.x, c.y, 90)),
        });
      download("cycloidal_drive_full.dxf", DXFWriter.buildDXF(layers));
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
    els.makeBore,
    els.tolBore,
    els.holeCount,
    els.makeHoles,
    els.holePcd,
    els.holeDia,
    els.tolHole,
    els.tolDisc,
    els.tolPin,
    els.makeRing,
    els.pinMargin,
    els.twin,
    els.gap,
    els.makeShaft,
    els.shaftDia,
    els.journalDia,
    els.points,
  ].forEach((el) => el && el.addEventListener("input", scheduleRender));

  // Changing the overall size (pin pitch radius R) proportionally scales the
  // bore and output-hole / shaft dimensions so the holes grow and shrink
  // naturally with the disc instead of staying a fixed size.
  let prevR = num(els.R, 30);
  const sizeLinked = [els.bore, els.holePcd, els.holeDia, els.shaftDia, els.journalDia];
  els.R.addEventListener("input", () => {
    const newR = num(els.R, prevR);
    if (newR > 0 && prevR > 0 && Math.abs(newR - prevR) > 1e-9) {
      const f = newR / prevR;
      for (const el of sizeLinked) {
        const v = parseFloat(el.value);
        if (isFinite(v)) el.value = +(v * f).toFixed(2);
      }
    }
    prevR = newR;
  });

  els.drive.addEventListener("input", () => {
    els.driveVal.textContent = els.drive.value + "°";
    redrawGeometry();
  });

  // double-click a preview to re-fit it to the current geometry
  [els.svgMain, els.svgDetail].forEach((svg, i) =>
    svg.addEventListener("dblclick", () => {
      ViewFit.reset(i === 0 ? mainFit : detailFit);
      redrawGeometry();
    })
  );

  // play / pause the eccentric-driven meshing animation
  let rafId = null;
  let lastT = 0;
  function tick(t) {
    if (!playing) return;
    if (!lastT) lastT = t;
    const dt = (t - lastT) / 1000;
    lastT = t;
    let v = num(els.drive, 0) + dt * 60; // 60 deg/sec input
    v = ((v % 360) + 360) % 360;
    els.drive.value = v.toFixed(1);
    els.driveVal.textContent = Math.round(v) + "°";
    redrawGeometry();
    rafId = requestAnimationFrame(tick);
  }
  els.play.addEventListener("click", () => {
    playing = !playing;
    els.play.textContent = playing ? "⏸ 정지" : "▶ 재생";
    setAnimating(playing);
    if (playing) {
      lastT = 0;
      rafId = requestAnimationFrame(tick);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playing) {
      playing = false;
      els.play.textContent = "▶ 재생";
      setAnimating(false);
      if (rafId) cancelAnimationFrame(rafId);
    }
  });

  render();
})();
