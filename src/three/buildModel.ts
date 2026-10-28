import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { MaterialKind, ModelMaterial, ModelPart, ParametricModel } from "../../shared/types.ts";

export const CM = 0.01; // scene units are meters
const DEG = Math.PI / 180;

// ---------- Procedural textures (one canvas per kind, tinted by material color) ----------

const textureCache = new Map<string, THREE.Texture>();

function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export type SurfaceKind = MaterialKind | "carpet";

function paintTexture(kind: SurfaceKind): THREE.Texture | null {
  if (!["wood", "fabric", "leather", "stone", "rattan", "plant", "carpet"].includes(kind)) return null;
  const cached = textureCache.get(kind);
  if (cached) return cached;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const r = rand(kind.length * 97 + 13);
  // Textures are grayscale around white; the material color tints them
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, size, size);
  if (kind === "wood") {
    for (let i = 0; i < 70; i++) {
      const y = r() * size;
      g.strokeStyle = `rgba(60,40,20,${0.04 + r() * 0.1})`;
      g.lineWidth = 0.5 + r() * 2.5;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) g.lineTo(x, y + Math.sin(x / 40 + i) * 3 + (r() - 0.5) * 2);
      g.stroke();
    }
  } else if (kind === "fabric" || kind === "carpet") {
    const img = g.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const p = i / 4;
      const x = p % size;
      const y = Math.floor(p / size);
      const weave = (x % 4 < 2) !== (y % 4 < 2) ? 10 : 0;
      const v = 240 - weave - r() * (kind === "carpet" ? 40 : 22);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
    g.putImageData(img, 0, 0);
  } else if (kind === "leather" || kind === "stone") {
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * (kind === "stone" ? 0.025 : 0.035)})`;
      const s = 2 + r() * (kind === "stone" ? 26 : 8);
      g.beginPath();
      g.arc(r() * size, r() * size, s, 0, Math.PI * 2);
      g.fill();
    }
    if (kind === "stone")
      for (let i = 0; i < 6; i++) {
        g.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
        g.lineWidth = 0.6;
        g.beginPath();
        let x = r() * size;
        let y = 0;
        g.moveTo(x, y);
        while (y < size) {
          x += (r() - 0.5) * 30;
          y += 10 + r() * 20;
          g.lineTo(x, y);
        }
        g.stroke();
      }
  } else if (kind === "rattan") {
    g.fillStyle = "#e9e1d3";
    g.fillRect(0, 0, size, size);
    g.strokeStyle = "rgba(90,60,30,0.35)";
    g.lineWidth = 2;
    for (let i = -size; i < size * 2; i += 16) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + size, size);
      g.stroke();
      g.beginPath();
      g.moveTo(i + size, 0);
      g.lineTo(i, size);
      g.stroke();
    }
  } else if (kind === "plant") {
    for (let i = 0; i < 260; i++) {
      const v = 120 + r() * 135;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.ellipse(r() * size, r() * size, 6 + r() * 10, 3 + r() * 4, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(kind, tex);
  return tex;
}

export function makeMaterial(
  m: Pick<ModelMaterial, "color" | "roughness" | "metalness" | "opacity"> & { kind: SurfaceKind },
  repeat: [number, number] = [1, 1],
  opts: { ghost?: boolean; tint?: string | null } = {},
): THREE.MeshStandardMaterial {
  const base = paintTexture(m.kind);
  let map: THREE.Texture | null = null;
  if (base) {
    map = base.clone();
    map.repeat.set(repeat[0], repeat[1]);
    map.needsUpdate = true;
  }
  const color = new THREE.Color(m.color);
  if (opts.tint) color.lerp(new THREE.Color(opts.tint), 0.55);
  const transparent = m.opacity < 1 || opts.ghost;
  const mat = new THREE.MeshStandardMaterial({
    color,
    map,
    roughness: m.roughness,
    metalness: m.metalness,
    transparent,
    opacity: opts.ghost ? Math.min(0.42, m.opacity) : m.opacity,
    depthWrite: !transparent,
  });
  if (m.kind === "glass") {
    mat.roughness = Math.min(mat.roughness, 0.1);
    mat.envMapIntensity = 1.5;
  }
  return mat;
}

// ---------- Geometry ----------

function partGeometry(p: ModelPart): THREE.BufferGeometry {
  const s = { x: p.size.x * CM, y: p.size.y * CM, z: p.size.z * CM };
  switch (p.shape) {
    case "roundedBox": {
      const r = Math.min(p.cornerRadius * CM, s.x / 2, s.y / 2, s.z / 2) * 0.999;
      return r > 0.0005 ? new RoundedBoxGeometry(s.x, s.y, s.z, 3, r) : new THREE.BoxGeometry(s.x, s.y, s.z);
    }
    case "cylinder": {
      const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
      g.scale(s.x, s.y, s.z);
      return g;
    }
    case "cone": {
      // Lampshade-friendly: a truncated cone, wide at the bottom
      const g = new THREE.CylinderGeometry(0.32, 0.5, 1, 28, 1, true);
      g.scale(s.x, s.y, s.z);
      return g;
    }
    case "sphere": {
      const g = new THREE.SphereGeometry(0.5, 28, 20);
      g.scale(s.x, s.y, s.z);
      return g;
    }
    case "torus": {
      const tube = s.y / 2;
      const radius = Math.max(s.x / 2 - tube, tube);
      return new THREE.TorusGeometry(radius, tube, 14, 36);
    }
    default:
      return new THREE.BoxGeometry(s.x, s.y, s.z);
  }
}

export interface BuildOptions {
  ghost?: boolean;
  tint?: string | null;
  highlightPartId?: string | null;
}

/** Builds a three.js group for a parametric model. Its origin is the footprint center at floor level. */
export function buildModelObject(model: ParametricModel, opts: BuildOptions = {}): THREE.Group {
  const group = new THREE.Group();
  const mats = new Map(model.materials.map((m) => [m.id, m]));
  for (const p of model.parts) {
    const spec = mats.get(p.materialId) ?? model.materials[0];
    const big = Math.max(p.size.x, p.size.z);
    const repeat: [number, number] = [Math.max(0.5, big / 60), Math.max(0.5, p.size.y / 60)];
    const material = makeMaterial(spec, repeat, {
      ghost: opts.ghost,
      tint: opts.highlightPartId === p.id ? "#d97a3a" : opts.tint,
    });
    if (p.shape === "cone") material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(partGeometry(p), material);
    mesh.position.set(p.position.x * CM, p.position.y * CM, p.position.z * CM);
    mesh.rotation.set(p.rotation.x * DEG, p.rotation.y * DEG, p.rotation.z * DEG);
    mesh.castShadow = !opts.ghost;
    mesh.receiveShadow = true;
    mesh.userData.partId = p.id;
    group.add(mesh);
  }
  return group;
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) {
      const map = (mat as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
      mat.dispose();
    }
  });
}
