import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Label3D } from "../three/Label3D.tsx";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import * as THREE from "three";
import type { Layout, LayoutLine, LibraryItem, Placement, Vec2 } from "../../shared/types.ts";
import {
  add,
  clearances,
  dot,
  fixtureDefaults,
  fixtureRect,
  floorPolygon,
  isFixture,
  isOpening,
  isWall,
  layoutBounds,
  lineLength,
  openingsOnWall,
  polygonCentroid,
  scale,
  snapAngle,
  snapToWall,
  sub,
  wallPieces,
  wallThickness,
  type OBB,
} from "../../shared/geometry.ts";
import { CM, makeMaterial } from "../three/buildModel.ts";
import { ModelObject } from "../three/ItemViewer.tsx";
import { useLen } from "../components/ui.tsx";

const DEG = Math.PI / 180;

export type WallMode = "auto" | "full" | "cutaway" | "hidden";
export type CameraPreset = "orbit" | "top" | "eye";

export function placementOBB(p: Placement, item: LibraryItem | undefined): OBB | null {
  if (!item?.model) return null;
  return { center: { x: p.x, y: p.y }, hw: item.model.dims.w / 2, hd: item.model.dims.d / 2, angle: p.rotation * DEG };
}

/** Rugs and other flat pieces don't collide with anything. */
export const isFlat = (item: LibraryItem | undefined) => !item?.model || item.category === "rug" || item.model.dims.h < 3;

// ---------- Static room geometry ----------

function Box({
  center,
  size,
  rotY,
  color,
  opacity = 1,
  kind = "plain",
  castShadow = true,
}: {
  center: [number, number, number];
  size: [number, number, number];
  rotY: number;
  color: string;
  opacity?: number;
  kind?: "plain" | "stone" | "wood" | "glass" | "metal";
  castShadow?: boolean;
}) {
  const mat = useMemo(
    () =>
      makeMaterial({
        kind,
        color,
        roughness: kind === "glass" ? 0.05 : kind === "metal" ? 0.3 : 0.85,
        metalness: kind === "metal" ? 0.8 : kind === "glass" ? 0.3 : 0,
        opacity,
      }),
    [kind, color, opacity],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh position={center.map((v) => v * CM) as [number, number, number]} rotation={[0, rotY, 0]} castShadow={castShadow} receiveShadow material={mat}>
      <boxGeometry args={size.map((v) => Math.max(v, 0.1) * CM) as [number, number, number]} />
    </mesh>
  );
}

const lineAngle = (l: { a: Vec2; b: Vec2 }) => Math.atan2(-(l.b.y - l.a.y), l.b.x - l.a.x);

/**
 * In "auto" (dollhouse) mode, walls standing between the camera and the room drop to a low
 * base so you can see in from any angle.
 */
function useHiddenWalls(layout: Layout, mode: WallMode): Set<string> {
  const camera = useThree((st) => st.camera);
  const [key, setKey] = useState("");
  const keyRef = useRef("");
  const centroid = useMemo(() => {
    const poly = floorPolygon(layout);
    return poly.length ? polygonCentroid(poly) : null;
  }, [layout]);
  useFrame(() => {
    let next = "";
    if (mode === "auto" && centroid) {
      const cam = { x: camera.position.x / CM, y: camera.position.z / CM };
      const ids: string[] = [];
      for (const w of layout.lines) {
        if (!isWall(w)) continue;
        const L = lineLength(w);
        if (L < 1) continue;
        const mid = scale(add(w.a, w.b), 0.5);
        const n = { x: -(w.b.y - w.a.y) / L, y: (w.b.x - w.a.x) / L };
        const sCam = dot(sub(cam, mid), n);
        const sIn = dot(sub(centroid, mid), n);
        if (sCam * sIn < 0 && Math.abs(sCam) > wallThickness(w, layout)) ids.push(w.id);
      }
      next = ids.join(",");
    }
    if (next !== keyRef.current) {
      keyRef.current = next;
      setKey(next);
    }
  });
  return useMemo(() => new Set(key ? key.split(",") : []), [key]);
}

function Walls({ layout, mode }: { layout: Layout; mode: WallMode }) {
  const hidden = useHiddenWalls(layout, mode);
  if (mode === "hidden") return null;
  const cut = mode === "cutaway" ? 100 : Infinity;
  return (
    <>
      {layout.lines.filter(isWall).map((w) => {
        const L = lineLength(w);
        if (L < 1) return null;
        const dir = scale(sub(w.b, w.a), 1 / L);
        const T = wallThickness(w, layout);
        const rot = lineAngle(w);
        const wallCut = hidden.has(w.id) ? 12 : cut;
        return wallPieces(w, layout).map((p, i) => {
          // Extend pieces at the wall's ends by half a thickness so corners close
          const from = p.from < 0.5 ? -T / 2 : p.from;
          const to = p.to > L - 0.5 ? L + T / 2 : p.to;
          const top = Math.min(p.top, wallCut);
          if (top <= p.bottom) return null;
          const c = add(w.a, scale(dir, (from + to) / 2));
          return (
            <Box
              key={`${w.id}-${i}`}
              center={[c.x, (p.bottom + top) / 2, c.y]}
              size={[to - from, top - p.bottom, T]}
              rotY={rot}
              color={w.type === "wall-exterior" ? layout.wallColor : shade(layout.wallColor, -0.03)}
            />
          );
        });
      })}
      {mode !== "cutaway" && <Openings layout={layout} hiddenWalls={hidden} />}
    </>
  );
}

function Openings({ layout, hiddenWalls }: { layout: Layout; hiddenWalls: Set<string> }) {
  const floor = floorPolygon(layout);
  const centroid = floor.length ? polygonCentroid(floor) : null;
  const walls = layout.lines.filter(isWall);
  const items: ReactElement[] = [];
  for (const o of layout.lines.filter(isOpening)) {
    const wall = walls.find((w) => openingsOnWall(w, layout).some((x) => x.line.id === o.id));
    if (wall && hiddenWalls.has(wall.id) && o.type === "window") continue;
    const T = wall ? wallThickness(wall, layout) : layout.wallThickness;
    const W = lineLength(o);
    if (W < 5) continue;
    const dir = scale(sub(o.b, o.a), 1 / W);
    const mid = scale(add(o.a, o.b), 0.5);
    const rot = lineAngle(o);
    if (o.type === "window") {
      const sill = o.sill ?? 90;
      const head = o.height ?? 210;
      items.push(
        <Box key={o.id + "g"} center={[mid.x, (sill + head) / 2, mid.y]} size={[W, head - sill, 1.2]} rotY={rot} color="#cfe2ea" opacity={0.28} kind="glass" castShadow={false} />,
        <Box key={o.id + "s"} center={[mid.x, sill - 2, mid.y]} size={[W + 6, 4, T + 6]} rotY={rot} color="#f4f1ec" />,
        <Box key={o.id + "m"} center={[mid.x, (sill + head) / 2, mid.y]} size={[3, head - sill, 4]} rotY={rot} color="#f4f1ec" />,
      );
    } else if (o.type === "door") {
      const n = { x: -dir.y, y: dir.x };
      const inward = centroid ? (dot(sub(centroid, mid), n) >= 0 ? 1 : -1) : 1;
      const s = inward * (o.swingIn === false ? -1 : 1);
      const hinge = o.swing === "right" ? o.b : o.a;
      const other = o.swing === "right" ? o.a : o.b;
      const closed = scale(sub(other, hinge), 1 / W);
      const open = scale(n, s);
      const a = 70 * DEG;
      const leafDir = add(scale(closed, Math.cos(a)), scale(open, Math.sin(a)));
      const c = add(hinge, scale(leafDir, W / 2));
      const head = o.height ?? 210;
      items.push(
        <Box key={o.id + "l"} center={[c.x, head / 2, c.y]} size={[W - 2, head - 1, 4]} rotY={Math.atan2(-leafDir.y, leafDir.x)} color="#efe8dc" kind="wood" />,
      );
    }
  }
  return <>{items}</>;
}

function Fixtures({ layout }: { layout: Layout }) {
  return (
    <>
      {layout.lines.filter(isFixture).map((l: LayoutLine) => {
        const r = fixtureRect(l);
        const h = l.height ?? fixtureDefaults(l.type).height;
        const size: [number, number, number] = [r.hw * 2, h, r.hd * 2];
        const c = r.center;
        switch (l.type) {
          case "counter":
          case "cabinet":
            return (
              <group key={l.id}>
                <Box center={[c.x, (h - 4) / 2, c.y]} size={[size[0], h - 4, size[2] - 2]} rotY={r.angle} color={l.type === "cabinet" ? "#ebe5dc" : "#e3ddd3"} kind="wood" />
                <Box center={[c.x, h - 2, c.y]} size={[size[0], 4, size[2]]} rotY={r.angle} color="#d8d4ce" kind="stone" />
              </group>
            );
          case "fireplace":
            return (
              <group key={l.id}>
                <Box center={[c.x, h / 2, c.y]} size={size} rotY={r.angle} color="#cdc6bc" kind="stone" />
                <Box center={[c.x, h * 0.3, c.y]} size={[size[0] * 0.55, h * 0.45, size[2] + 0.5]} rotY={r.angle} color="#2a2522" />
              </group>
            );
          case "column":
            return <Box key={l.id} center={[c.x, h / 2, c.y]} size={size} rotY={r.angle} color={layout.wallColor} />;
          default:
            return <Box key={l.id} center={[c.x, h / 2 + 12, c.y]} size={size} rotY={r.angle} color="#f6f6f4" kind="metal" />;
        }
      })}
    </>
  );
}

function Floor({ layout }: { layout: Layout }) {
  const poly = floorPolygon(layout);
  const geom = useMemo(() => {
    if (poly.length < 3) return null;
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x * CM, -p.y * CM)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [JSON.stringify(poly)]); // eslint-disable-line react-hooks/exhaustive-deps
  const mat = useMemo(
    () => makeMaterial({ kind: layout.floorKind === "plain" ? "plain" : layout.floorKind, color: layout.floorColor, roughness: 0.75, metalness: 0, opacity: 1 }, [1.2, 1.2]),
    [layout.floorKind, layout.floorColor],
  );
  if (!geom) return null;
  return <mesh geometry={geom} material={mat} receiveShadow position={[0, 0.0005, 0]} />;
}

function Zones({ layout }: { layout: Layout }) {
  return (
    <>
      {layout.zones.map((z) => {
        if (z.points.length < 3) return null;
        const shape = new THREE.Shape(z.points.map((p) => new THREE.Vector2(p.x * CM, -p.y * CM)));
        const c = polygonCentroid(z.points);
        return (
          <group key={z.id}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
              <shapeGeometry args={[shape]} />
              <meshBasicMaterial color={z.color} transparent opacity={0.22} depthWrite={false} />
            </mesh>
            <Label3D position={[c.x * CM, 0.01, c.y * CM]} text={z.label} className="zone-label3d" />
          </group>
        );
      })}
    </>
  );
}

function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

// ---------- Furniture ----------

function SelectionBox({ item, color }: { item: LibraryItem; color: string }) {
  const { w, d, h } = item.model!.dims;
  const geom = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w * CM + 0.02, h * CM + 0.02, d * CM + 0.02)), [w, d, h]);
  return (
    <lineSegments geometry={geom} position={[0, (h * CM) / 2, 0]}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  );
}

interface DragState {
  id: string;
  offset: Vec2;
  pointerId: number;
}

function PlacedItem({
  placement: p,
  item,
  selected,
  colliding,
  showDraft,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  placement: Placement;
  item: LibraryItem;
  selected: boolean;
  colliding: boolean;
  showDraft: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>, p: Placement) => void;
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (e: ThreeEvent<PointerEvent>) => void;
}) {
  if (!item.model || (p.draft && !showDraft)) return null;
  return (
    <group
      position={[p.x * CM, p.elevation * CM, p.y * CM]}
      rotation={[0, p.rotation * DEG, 0]}
      onPointerDown={(e) => onPointerDown(e, p)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <ModelObject model={item.model} ghost={p.draft} tint={colliding ? "#e0483a" : null} />
      {(selected || colliding) && <SelectionBox item={item} color={colliding ? "#d2412f" : "#c4793f"} />}
    </group>
  );
}

function ClearanceLines({ obb, obstacles, elevation }: { obb: OBB; obstacles: OBB[]; elevation: number }) {
  const len = useLen();
  const lines = clearances(obb, obstacles, 300);
  const y = Math.max(elevation, 0) * CM + 0.02;
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(lines.flatMap((c) => [c.from.x * CM, y, c.from.y * CM, c.to.x * CM, y, c.to.y * CM]), 3));
    return g;
  }, [JSON.stringify(lines), y]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      <lineSegments geometry={geom}>
        <lineBasicMaterial color="#8b5e3c" />
      </lineSegments>
      {lines
        .filter((c) => c.distance >= 1)
        .map((c) => {
          const mid = scale(add(c.from, c.to), 0.5);
          return (
            <Label3D key={c.side} position={[mid.x * CM, y, mid.y * CM]} text={len(c.distance)} className={`label3d ${c.distance < 45 ? "warn" : ""}`} />
          );
        })}
    </group>
  );
}

function CameraRig({ preset, layout, nonce }: { preset: CameraPreset; layout: Layout; nonce: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  useEffect(() => {
    const { min, max } = layoutBounds(layout);
    const cx = ((min.x + max.x) / 2) * CM;
    const cz = ((min.y + max.y) / 2) * CM;
    const span = Math.max(max.x - min.x, max.y - min.y, 300) * CM;
    const target = new THREE.Vector3(cx, preset === "eye" ? 1.1 : 0, cz);
    if (preset === "top") camera.position.set(cx, span * 1.5, cz + 0.001);
    else if (preset === "eye") camera.position.set(cx, 1.6, cz + span * 0.45);
    else camera.position.set(cx + span * 0.7, span * 1.05, cz + span * 1.2);
    camera.near = 0.02;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(target);
      controls.update();
    } else camera.lookAt(target);
  }, [preset, nonce, controls]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Disables orbiting while a piece is being dragged. */
function ControlsLock({ locked }: { locked: boolean }) {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  useEffect(() => {
    if (controls) controls.enabled = !locked;
  }, [locked, controls]);
  return null;
}

// ---------- Scene ----------

export interface RoomSceneProps {
  layout: Layout;
  placements: Placement[];
  items: Map<string, LibraryItem>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, patch: Partial<Placement>, commit: boolean) => void;
  collisions: Set<string>;
  obstacleOBBs: (excludeId: string) => OBB[];
  wallMode: WallMode;
  preset: CameraPreset;
  presetNonce: number;
  showDrafts: boolean;
  snapping: boolean;
  dragging: boolean;
  setDragging: (v: boolean) => void;
}

export function RoomScene(props: RoomSceneProps) {
  const { layout, placements, items, selectedId, onSelect, onMove, collisions, wallMode, preset, presetNonce, showDrafts, snapping } = props;
  const drag = useRef<DragState | null>(null);
  const interior = useMemo(() => {
    const poly = floorPolygon(layout);
    return poly.length ? polygonCentroid(poly) : null;
  }, [layout]);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hitPoint = (e: ThreeEvent<PointerEvent>): Vec2 | null => {
    const v = new THREE.Vector3();
    return e.ray.intersectPlane(plane, v) ? { x: v.x / CM, y: v.z / CM } : null;
  };

  const handleDown = (e: ThreeEvent<PointerEvent>, p: Placement) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(p.id);
    const hit = hitPoint(e);
    if (!hit) return;
    (e.target as unknown as Element).setPointerCapture(e.pointerId);
    drag.current = { id: p.id, offset: sub(hit, { x: p.x, y: p.y }), pointerId: e.pointerId };
    props.setDragging(true);
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    const hit = hitPoint(e);
    const p = placements.find((x) => x.id === d.id);
    const item = p && items.get(p.itemId);
    if (!hit || !p || !item?.model) return;
    let pos = sub(hit, d.offset);
    let rotation = p.rotation;
    const free = !snapping || e.altKey;
    if (!free) {
      pos = { x: Math.round(pos.x / 5) * 5, y: Math.round(pos.y / 5) * 5 };
      const snapped = item.category !== "rug" ? snapToWall({ center: pos, hw: item.model.dims.w / 2, hd: item.model.dims.d / 2, angle: rotation * DEG }, layout, 25, interior ?? undefined) : null;
      if (snapped) {
        pos = snapped.center;
        rotation = snapAngle(snapped.angle / DEG, 1);
      }
    }
    onMove(d.id, { x: pos.x, y: pos.y, rotation }, false);
  };

  const handleUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    (e.target as unknown as Element).releasePointerCapture?.(d.pointerId);
    drag.current = null;
    props.setDragging(false);
    onMove(d.id, {}, true);
  };

  const selected = placements.find((p) => p.id === selectedId);
  const selectedItem = selected && items.get(selected.itemId);
  const selectedOBB = selected ? placementOBB(selected, selectedItem) : null;

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 45, position: [6, 6, 6] }} onPointerMissed={() => onSelect(null)} gl={{ preserveDrawingBuffer: true }}>
      <color attach="background" args={[getComputedStyle(document.documentElement).getPropertyValue("--canvas-bg").trim() || "#ece7df"]} />
      <hemisphereLight args={[0xffffff, 0xb5a58f, 1.25]} />
      <directionalLight
        position={[6, 10, 4]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-bias={-0.0004}
      />
      <ambientLight intensity={0.25} />
      <Floor layout={layout} />
      <Zones layout={layout} />
      <Walls layout={layout} mode={wallMode} />
      <Fixtures layout={layout} />
      {placements.map((p) => {
        const item = items.get(p.itemId);
        if (!item) return null;
        return (
          <PlacedItem
            key={p.id}
            placement={p}
            item={item}
            selected={p.id === selectedId}
            colliding={collisions.has(p.id)}
            showDraft={showDrafts}
            onPointerDown={handleDown}
            onPointerMove={handleMove}
            onPointerUp={handleUp}
          />
        );
      })}
      {selectedOBB && selected && <ClearanceLines obb={selectedOBB} obstacles={props.obstacleOBBs(selected.id)} elevation={selected.elevation} />}
      <gridHelper args={[60, 60, "#d4cabd", "#e0d8cd"]} position={[0, -0.002, 0]} />
      <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2 - 0.03} minDistance={0.5} maxDistance={60} />
      <ControlsLock locked={props.dragging} />
      <CameraRig preset={preset} layout={layout} nonce={presetNonce} />
    </Canvas>
  );
}
