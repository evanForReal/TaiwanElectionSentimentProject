import { describe, expect, it } from "vitest";
import type { Layout, LayoutLine } from "./types.ts";
import { ITEM_CATEGORIES } from "./types.ts";
import {
  clearances,
  floorPolygon,
  layoutObstacles,
  obbOverlap,
  openingsOnWall,
  polygonArea,
  rescaleLayout,
  snapToWall,
  wallPieces,
} from "./geometry.ts";
import { modelBounds, normalizeModel, scaleModelTo } from "./modelOps.ts";
import { buildTemplateModel, DEFAULT_DIMS } from "./templates.ts";
import { formatLength, parseLength } from "./units.ts";

const base: Layout = {
  lines: [],
  points: [],
  zones: [],
  ceilingHeight: 260,
  wallThickness: 15,
  wallColor: "#ffffff",
  floorColor: "#cccccc",
  floorKind: "wood",
  background: null,
};

const wall = (id: string, ax: number, ay: number, bx: number, by: number, type: LayoutLine["type"] = "wall-exterior"): LayoutLine => ({
  id,
  type,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});

const rect = (w: number, d: number): LayoutLine[] => [
  wall("n", 0, 0, w, 0),
  wall("e", w, 0, w, d),
  wall("s", w, d, 0, d),
  wall("w", 0, d, 0, 0),
];

describe("units", () => {
  it("parses metric and imperial input", () => {
    expect(parseLength("240", "metric")).toBe(240);
    expect(parseLength("2.4m", "metric")).toBeCloseTo(240);
    expect(parseLength("96", "imperial")).toBeCloseTo(243.84);
    expect(parseLength(`8'`, "metric")).toBeCloseTo(243.84);
    expect(parseLength(`8' 6"`, "metric")).toBeCloseTo(259.08);
    expect(parseLength("8ft 6in", "metric")).toBeCloseTo(259.08);
    expect(parseLength("abc", "metric")).toBeNull();
  });
  it("formats lengths", () => {
    expect(formatLength(45, "metric")).toBe("45 cm");
    expect(formatLength(350, "metric")).toBe("3.50 m");
    expect(formatLength(259.08, "imperial")).toBe("8′ 6″");
  });
});

describe("walls and openings", () => {
  it("cuts a door and a window out of a wall", () => {
    const layout: Layout = {
      ...base,
      lines: [
        wall("w1", 0, 0, 500, 0),
        { id: "d", type: "door", a: { x: 50, y: 0 }, b: { x: 140, y: 0 } },
        { id: "win", type: "window", a: { x: 250, y: 2 }, b: { x: 400, y: 2 }, sill: 80, height: 200 },
      ],
    };
    const ops = openingsOnWall(layout.lines[0], layout);
    expect(ops.map((o) => o.line.id)).toEqual(["d", "win"]);
    const pieces = wallPieces(layout.lines[0], layout);
    // solid, door header, solid, window below + above, solid
    expect(pieces).toEqual([
      { from: 0, to: 50, bottom: 0, top: 260 },
      { from: 50, to: 140, bottom: 210, top: 260 },
      { from: 140, to: 250, bottom: 0, top: 260 },
      { from: 250, to: 400, bottom: 0, top: 80 },
      { from: 250, to: 400, bottom: 200, top: 260 },
      { from: 400, to: 500, bottom: 0, top: 260 },
    ]);
  });

  it("ignores openings on a different wall", () => {
    const layout: Layout = { ...base, lines: [wall("w1", 0, 0, 500, 0), { id: "d", type: "door", a: { x: 50, y: 200 }, b: { x: 140, y: 200 } }] };
    expect(openingsOnWall(layout.lines[0], layout)).toHaveLength(0);
  });
});

describe("floor outline", () => {
  it("finds a rectangle", () => {
    const poly = floorPolygon({ ...base, lines: rect(400, 300) });
    expect(Math.abs(polygonArea(poly))).toBeCloseTo(120000);
  });

  it("finds an L-shape and ignores an interior wall", () => {
    const pts = [
      [0, 0],
      [600, 0],
      [600, 300],
      [300, 300],
      [300, 500],
      [0, 500],
    ];
    const lines = pts.map((p, i) => wall(`w${i}`, p[0], p[1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]));
    lines.push(wall("int", 300, 0, 300, 300, "wall-interior"));
    const poly = floorPolygon({ ...base, lines });
    expect(Math.abs(polygonArea(poly))).toBeCloseTo(600 * 300 + 300 * 200);
  });

  it("falls back to a bounding box for open walls", () => {
    const poly = floorPolygon({ ...base, lines: [wall("a", 0, 0, 400, 0), wall("b", 400, 0, 400, 300)] });
    expect(poly).toHaveLength(4);
  });
});

describe("collisions and snapping", () => {
  it("detects overlapping rotated footprints", () => {
    const a = { center: { x: 0, y: 0 }, hw: 50, hd: 20, angle: 0 };
    expect(obbOverlap(a, { center: { x: 90, y: 0 }, hw: 50, hd: 20, angle: 0 })).toBeGreaterThan(0);
    expect(obbOverlap(a, { center: { x: 110, y: 0 }, hw: 50, hd: 20, angle: 0 })).toBe(0);
    expect(obbOverlap(a, { center: { x: 0, y: 60 }, hw: 50, hd: 20, angle: Math.PI / 2 })).toBeGreaterThan(0);
  });

  it("treats door openings as passable", () => {
    const layout: Layout = { ...base, lines: [...rect(400, 300), { id: "d", type: "door", a: { x: 100, y: 0 }, b: { x: 190, y: 0 } }] };
    const piece = { center: { x: 145, y: 0 }, hw: 20, hd: 20, angle: 0 };
    const hits = layoutObstacles(layout).filter((o) => o.bottom < 50 && obbOverlap(piece, o.obb) > 0);
    expect(hits).toHaveLength(0);
  });

  it("snaps a piece flush against a nearby wall, facing into the room", () => {
    const layout: Layout = { ...base, lines: rect(400, 300) };
    // A sofa 90 cm deep, centered 70 cm from the north wall's centerline
    const s = snapToWall({ center: { x: 200, y: 70 }, hw: 100, hd: 45, angle: 0.3 }, layout)!;
    expect(s).not.toBeNull();
    expect(s.center.y).toBeCloseTo(7.5 + 45 + 0.5);
    // Front (+z local) should face +y (into the room): angle 0
    expect(Math.abs(Math.sin(s.angle))).toBeLessThan(1e-9);
    expect(Math.cos(s.angle)).toBeCloseTo(1);
  });

  it("snaps to the room side of an exterior wall even when dragged past it", () => {
    const layout: Layout = { ...base, lines: rect(400, 300) };
    const s = snapToWall({ center: { x: -20, y: 150 }, hw: 40, hd: 16, angle: 0 }, layout, 25, { x: 200, y: 150 })!;
    expect(s.center.x).toBeCloseTo(7.5 + 16 + 0.5);
  });

  it("measures clearances to walls", () => {
    const layout: Layout = { ...base, lines: rect(400, 300) };
    const obstacles = layoutObstacles(layout).map((o) => o.obb);
    const c = clearances({ center: { x: 200, y: 150 }, hw: 50, hd: 25, angle: 0 }, obstacles);
    const front = c.find((x) => x.side === "front")!;
    // front edge at y=175; south wall inner face at 300 - 7.5
    expect(front.distance).toBeCloseTo(300 - 7.5 - 175, 1);
  });

  it("rescales a layout", () => {
    const l = rescaleLayout({ ...base, lines: rect(100, 50) }, 3);
    expect(l.lines[1].a).toEqual({ x: 300, y: 0 });
  });
});

describe("parametric models", () => {
  it("builds every category template at its default size", () => {
    for (const cat of ITEM_CATEGORIES) {
      const m = buildTemplateModel(cat);
      const target = DEFAULT_DIMS[cat];
      expect(m.parts.length).toBeGreaterThan(0);
      expect(m.dims.w).toBeCloseTo(target.w, -1);
      expect(m.dims.h).toBeCloseTo(target.h, -1);
      const b = modelBounds(m.parts);
      expect(b.min.y).toBeCloseTo(0, 0);
    }
  });

  it("scales to exact known dimensions", () => {
    const m = scaleModelTo(buildTemplateModel("sofa"), { w: 240, d: 100, h: 85 });
    expect(m.dims.w).toBeCloseTo(240, 0);
    expect(m.dims.d).toBeCloseTo(100, 0);
    expect(m.dims.h).toBeCloseTo(85, 0);
  });

  it("normalizes messy input", () => {
    const m = normalizeModel({
      category: "chair",
      dims: { w: 0, d: 0, h: 0 },
      notes: "",
      materials: [{ id: "x", name: "", kind: "wood", color: "red", roughness: 3, metalness: -1, opacity: 1 }],
      parts: [
        {
          id: "a",
          name: "seat",
          shape: "box",
          position: { x: 100, y: 50, z: 30 },
          size: { x: 40, y: -5, z: 40 },
          rotation: { x: 0, y: 0, z: 0 },
          cornerRadius: 0,
          materialId: "missing",
        },
      ],
    });
    expect(m.parts[0].position.x).toBe(0);
    expect(m.parts[0].size.y).toBeGreaterThan(0);
    expect(m.parts[0].position.y - m.parts[0].size.y / 2).toBeCloseTo(0);
    expect(m.parts[0].materialId).toBe("x");
    expect(m.materials[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.materials[0].roughness).toBe(1);
  });
});
