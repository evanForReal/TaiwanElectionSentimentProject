import type { Dimensions, MaterialKind, ModelMaterial, ModelPart, ParametricModel, PartShape } from "./types.ts";
import { normalizeModel } from "./modelOps.ts";

// Parametric templates per category. They give every item a sensible starting model without
// an API call, and Claude sees one as a reference for the coordinate conventions.

export const DEFAULT_DIMS: Record<string, Dimensions> = {
  sofa: { w: 210, d: 90, h: 80 },
  armchair: { w: 80, d: 82, h: 78 },
  chair: { w: 46, d: 52, h: 82 },
  "dining-table": { w: 180, d: 90, h: 75 },
  "coffee-table": { w: 110, d: 60, h: 40 },
  "side-table": { w: 45, d: 45, h: 55 },
  desk: { w: 140, d: 70, h: 75 },
  bed: { w: 160, d: 210, h: 100 },
  nightstand: { w: 48, d: 40, h: 55 },
  dresser: { w: 120, d: 48, h: 85 },
  cabinet: { w: 90, d: 45, h: 180 },
  bookshelf: { w: 80, d: 32, h: 190 },
  "tv-stand": { w: 160, d: 42, h: 50 },
  bench: { w: 120, d: 38, h: 45 },
  stool: { w: 38, d: 38, h: 65 },
  ottoman: { w: 60, d: 60, h: 42 },
  "lamp-floor": { w: 40, d: 40, h: 160 },
  "lamp-table": { w: 28, d: 28, h: 50 },
  pendant: { w: 45, d: 45, h: 40 },
  rug: { w: 240, d: 170, h: 1 },
  plant: { w: 50, d: 50, h: 120 },
  mirror: { w: 70, d: 3, h: 160 },
  art: { w: 80, d: 3, h: 100 },
  decor: { w: 25, d: 25, h: 30 },
  other: { w: 60, d: 60, h: 60 },
};

type Colors = { primary: string; secondary: string; accent: string };

const DEFAULT_COLORS: Colors = { primary: "#cdbfae", secondary: "#8a6a4d", accent: "#2e2b28" };

class Builder {
  parts: ModelPart[] = [];
  materials: ModelMaterial[] = [];
  private n = 0;

  mat(id: string, name: string, kind: MaterialKind, color: string, roughness = 0.75, metalness = 0, opacity = 1) {
    this.materials.push({ id, name, kind, color, roughness, metalness, opacity });
    return id;
  }

  add(
    name: string,
    shape: PartShape,
    materialId: string,
    pos: [number, number, number],
    size: [number, number, number],
    opts: { rot?: [number, number, number]; r?: number } = {},
  ) {
    const [x, y, z] = pos;
    const [sx, sy, sz] = size;
    const rot = opts.rot ?? [0, 0, 0];
    this.parts.push({
      id: `p${this.n++}`,
      name,
      shape,
      position: { x, y, z },
      size: { x: sx, y: sy, z: sz },
      rotation: { x: rot[0], y: rot[1], z: rot[2] },
      cornerRadius: opts.r ?? 0,
      materialId,
    });
  }

  /** Four legs inset from the footprint corners. */
  legs(materialId: string, w: number, d: number, h: number, t: number, inset: number, round = true) {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        this.add(
          "Leg",
          round ? "cylinder" : "box",
          materialId,
          [sx * (w / 2 - inset - t / 2), h / 2, sz * (d / 2 - inset - t / 2)],
          [t, h, t],
        );
  }
}

type TemplateFn = (b: Builder, d: Dimensions, c: Colors) => void;

const sofaLike: TemplateFn = (b, { w, d, h }, c) => {
  const fabric = b.mat("fabric", "Upholstery", "fabric", c.primary, 0.95);
  const wood = b.mat("legs", "Legs", "wood", c.secondary, 0.6);
  const legH = Math.min(12, h * 0.15);
  const seatH = h * 0.52;
  const armW = Math.max(12, w * 0.09);
  const backD = Math.max(14, d * 0.2);
  b.legs(wood, w, d, legH, 4, 4);
  b.add("Base", "roundedBox", fabric, [0, legH + (seatH - legH) * 0.35, 0], [w, (seatH - legH) * 0.7, d], { r: 3 });
  const cushions = w > 160 ? 3 : w > 110 ? 2 : 1;
  const innerW = w - armW * 2;
  for (let i = 0; i < cushions; i++) {
    const cw = innerW / cushions;
    b.add("Seat cushion", "roundedBox", fabric, [-innerW / 2 + cw * (i + 0.5), seatH - (seatH - legH) * 0.15, backD / 2], [cw - 1, (seatH - legH) * 0.3, d - backD], { r: 5 });
  }
  b.add("Back", "roundedBox", fabric, [0, seatH + (h - seatH) / 2 - 2, -d / 2 + backD / 2], [w - armW * 2 + 2, h - seatH + 4, backD], { r: 5 });
  for (const s of [-1, 1])
    b.add("Arm", "roundedBox", fabric, [s * (w / 2 - armW / 2), legH + (h * 0.68 - legH) / 2, 0], [armW, h * 0.68 - legH, d], { r: 5 });
};

const chair: TemplateFn = (b, { w, d, h }, c) => {
  const wood = b.mat("frame", "Frame", "wood", c.secondary, 0.6);
  const seat = b.mat("seat", "Seat", "fabric", c.primary, 0.9);
  const seatH = Math.min(46, h * 0.55);
  b.legs(wood, w, d, seatH - 4, 3.5, 2);
  b.add("Seat", "roundedBox", seat, [0, seatH - 2, 0], [w, 5, d], { r: 1.5 });
  b.add("Backrest", "roundedBox", wood, [0, seatH + (h - seatH) * 0.62, -d / 2 + 2], [w - 2, (h - seatH) * 0.5, 3], { r: 1 });
  for (const s of [-1, 1]) b.add("Back post", "box", wood, [s * (w / 2 - 3), seatH + (h - seatH) / 2, -d / 2 + 2], [3, h - seatH, 3]);
};

const table: TemplateFn = (b, { w, d, h }, c) => {
  const top = b.mat("top", "Top", "wood", c.secondary, 0.55);
  const leg = b.mat("legs", "Legs", "wood", c.secondary, 0.6);
  const thick = Math.max(2.5, Math.min(5, h * 0.06));
  b.add("Top", "roundedBox", top, [0, h - thick / 2, 0], [w, thick, d], { r: 0.8 });
  b.legs(leg, w, d, h - thick, Math.max(3.5, Math.min(7, w * 0.04)), Math.min(8, w * 0.05), false);
  if (h > 50) {
    b.add("Apron", "box", leg, [0, h - thick - 4, d / 2 - 6], [w - 14, 7, 2]);
    b.add("Apron", "box", leg, [0, h - thick - 4, -d / 2 + 6], [w - 14, 7, 2]);
  }
};

const roundTable: TemplateFn = (b, { w, d, h }, c) => {
  const top = b.mat("top", "Top", "wood", c.secondary, 0.55);
  const base = b.mat("base", "Base", "metal", c.accent, 0.4, 0.6);
  b.add("Top", "cylinder", top, [0, h - 1.5, 0], [w, 3, d]);
  b.add("Stem", "cylinder", base, [0, (h - 3) / 2, 0], [5, h - 3, 5]);
  b.add("Foot", "cylinder", base, [0, 1, 0], [w * 0.55, 2, d * 0.55]);
};

const bed: TemplateFn = (b, { w, d, h }, c) => {
  const frame = b.mat("frame", "Frame", "wood", c.secondary, 0.6);
  const mattress = b.mat("mattress", "Bedding", "fabric", "#f1ece4", 0.95);
  const throwMat = b.mat("throw", "Throw", "fabric", c.primary, 0.95);
  const frameH = 30;
  b.legs(frame, w, d, 10, 5, 3, false);
  b.add("Frame", "box", frame, [0, 10 + (frameH - 10) / 2, 0], [w, frameH - 10, d]);
  b.add("Mattress", "roundedBox", mattress, [0, frameH + 11, 2], [w - 4, 22, d - 8], { r: 6 });
  b.add("Headboard", "roundedBox", frame, [0, h / 2, -d / 2 + 3], [w, h, 6], { r: 2 });
  b.add("Throw", "roundedBox", throwMat, [0, frameH + 22.5, d / 2 - d * 0.18], [w - 2, 2, d * 0.32], { r: 1 });
  for (const s of [-1, 1]) b.add("Pillow", "roundedBox", mattress, [s * w * 0.23, frameH + 27, -d / 2 + 22], [w * 0.38, 12, 30], { r: 6 });
};

const caseGoods: TemplateFn = (b, { w, d, h }, c) => {
  const body = b.mat("body", "Body", "wood", c.secondary, 0.6);
  const pull = b.mat("pull", "Pulls", "metal", c.accent, 0.35, 0.8);
  const legH = h > 120 ? 6 : 10;
  b.legs(body, w, d, legH, 3, 3, false);
  b.add("Case", "box", body, [0, legH + (h - legH) / 2, 0], [w, h - legH, d]);
  const rows = h > 120 ? 2 : h > 70 ? 3 : 1;
  const cols = w > 100 && h < 120 ? 2 : 1;
  const ch = (h - legH - 4) / rows;
  for (let r = 0; r < rows; r++)
    for (let col = 0; col < cols; col++) {
      const cw = (w - 4) / cols;
      const x = -w / 2 + 2 + cw * (col + 0.5);
      const y = legH + 2 + ch * (r + 0.5);
      b.add("Front", "box", body, [x, y, d / 2 + 0.5], [cw - 1, ch - 1, 1]);
      b.add("Pull", "cylinder", pull, [x, y + ch * 0.25, d / 2 + 1.5], [1.5, cw * 0.3, 1.5], { rot: [0, 0, 90] });
    }
};

const bookshelf: TemplateFn = (b, { w, d, h }, c) => {
  const wood = b.mat("wood", "Wood", "wood", c.secondary, 0.6);
  const t = 2;
  for (const s of [-1, 1]) b.add("Side", "box", wood, [s * (w / 2 - t / 2), h / 2, 0], [t, h, d]);
  b.add("Back", "box", wood, [0, h / 2, -d / 2 + 0.5], [w, h, 1]);
  const shelves = Math.max(3, Math.round(h / 36));
  for (let i = 0; i <= shelves; i++) b.add("Shelf", "box", wood, [0, t / 2 + ((h - t) / shelves) * i, 0], [w - t * 2, t, d]);
  const book = b.mat("books", "Books", "plain", c.primary, 0.85);
  for (let i = 0; i < shelves; i++)
    b.add("Books", "box", book, [-w * 0.15, t + ((h - t) / shelves) * i + 11, 0], [w * 0.45, 21, d * 0.75]);
};

const bench: TemplateFn = (b, { w, d, h }, c) => {
  const wood = b.mat("wood", "Wood", "wood", c.secondary, 0.6);
  b.add("Seat", "box", wood, [0, h - 2, 0], [w, 4, d]);
  b.legs(wood, w, d, h - 4, 4, 4, false);
};

const stool: TemplateFn = (b, { w, d, h }, c) => {
  const wood = b.mat("wood", "Wood", "wood", c.secondary, 0.6);
  b.add("Seat", "cylinder", wood, [0, h - 2, 0], [w, 4, d]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add("Leg", "cylinder", wood, [Math.cos(a) * w * 0.32, (h - 4) / 2, Math.sin(a) * d * 0.32], [3, h - 4, 3]);
  }
};

const ottoman: TemplateFn = (b, { w, d, h }, c) => {
  const fabric = b.mat("fabric", "Upholstery", "fabric", c.primary, 0.95);
  if (Math.abs(w - d) < 5) b.add("Pouf", "cylinder", fabric, [0, h / 2, 0], [w, h, d]);
  else b.add("Ottoman", "roundedBox", fabric, [0, h / 2, 0], [w, h, d], { r: 6 });
};

const floorLamp: TemplateFn = (b, { w, d, h }, c) => {
  const metal = b.mat("metal", "Metal", "metal", c.accent, 0.35, 0.8);
  const shade = b.mat("shade", "Shade", "fabric", "#f3ede2", 0.9, 0, 0.92);
  b.add("Base", "cylinder", metal, [0, 1.5, 0], [w * 0.7, 3, d * 0.7]);
  b.add("Stem", "cylinder", metal, [0, h * 0.42, 0], [2, h * 0.82, 2]);
  b.add("Shade", "cone", shade, [0, h - h * 0.1, 0], [w, h * 0.2, d]);
};

const tableLamp: TemplateFn = (b, { w, d, h }, c) => {
  const base = b.mat("base", "Base", "ceramic", c.primary, 0.4);
  const shade = b.mat("shade", "Shade", "fabric", "#f3ede2", 0.9, 0, 0.92);
  b.add("Base", "sphere", base, [0, h * 0.25, 0], [w * 0.6, h * 0.5, d * 0.6]);
  b.add("Neck", "cylinder", base, [0, h * 0.55, 0], [1.5, h * 0.2, 1.5]);
  b.add("Shade", "cone", shade, [0, h * 0.8, 0], [w, h * 0.4, d]);
};

const pendant: TemplateFn = (b, { w, d, h }, c) => {
  const shade = b.mat("shade", "Shade", "rattan", c.primary, 0.9);
  const cord = b.mat("cord", "Cord", "plain", c.accent, 0.5);
  b.add("Shade", "sphere", shade, [0, h * 0.35, 0], [w, h * 0.7, d]);
  b.add("Cord", "cylinder", cord, [0, h * 0.85, 0], [0.8, h * 0.3, 0.8]);
};

const rug: TemplateFn = (b, { w, d }, c) => {
  const fabric = b.mat("rug", "Rug", "fabric", c.primary, 1);
  b.add("Rug", "box", fabric, [0, 0.5, 0], [w, 1, d]);
};

const plant: TemplateFn = (b, { w, d, h }, c) => {
  const pot = b.mat("pot", "Pot", "ceramic", c.primary === DEFAULT_COLORS.primary ? "#e9e3d9" : c.primary, 0.5);
  const leaf = b.mat("leaves", "Foliage", "plant", "#4f6b3a", 0.8);
  const potH = h * 0.28;
  b.add("Pot", "cylinder", pot, [0, potH / 2, 0], [w * 0.55, potH, d * 0.55]);
  b.add("Foliage", "sphere", leaf, [0, potH + (h - potH) * 0.55, 0], [w, (h - potH) * 0.9, d]);
  b.add("Foliage", "sphere", leaf, [w * 0.15, potH + (h - potH) * 0.35, d * 0.1], [w * 0.6, (h - potH) * 0.5, d * 0.6]);
};

const flat: TemplateFn = (b, { w, d, h }, c) => {
  const frame = b.mat("frame", "Frame", "wood", c.secondary, 0.6);
  const face = b.mat("face", "Face", "glass", "#dfe7ea", 0.05, 0.9);
  b.add("Frame", "box", frame, [0, h / 2, 0], [w, h, d]);
  b.add("Face", "box", face, [0, h / 2, d / 2], [w - 6, h - 6, 0.4]);
};

const art: TemplateFn = (b, { w, d, h }, c) => {
  const frame = b.mat("frame", "Frame", "wood", c.accent, 0.6);
  const canvas = b.mat("canvas", "Artwork", "plain", c.primary, 0.9);
  b.add("Frame", "box", frame, [0, h / 2, 0], [w, h, d]);
  b.add("Artwork", "box", canvas, [0, h / 2, d / 2], [w - 6, h - 6, 0.4]);
};

const boxy: TemplateFn = (b, { w, d, h }, c) => {
  const m = b.mat("body", "Body", "plain", c.primary, 0.7);
  b.add("Body", "roundedBox", m, [0, h / 2, 0], [w, h, d], { r: Math.min(w, d, h) * 0.08 });
};

const TEMPLATES: Record<string, TemplateFn> = {
  sofa: sofaLike,
  armchair: sofaLike,
  chair,
  "dining-table": table,
  "coffee-table": table,
  "side-table": roundTable,
  desk: table,
  bed,
  nightstand: caseGoods,
  dresser: caseGoods,
  cabinet: caseGoods,
  "tv-stand": caseGoods,
  bookshelf,
  bench,
  stool,
  ottoman,
  "lamp-floor": floorLamp,
  "lamp-table": tableLamp,
  pendant,
  rug,
  plant,
  mirror: flat,
  art,
  decor: boxy,
  other: boxy,
};

export function buildTemplateModel(
  category: string,
  dims: Partial<Dimensions> = {},
  colors: Partial<Colors> = {},
): ParametricModel {
  const key = TEMPLATES[category] ? category : "other";
  const base = DEFAULT_DIMS[key];
  const d: Dimensions = { w: dims.w || base.w, d: dims.d || base.d, h: dims.h || base.h };
  const b = new Builder();
  TEMPLATES[key](b, d, { ...DEFAULT_COLORS, ...colors });
  return normalizeModel({ category: key, dims: d, parts: b.parts, materials: b.materials, notes: "Template approximation" });
}
