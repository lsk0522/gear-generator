/**
 * Minimal ASCII DXF (R12) writer — just enough to emit closed LWPOLYLINE-style
 * outlines (as POLYLINE/VERTEX, R12-safe) on named layers, in millimeters.
 * Good enough for Fusion 360's Insert > Insert DXF.
 */
(function (global) {
  "use strict";

  function polylineEntity(points, layer, closed) {
    const lines = [];
    lines.push("0", "POLYLINE", "8", layer, "66", "1", "70", closed ? "1" : "0");
    for (const pt of points) {
      lines.push("0", "VERTEX", "8", layer, "10", pt.x.toFixed(4), "20", pt.y.toFixed(4), "30", "0.0");
    }
    lines.push("0", "SEQEND");
    return lines;
  }

  function buildDXF(layerSets) {
    // layerSets: [{layer: 'CS', loops: [[{x,y},...], ...]}, ...]
    const lines = [];
    lines.push("0", "SECTION", "2", "HEADER", "0", "ENDSEC");
    lines.push("0", "SECTION", "2", "TABLES");
    lines.push("0", "TABLE", "2", "LAYER", "70", String(layerSets.length));
    for (const ls of layerSets) {
      lines.push("0", "LAYER", "2", ls.layer, "70", "0", "62", "7", "6", "CONTINUOUS");
    }
    lines.push("0", "ENDTAB", "0", "ENDSEC");
    lines.push("0", "SECTION", "2", "ENTITIES");
    for (const ls of layerSets) {
      for (const loop of ls.loops) {
        lines.push(...polylineEntity(loop, ls.layer, true));
      }
    }
    lines.push("0", "ENDSEC", "0", "EOF");
    return lines.join("\n");
  }

  const DXFWriter = { buildDXF };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = DXFWriter;
  } else {
    global.DXFWriter = DXFWriter;
  }
})(typeof window !== "undefined" ? window : globalThis);
