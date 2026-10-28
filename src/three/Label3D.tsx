import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * A text label pinned to a 3D point. Lighter than drei's <Html> (one DOM node, no React root
 * per label) and free of its React 19 unmount races.
 */
export function Label3D({ position, text, className = "label3d" }: { position: [number, number, number]; text: string; className?: string }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const el = useMemo(() => {
    const d = document.createElement("div");
    d.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;will-change:transform;z-index:2;";
    d.appendChild(document.createElement("span"));
    return d;
  }, []);
  useEffect(() => {
    gl.domElement.parentElement?.appendChild(el);
    return () => el.remove();
  }, [el, gl]);
  useEffect(() => {
    const span = el.firstChild as HTMLSpanElement;
    span.className = className;
    span.textContent = text;
  }, [el, text, className]);
  const v = useMemo(() => new THREE.Vector3(), []);
  const [x, y, z] = position;
  useFrame(() => {
    v.set(x, y, z).project(camera);
    const visible = v.z > -1 && v.z < 1;
    el.style.display = visible ? "" : "none";
    if (visible) {
      const sx = (v.x * 0.5 + 0.5) * size.width;
      const sy = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
    }
  });
  return null;
}
