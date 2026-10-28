import { describe, expect, it } from "vitest";
import type { LibraryItem, Room } from "../shared/types.ts";
import { buildTemplateModel } from "../shared/templates.ts";
import { describeRoom } from "./roomBrief.ts";

const wall = (id: string, ax: number, ay: number, bx: number, by: number) => ({ id, type: "wall-exterior" as const, a: { x: ax, y: ay }, b: { x: bx, y: by } });

const room: Room = {
  id: "r",
  projectId: "p",
  name: "Living",
  layout: {
    lines: [
      wall("n", 0, 0, 400, 0),
      wall("e", 400, 0, 400, 300),
      wall("s", 400, 300, 0, 300),
      wall("w", 0, 300, 0, 0),
      { id: "d", type: "door", a: { x: 50, y: 300 }, b: { x: 140, y: 300 } },
      { id: "win", type: "window", a: { x: 150, y: 0 }, b: { x: 300, y: 0 } },
    ],
    points: [],
    zones: [{ id: "z", label: "Reading nook", color: "#ccc", points: [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }] }],
    ceilingHeight: 260,
    wallThickness: 15,
    wallColor: "#fff",
    floorColor: "#ccc",
    floorKind: "wood",
    background: null,
  },
  state: { placements: [{ id: "pl1", itemId: "sofa", x: 200, y: 250, rotation: -90, elevation: 0, draft: false }], staging: ["lamp"] },
  style: { collectionId: null, fit: null },
  sourceImageId: null,
  createdAt: "",
  updatedAt: "",
};

const item = (id: string, name: string, category: string): LibraryItem => ({
  id,
  name,
  category,
  photoIds: [],
  knownDims: {},
  notes: "",
  tags: [],
  model: buildTemplateModel(category),
  history: [],
  status: "ready",
  error: null,
  createdAt: "",
  updatedAt: "",
});

describe("room brief for Claude", () => {
  const text = describeRoom(room, new Map([["sofa", item("sofa", "Linen sofa", "sofa")], ["lamp", item("lamp", "Floor lamp", "lamp-floor")]]), ["lamp"]);

  it("locates openings on their walls", () => {
    expect(text).toMatch(/Wall s from \(400, 300\) to \(0, 300\).*door 90 cm wide centered at \(95, 300\)/);
    expect(text).toMatch(/window 150 cm wide centered at \(225, 0\), sill 90 cm, head 210 cm/);
  });

  it("lists placed pieces with normalized rotation and tray pieces", () => {
    expect(text).toContain('placementId pl1: "Linen sofa" (sofa, 210 wide × 90 deep × 80 tall) at (200, 250), rotation 270°');
    expect(text).toContain('itemId lamp: "Floor lamp"');
    expect(text).toContain('"Reading nook"');
  });
});
