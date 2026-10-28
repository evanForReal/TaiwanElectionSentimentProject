import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Label3D } from "./Label3D.tsx";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ParametricModel } from "../../shared/types.ts";
import { CM, buildModelObject, disposeObject, type BuildOptions } from "./buildModel.ts";
import { useLen } from "../components/ui.tsx";

export function ModelObject({ model, ...opts }: { model: ParametricModel } & BuildOptions) {
  const obj = useMemo(() => buildModelObject(model, opts), [model, opts.ghost, opts.tint, opts.highlightPartId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => disposeObject(obj), [obj]);
  return <primitive object={obj} />;
}

function DimensionLines({ model }: { model: ParametricModel }) {
  const len = useLen();
  const { w, d, h } = model.dims;
  const [x, y, z] = [(w * CM) / 2, h * CM, (d * CM) / 2];
  const geom = useMemo(() => {
    const pts = [
      // width along the front bottom edge
      [-x, 0.002, z + 0.04, x, 0.002, z + 0.04],
      // depth along the right bottom edge
      [x + 0.04, 0.002, -z, x + 0.04, 0.002, z],
      // height at the front-left corner
      [-x - 0.04, 0, z, -x - 0.04, y, z],
    ].flat();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [x, y, z]);
  return (
    <group>
      <lineSegments geometry={geom}>
        <lineBasicMaterial color="#8b5e3c" />
      </lineSegments>
      <Label3D position={[0, 0, z + 0.04]} text={len(w)} />
      <Label3D position={[x + 0.04, 0, 0]} text={len(d)} />
      <Label3D position={[-x - 0.04, y / 2, z]} text={len(h)} />
    </group>
  );
}

export function ItemViewer({
  model,
  showDims = true,
  highlightPartId,
}: {
  model: ParametricModel;
  showDims?: boolean;
  highlightPartId?: string | null;
}) {
  const { w, d, h } = model.dims;
  const radius = Math.max(Math.hypot(w, d, h) * CM * 0.5, 0.1);
  const target: [number, number, number] = [0, (h * CM) / 2, 0];
  const cam: [number, number, number] = [radius * 1.6, radius * 1.3 + target[1], radius * 2.2];
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: cam, fov: 35, near: 0.01, far: 100 }} gl={{ preserveDrawingBuffer: true }}>
      <hemisphereLight args={[0xffffff, 0xb8a990, 1.5]} />
      <directionalLight
        position={[2.5, 5, 3.5]}
        intensity={2.3}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
      />
      <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#fff1e0" />
      <ModelObject model={model} highlightPartId={highlightPartId} />
      {showDims && <DimensionLines model={model} />}
      <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={Math.max(2, radius * 5)} blur={2.2} far={Math.max(1, h * CM)} />
      <gridHelper args={[10, 50, "#c9bfb1", "#ddd5ca"]} position={[0, -0.001, 0]} />
      <OrbitControls target={target} makeDefault enableDamping maxPolarAngle={Math.PI / 2 - 0.02} minDistance={0.2} maxDistance={12} />
    </Canvas>
  );
}
