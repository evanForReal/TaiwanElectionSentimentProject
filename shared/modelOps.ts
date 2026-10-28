import type { Dimensions, ModelMaterial, ModelPart, ParametricModel, Vec3 } from "./types.ts";
import { MATERIAL_KINDS, PART_SHAPES } from "./types.ts";

const DEG = Math.PI / 180;

function rotatePoint(p: Vec3, r: Vec3): Vec3 {
  // Matches three.js Euler order "XYZ": applied as Rz * Ry * Rx * p
  let { x, y, z } = p;
  const [cx, sx] = [Math.cos(r.x * DEG), Math.sin(r.x * DEG)];
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const [cy, sy] = [Math.cos(r.y * DEG), Math.sin(r.y * DEG)];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const [cz, sz] = [Math.cos(r.z * DEG), Math.sin(r.z * DEG)];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return { x, y, z };
}

export function partBounds(part: ModelPart): { min: Vec3; max: Vec3 } {
  const h = { x: part.size.x / 2, y: part.size.y / 2, z: part.size.z / 2 };
  if (part.shape === "torus") {
    // Torus lies in the XY plane in three.js: outer diameter in x/y, tube thickness in z
    h.y = h.x;
    h.z = part.size.y / 2;
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const c = rotatePoint({ x: sx * h.x, y: sy * h.y, z: sz * h.z }, part.rotation);
        const p = { x: c.x + part.position.x, y: c.y + part.position.y, z: c.z + part.position.z };
        min.x = Math.min(min.x, p.x);
        min.y = Math.min(min.y, p.y);
        min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x);
        max.y = Math.max(max.y, p.y);
        max.z = Math.max(max.z, p.z);
      }
  return { min, max };
}

export function modelBounds(parts: ModelPart[]): { min: Vec3; max: Vec3 } {
  if (parts.length === 0) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const part of parts) {
    const b = partBounds(part);
    min.x = Math.min(min.x, b.min.x);
    min.y = Math.min(min.y, b.min.y);
    min.z = Math.min(min.z, b.min.z);
    max.x = Math.max(max.x, b.max.x);
    max.y = Math.max(max.y, b.max.y);
    max.z = Math.max(max.z, b.max.z);
  }
  return { min, max };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Cleans up a model from any source (Claude, an old version, manual edits): fixes bad values,
 * re-centers the footprint on the origin, rests it on the floor and recomputes dims.
 */
export function normalizeModel(input: ParametricModel): ParametricModel {
  const materials: ModelMaterial[] = (input.materials ?? []).map((m, i) => ({
    id: m.id || `m${i}`,
    name: m.name || `Material ${i + 1}`,
    kind: (MATERIAL_KINDS as readonly string[]).includes(m.kind) ? m.kind : "plain",
    color: HEX.test(m.color) ? m.color.toLowerCase() : "#b8b0a4",
    roughness: clamp(num(m.roughness, 0.7), 0, 1),
    metalness: clamp(num(m.metalness, 0), 0, 1),
    opacity: clamp(num(m.opacity, 1), 0.05, 1),
  }));
  if (materials.length === 0) {
    materials.push({ id: "m0", name: "Body", kind: "plain", color: "#b8b0a4", roughness: 0.7, metalness: 0, opacity: 1 });
  }
  const materialIds = new Set(materials.map((m) => m.id));

  const seen = new Set<string>();
  const parts: ModelPart[] = (input.parts ?? [])
    .map((p, i) => {
      let id = p.id || `p${i}`;
      while (seen.has(id)) id = `${id}_${i}`;
      seen.add(id);
      return {
        id,
        name: p.name || `Part ${i + 1}`,
        shape: (PART_SHAPES as readonly string[]).includes(p.shape) ? p.shape : "box",
        position: { x: num(p.position?.x, 0), y: num(p.position?.y, 0), z: num(p.position?.z, 0) },
        size: {
          x: clamp(num(p.size?.x, 10), 0.2, 2000),
          y: clamp(num(p.size?.y, 10), 0.2, 2000),
          z: clamp(num(p.size?.z, 10), 0.2, 2000),
        },
        rotation: { x: num(p.rotation?.x, 0), y: num(p.rotation?.y, 0), z: num(p.rotation?.z, 0) },
        cornerRadius: clamp(num(p.cornerRadius, 0), 0, 50),
        materialId: materialIds.has(p.materialId) ? p.materialId : materials[0].id,
      };
    });

  const b = modelBounds(parts);
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const floor = b.min.y;
  for (const p of parts) {
    p.position = { x: round(p.position.x - cx), y: round(p.position.y - floor), z: round(p.position.z - cz) };
    p.size = { x: round(p.size.x), y: round(p.size.y), z: round(p.size.z) };
  }
  return {
    category: input.category || "other",
    dims: {
      w: round(b.max.x - b.min.x),
      d: round(b.max.z - b.min.z),
      h: round(b.max.y - b.min.y),
    },
    parts,
    materials,
    notes: input.notes ?? "",
  };
}

function round(v: number) {
  return Math.round(v * 10) / 10;
}

/**
 * Stretches a model so its bounding box matches `target`. Parts scale along the item's
 * axes, so a rotated part distorts slightly. That's fine for the rough approximations
 * these models are.
 */
export function scaleModelTo(model: ParametricModel, target: Partial<Dimensions>): ParametricModel {
  const fx = target.w && model.dims.w > 0 ? target.w / model.dims.w : 1;
  const fy = target.h && model.dims.h > 0 ? target.h / model.dims.h : 1;
  const fz = target.d && model.dims.d > 0 ? target.d / model.dims.d : 1;
  return scaleModel(model, { x: fx, y: fy, z: fz });
}

export function scaleModel(model: ParametricModel, f: Vec3): ParametricModel {
  const parts = model.parts.map((p) => {
    // Size is measured in the part's own rotated frame. For parts rotated a quarter turn
    // about Y (common for side rails), swap the x/z factors so the result stays sensible.
    const quarter = Math.round(Math.abs(p.rotation.y) / 90) % 2 === 1;
    const sxF = quarter ? f.z : f.x;
    const szF = quarter ? f.x : f.z;
    const isRound = p.shape === "cylinder" || p.shape === "cone";
    const radial = isRound ? Math.sqrt(sxF * szF) : 1;
    return {
      ...p,
      position: { x: p.position.x * f.x, y: p.position.y * f.y, z: p.position.z * f.z },
      size: isRound
        ? { x: p.size.x * radial, y: p.size.y * f.y, z: p.size.z * radial }
        : { x: p.size.x * sxF, y: p.size.y * f.y, z: p.size.z * szF },
      cornerRadius: p.cornerRadius * Math.min(f.x, f.y, f.z),
    };
  });
  return normalizeModel({ ...model, parts });
}

/** Plain-text digest of a model, used when asking Claude about library items. */
export function describeModel(model: ParametricModel | null): string {
  if (!model) return "no model yet";
  const mats = model.materials.map((m) => `${m.name} (${m.kind}, ${m.color})`).join(", ");
  return `${model.category}, ${model.dims.w}×${model.dims.d}×${model.dims.h} cm (w×d×h); materials: ${mats}`;
}
