import * as THREE from "three";
import { useEffect, useState } from "react";
import type { ParametricModel } from "../../shared/types.ts";
import { CM, buildModelObject, disposeObject } from "./buildModel.ts";

// Library cards show a rendered snapshot of each model. One shared offscreen renderer
// avoids creating a WebGL context per card.

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();
const queue: { key: string; model: ParametricModel; resolve: (url: string) => void }[] = [];
let busy = false;

function setup() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(400, 300, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

function render(model: ParametricModel): string {
  const r = setup();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a990, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff1e0, 0.7);
  fill.position.set(-3, 2, -1);
  scene.add(fill);
  const obj = buildModelObject(model);
  scene.add(obj);
  const { w, d, h } = model.dims;
  const radius = Math.max(Math.hypot(w, d, h) * CM * 0.5, 0.05);
  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.01, 100);
  const dir = new THREE.Vector3(0.75, 0.55, 1).normalize();
  const center = new THREE.Vector3(0, (h * CM) / 2, 0);
  camera.position.copy(center).addScaledVector(dir, radius / Math.sin((15 * Math.PI) / 180));
  camera.lookAt(center);
  r.render(scene, camera);
  const url = r.domElement.toDataURL("image/png");
  disposeObject(obj);
  return url;
}

function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  requestAnimationFrame(() => {
    try {
      const url = cache.get(job.key) ?? render(job.model);
      cache.set(job.key, url);
      job.resolve(url);
    } catch {
      job.resolve("");
    }
    busy = false;
    pump();
  });
}

export function useModelThumbnail(key: string, model: ParametricModel | null): string | null {
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    if (!model) {
      setUrl(null);
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let live = true;
    queue.push({ key, model, resolve: (u) => live && setUrl(u) });
    pump();
    return () => {
      live = false;
    };
  }, [key, model]);
  return url;
}
