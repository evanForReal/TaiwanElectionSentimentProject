import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Layout, LayoutLine, LibraryItem, Placement, Vec2, Zone } from "../../shared/types.ts";
import { LINE_TYPES, OPENING_TYPES } from "../../shared/types.ts";
import {
  add,
  closestOnSegment,
  cross,
  dist,
  dot,
  fixtureRect,
  floorPolygon,
  isFixture,
  isOpening,
  isWall,
  layoutBounds,
  len,
  lineLength,
  obbCorners,
  polygonCentroid,
  rescaleLayout,
  scale,
  sub,
  wallThickness,
} from "../../shared/geometry.ts";
import { formatLength, parseLength } from "../../shared/units.ts";
import { newLocalId } from "../lib/ids.ts";
import { useApp } from "../lib/store.ts";
import { Icon } from "../components/ui.tsx";
import { TOOLS, ZONE_COLORS, type ToolId } from "./tools.ts";
import { LayoutProps } from "./LayoutProps.tsx";

type Selection = { kind: "line" | "point" | "zone"; id: string } | null;
type View = { tx: number; ty: number; z: number }; // screen = plan * z + t

type Drag =
  | { kind: "pan"; start: Vec2; view: View }
  | { kind: "move"; start: Vec2; original: Layout; lineIds: string[]; endpoints: EndpointRef[]; zoneId?: string; pointId?: string }
  | { kind: "endpoint"; original: Layout; refs: EndpointRef[] }
  | { kind: "vertex"; original: Layout; zoneId: string; index: number };

type EndpointRef = { id: string; end: "a" | "b" };

const LINE_TOOL_SET = new Set<string>(LINE_TYPES);

export interface LayoutEditorProps {
  layout: Layout;
  onChange: (layout: Layout) => void;
  placements: Placement[];
  items: Map<string, LibraryItem>;
  onTraceWithClaude?: () => void;
  tracing?: boolean;
}

export function LayoutEditor({ layout, onChange, placements, items, onTraceWithClaude, tracing }: LayoutEditorProps) {
  const units = useApp((s) => s.units);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ tx: 80, ty: 80, z: 1 });
  const [tool, setTool] = useState<ToolId>("select");
  const [sel, setSel] = useState<Selection>(null);
  const [start, setStart] = useState<Vec2 | null>(null); // first point of the line being drawn
  const [chainOrigin, setChainOrigin] = useState<Vec2 | null>(null);
  const [zonePts, setZonePts] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [typed, setTyped] = useState("");
  const [gridStep, setGridStep] = useState(5);
  const [alt, setAlt] = useState(false);
  const [space, setSpace] = useState(false);
  const [showProps, setShowProps] = useState(true);
  const drag = useRef<Drag | null>(null);
  const past = useRef<Layout[]>([]);
  const future = useRef<Layout[]>([]);
  const fitted = useRef(false);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // ----- history -----
  const commit = useCallback(
    (next: Layout, snapshot: Layout = layoutRef.current) => {
      past.current = [...past.current.slice(-80), snapshot];
      future.current = [];
      onChange(next);
    },
    [onChange],
  );
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(layoutRef.current);
    onChange(prev);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(layoutRef.current);
    onChange(next);
  };

  // ----- viewport -----
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const l = layoutRef.current;
    let { min, max } = layoutBounds(l);
    if (l.background) {
      const bg = l.background;
      min = { x: Math.min(min.x, bg.x), y: Math.min(min.y, bg.y) };
      max = { x: Math.max(max.x, bg.x + bg.width * bg.cmPerPx), y: Math.max(max.y, bg.y + bg.height * bg.cmPerPx) };
    }
    const w = Math.max(200, max.x - min.x);
    const h = Math.max(200, max.y - min.y);
    const z = Math.min((size.w - 120) / w, (size.h - 120) / h);
    setView({ z, tx: size.w / 2 - ((min.x + max.x) / 2) * z, ty: size.h / 2 - ((min.y + max.y) / 2) * z });
  }, [size]);

  useEffect(() => {
    if (!fitted.current && size.w > 0) {
      fit();
      fitted.current = true;
    }
  }, [size, fit]);

  const toPlan = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.tx) / view.z, y: (e.clientY - r.top - view.ty) / view.z };
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      setView((v) => {
        const z = Math.min(20, Math.max(0.05, v.z * Math.exp(-e.deltaY * 0.0015)));
        return { z, tx: sx - ((sx - v.tx) / v.z) * z, ty: sy - ((sy - v.ty) / v.z) * z };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ----- snapping -----
  const floor = useMemo(() => floorPolygon(layout), [layout]);
  const centroid = useMemo(() => (floor.length ? polygonCentroid(floor) : null), [floor]);

  const endpoints = useCallback(
    (exclude: Set<string> = new Set()) => [
      ...layout.lines.filter((l) => !exclude.has(l.id)).flatMap((l) => [l.a, l.b]),
      ...layout.zones.flatMap((z) => z.points),
    ],
    [layout],
  );

  const gridSnap = (p: Vec2): Vec2 => ({ x: Math.round(p.x / gridStep) * gridStep, y: Math.round(p.y / gridStep) * gridStep });

  /** Snaps a raw plan point for the active tool. */
  const snap = (raw: Vec2, opts: { from?: Vec2 | null; onWall?: LayoutLine | null; exclude?: Set<string> } = {}): { p: Vec2; wall: LayoutLine | null } => {
    if (alt) return { p: raw, wall: null };
    const tol = 12 / view.z;
    const wantsWall = OPENING_TYPES.includes(tool as LayoutLine["type"]) || tool === "outlet";
    if (opts.onWall) {
      const c = closestOnSegment(raw, opts.onWall.a, opts.onWall.b);
      const L = lineLength(opts.onWall);
      const t = Math.round((c.t * L) / gridStep) * gridStep;
      return { p: add(opts.onWall.a, scale(sub(opts.onWall.b, opts.onWall.a), Math.min(L, Math.max(0, t)) / L)), wall: opts.onWall };
    }
    if (wantsWall) {
      let best: { p: Vec2; wall: LayoutLine; d: number } | null = null;
      for (const w of layout.lines.filter(isWall)) {
        const c = closestOnSegment(raw, w.a, w.b);
        if (c.distance < 30 / view.z && (!best || c.distance < best.d)) best = { p: c.point, wall: w, d: c.distance };
      }
      if (best) return snap(raw, { onWall: best.wall });
    }
    for (const q of endpoints(opts.exclude)) if (dist(q, raw) < tol) return { p: q, wall: null };
    if (opts.from) {
      const v = sub(raw, opts.from);
      const L = len(v);
      if (L > 0) {
        const step = (15 * Math.PI) / 180;
        const ang = Math.round(Math.atan2(v.y, v.x) / step) * step;
        const Ls = Math.round(L / gridStep) * gridStep;
        return { p: add(opts.from, { x: Math.cos(ang) * Ls, y: Math.sin(ang) * Ls }), wall: null };
      }
    }
    return { p: gridSnap(raw), wall: null };
  };

  const [drawWall, setDrawWall] = useState<LayoutLine | null>(null);

  // ----- creating elements -----
  const addLine = (type: LayoutLine["type"], a: Vec2, b: Vec2) => {
    if (dist(a, b) < 2) return null;
    const line: LayoutLine = { id: newLocalId(), type, a, b };
    if (isFixture(line) && centroid) {
      const n = { x: -(b.y - a.y), y: b.x - a.x };
      const mid = scale(add(a, b), 0.5);
      line.side = dot(sub(centroid, mid), n) >= 0 ? 1 : -1;
    }
    commit({ ...layoutRef.current, lines: [...layoutRef.current.lines, line] });
    return line;
  };

  const endChain = () => {
    setStart(null);
    setChainOrigin(null);
    setDrawWall(null);
    setTyped("");
  };

  const finishZone = (pts: Vec2[]) => {
    if (pts.length < 3) return;
    const zone: Zone = {
      id: newLocalId(),
      label: `Zone ${layoutRef.current.zones.length + 1}`,
      color: ZONE_COLORS[layoutRef.current.zones.length % ZONE_COLORS.length],
      points: pts,
    };
    commit({ ...layoutRef.current, zones: [...layoutRef.current.zones, zone] });
    setZonePts([]);
    setTool("select");
    setSel({ kind: "zone", id: zone.id });
  };

  const placePoint = (p: Vec2) => {
    const isLineTool = LINE_TOOL_SET.has(tool);
    if (tool === "column") {
      const line = addLine("column", { x: p.x - 15, y: p.y }, { x: p.x + 15, y: p.y });
      if (line) setSel({ kind: "line", id: line.id });
      return;
    }
    if (tool === "outlet") {
      const id = newLocalId();
      commit({ ...layoutRef.current, points: [...layoutRef.current.points, { id, type: "outlet", at: p }] });
      return;
    }
    if (tool === "zone") {
      if (zonePts.length >= 3 && dist(p, zonePts[0]) < 14 / view.z) finishZone(zonePts);
      else setZonePts([...zonePts, p]);
      return;
    }
    if (!isLineTool) return;
    const type = tool as LayoutLine["type"];
    if (!start) {
      setStart(p);
      setChainOrigin(p);
      return;
    }
    const line = addLine(type, start, p);
    const chains = type === "wall-exterior" || type === "wall-interior";
    if (chains && line) {
      if (chainOrigin && dist(p, chainOrigin) < 0.5) endChain();
      else {
        setStart(p);
        setTyped("");
      }
    } else {
      endChain();
      if (line) {
        setTool("select");
        setSel({ kind: "line", id: line.id });
      }
    }
  };

  // ----- pointer handling -----
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const raw = toPlan(e);
    if (e.button === 1 || space || tool === "pan" || (tool === "select" && e.button === 0)) {
      if (tool === "select" && e.button === 0 && !space) setSel(null);
      drag.current = { kind: "pan", start: { x: e.clientX, y: e.clientY }, view };
      return;
    }
    if (e.button !== 0) return;
    const { p, wall } = snap(raw, { from: start, onWall: drawWall });
    if (!start && wall && OPENING_TYPES.includes(tool as LayoutLine["type"])) setDrawWall(wall);
    placePoint(p);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const raw = toPlan(e);
    const d = drag.current;
    if (d?.kind === "pan") {
      setView({ ...d.view, tx: d.view.tx + e.clientX - d.start.x, ty: d.view.ty + e.clientY - d.start.y });
      return;
    }
    if (d?.kind === "move") {
      const delta = alt ? sub(raw, d.start) : gridSnap(sub(raw, d.start));
      const moved = new Set(d.lineIds);
      const next: Layout = {
        ...d.original,
        lines: d.original.lines.map((l) => {
          if (moved.has(l.id)) return { ...l, a: add(l.a, delta), b: add(l.b, delta) };
          const refs = d.endpoints.filter((r) => r.id === l.id);
          if (refs.length === 0) return l;
          const copy = { ...l };
          for (const r of refs) copy[r.end] = add(l[r.end], delta);
          return copy;
        }),
        zones: d.original.zones.map((z) => (z.id === d.zoneId ? { ...z, points: z.points.map((p) => add(p, delta)) } : z)),
        points: d.original.points.map((p) => (p.id === d.pointId ? { ...p, at: add(p.at, delta) } : p)),
      };
      onChange(next);
      return;
    }
    if (d?.kind === "endpoint") {
      const exclude = new Set(d.refs.map((r) => r.id));
      const ref = d.refs[0];
      const line = d.original.lines.find((l) => l.id === ref.id)!;
      const other = ref.end === "a" ? line.b : line.a;
      const { p } = snap(raw, { from: other, exclude });
      onChange({
        ...d.original,
        lines: d.original.lines.map((l) => {
          const refs = d.refs.filter((r) => r.id === l.id);
          if (!refs.length) return l;
          const copy = { ...l };
          for (const r of refs) copy[r.end] = p;
          return copy;
        }),
      });
      return;
    }
    if (d?.kind === "vertex") {
      const p = alt ? raw : gridSnap(raw);
      onChange({
        ...d.original,
        zones: d.original.zones.map((z) => (z.id === d.zoneId ? { ...z, points: z.points.map((q, i) => (i === d.index ? p : q)) } : z)),
      });
      return;
    }
    if (tool !== "select" && tool !== "pan") setCursor(snap(raw, { from: start, onWall: drawWall }).p);
    else setCursor(null);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.kind !== "pan") {
      // Record the pre-drag layout once the drag finishes
      if (d.original !== layoutRef.current) {
        past.current = [...past.current.slice(-80), d.original];
        future.current = [];
      }
    }
  };

  /** Endpoints of other walls touching this point, so connected walls stretch together. */
  const connectedAt = (p: Vec2, exceptId: string, l0: Layout): EndpointRef[] =>
    l0.lines.flatMap((l) =>
      l.id === exceptId || !isWall(l)
        ? []
        : ([dist(l.a, p) < 0.6 && { id: l.id, end: "a" }, dist(l.b, p) < 0.6 && { id: l.id, end: "b" }].filter(Boolean) as EndpointRef[]),
    );

  const startMoveLine = (e: React.PointerEvent, line: LayoutLine) => {
    if (tool !== "select" || e.button !== 0 || space) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSel({ kind: "line", id: line.id });
    const l0 = layoutRef.current;
    const lineIds = [line.id];
    if (isWall(line)) {
      // Openings on this wall travel with it
      const tol = wallThickness(line, l0) / 2 + 8;
      for (const o of l0.lines.filter(isOpening)) {
        if (closestOnSegment(o.a, line.a, line.b).distance < tol && closestOnSegment(o.b, line.a, line.b).distance < tol) lineIds.push(o.id);
      }
    }
    const endpoints = isWall(line) ? [...connectedAt(line.a, line.id, l0), ...connectedAt(line.b, line.id, l0)] : [];
    drag.current = { kind: "move", start: toPlan(e), original: l0, lineIds, endpoints };
  };

  const startEndpoint = (e: React.PointerEvent, line: LayoutLine, end: "a" | "b") => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const l0 = layoutRef.current;
    const refs: EndpointRef[] = [{ id: line.id, end }, ...(isWall(line) ? connectedAt(line[end], line.id, l0) : [])];
    drag.current = { kind: "endpoint", original: l0, refs };
  };

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setAlt(e.altKey);
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      if (e.type === "keyup") {
        if (e.key === " ") setSpace(false);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === " ") {
        setSpace(true);
        e.preventDefault();
        return;
      }
      // Typed lengths while drawing: "350", "3.5m", "11'6"
      if (start && /^[0-9.'"a-z]$/i.test(e.key) && !mod && (/[0-9.'"]/.test(e.key) || typed.length > 0)) {
        setTyped((t) => t + e.key);
        e.preventDefault();
        return;
      }
      if (start && e.key === "Backspace" && typed) {
        setTyped((t) => t.slice(0, -1));
        e.preventDefault();
        return;
      }
      if (e.key === "Enter") {
        if (start && typed) {
          const L = parseLength(typed, units);
          const ref = cursor ?? add(start, { x: 1, y: 0 });
          const v = sub(ref, start);
          const n = len(v) > 0 ? scale(v, 1 / len(v)) : { x: 1, y: 0 };
          if (L) placePoint(add(start, scale(n, L)));
          setTyped("");
        } else if (tool === "zone" && zonePts.length >= 3) finishZone(zonePts);
        else endChain();
        return;
      }
      if (e.key === "Escape") {
        if (start || zonePts.length) {
          endChain();
          setZonePts([]);
        } else {
          setSel(null);
          setTool("select");
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        deleteSelection();
        return;
      }
      if (!mod) {
        const t = TOOLS.find((t) => t.key === e.key.toLowerCase());
        if (t) {
          setTool(t.id);
          endChain();
          setZonePts([]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  });

  const deleteSelection = () => {
    if (!sel) return;
    const l = layoutRef.current;
    commit({
      ...l,
      lines: sel.kind === "line" ? l.lines.filter((x) => x.id !== sel.id) : l.lines,
      zones: sel.kind === "zone" ? l.zones.filter((x) => x.id !== sel.id) : l.zones,
      points: sel.kind === "point" ? l.points.filter((x) => x.id !== sel.id) : l.points,
    });
    setSel(null);
  };

  const calibrate = (line: LayoutLine, realLength: number) => {
    const measured = lineLength(line);
    if (measured < 1 || realLength <= 0) return;
    const next = rescaleLayout(layoutRef.current, realLength / measured);
    commit({ ...next, lines: next.lines.map((l) => (l.id === line.id ? { ...l, realLength } : l)) });
    setTimeout(fit, 0);
  };

  // ----- rendering helpers -----
  const z = view.z;
  const px = (n: number) => n / z; // screen pixels → plan units
  const lenText = (cm: number) => formatLength(cm, units);
  const selectedLine = sel?.kind === "line" ? layout.lines.find((l) => l.id === sel.id) ?? null : null;

  const visible = {
    x0: -view.tx / z,
    y0: -view.ty / z,
    x1: (size.w - view.tx) / z,
    y1: (size.h - view.ty) / z,
  };
  const minor = gridStep * (z * gridStep * 2 < 8 ? 10 : 2);
  const major = 100 * (z * 100 < 30 ? 5 : 1);

  const doorGraphic = (l: LayoutLine) => {
    const W = lineLength(l);
    const dir = scale(sub(l.b, l.a), 1 / W);
    const n = { x: -dir.y, y: dir.x };
    const mid = scale(add(l.a, l.b), 0.5);
    const inward = centroid ? (dot(sub(centroid, mid), n) >= 0 ? 1 : -1) : 1;
    const s = inward * (l.swingIn === false ? -1 : 1);
    const hinge = l.swing === "right" ? l.b : l.a;
    const other = l.swing === "right" ? l.a : l.b;
    const leaf = add(hinge, scale(n, s * W));
    const sweep = cross(sub(leaf, hinge), sub(other, hinge)) > 0 ? 1 : 0;
    return (
      <g pointerEvents="none">
        <line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} stroke="var(--plan-wall)" strokeWidth={px(1.6)} />
        <path d={`M ${leaf.x} ${leaf.y} A ${W} ${W} 0 0 ${sweep} ${other.x} ${other.y}`} fill="none" stroke="var(--plan-wall-int)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />
      </g>
    );
  };

  const wallLabel = (l: LayoutLine) => {
    const L = lineLength(l);
    if (L * z < 40) return null;
    const mid = scale(add(l.a, l.b), 0.5);
    const dir = scale(sub(l.b, l.a), 1 / L);
    let n = { x: -dir.y, y: dir.x };
    if (centroid && dot(sub(centroid, mid), n) > 0) n = scale(n, -1);
    const pos = add(mid, scale(n, wallThickness(l, layout) / 2 + px(12)));
    let angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return (
      <text x={pos.x} y={pos.y} fontSize={px(11)} textAnchor="middle" dominantBaseline="middle" fill="var(--muted)" transform={`rotate(${angle} ${pos.x} ${pos.y})`} pointerEvents="none">
        {lenText(L)}
      </text>
    );
  };

  const hit = (l: LayoutLine) => (
    <line
      x1={l.a.x}
      y1={l.a.y}
      x2={l.b.x}
      y2={l.b.y}
      stroke="transparent"
      strokeWidth={Math.max(px(14), isWall(l) ? wallThickness(l, layout) : 0)}
      style={{ cursor: tool === "select" ? "move" : undefined }}
      onPointerDown={(e) => startMoveLine(e, l)}
    />
  );

  const preview = start && cursor ? { a: start, b: cursor } : null;
  const activeTool = TOOLS.find((t) => t.id === tool)!;

  return (
    <div className="room-body">
      <div className="tool-rail">
        {(["edit", "walls", "openings", "fixtures", "notes"] as const).map((g) => (
          <div key={g} style={{ display: "contents" }}>
            {g !== "edit" && <div className="group-label">{g}</div>}
            {TOOLS.filter((t) => t.group === g).map((t) => (
              <button
                key={t.id}
                className={`tool-btn ${tool === t.id ? "on" : ""}`}
                title={`${t.label} (${t.key.toUpperCase()}): ${t.hint}`}
                onClick={() => {
                  setTool(t.id);
                  endChain();
                  setZonePts([]);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d={t.icon} />
                </svg>
                {t.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="plan-wrap">
        <svg
          ref={svgRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          onDoubleClick={() => {
            if (tool === "zone") finishZone(zonePts);
            else endChain();
          }}
          style={{ cursor: space || tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair" }}
        >
          <defs>
            <pattern id="grid-minor" width={minor} height={minor} patternUnits="userSpaceOnUse">
              <path d={`M ${minor} 0 L 0 0 0 ${minor}`} fill="none" stroke="var(--plan-grid)" strokeWidth={px(1)} />
            </pattern>
            <pattern id="grid-major" width={major} height={major} patternUnits="userSpaceOnUse">
              <rect width={major} height={major} fill="url(#grid-minor)" />
              <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke="var(--plan-grid-major)" strokeWidth={px(1)} />
            </pattern>
            <pattern id="hatch" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="8" stroke="var(--plan-wall-int)" strokeWidth="1.2" opacity="0.5" />
            </pattern>
          </defs>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${z})`}>
            <rect x={visible.x0} y={visible.y0} width={visible.x1 - visible.x0} height={visible.y1 - visible.y0} fill="url(#grid-major)" />

            {layout.background && (
              <image
                href={`/api/full/${layout.background.imageId}`}
                x={layout.background.x}
                y={layout.background.y}
                width={layout.background.width * layout.background.cmPerPx}
                height={layout.background.height * layout.background.cmPerPx}
                opacity={layout.background.opacity}
                preserveAspectRatio="none"
                pointerEvents="none"
              />
            )}

            {floor.length > 2 && <polygon points={floor.map((p) => `${p.x},${p.y}`).join(" ")} fill={layout.floorColor} opacity={0.14} pointerEvents="none" />}

            {layout.zones.map((zone) => {
              const c = polygonCentroid(zone.points);
              const on = sel?.kind === "zone" && sel.id === zone.id;
              return (
                <g key={zone.id}>
                  <polygon
                    points={zone.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={zone.color}
                    fillOpacity={0.28}
                    stroke={zone.color}
                    strokeWidth={px(on ? 2.5 : 1.2)}
                    strokeDasharray={`${px(5)} ${px(4)}`}
                    onPointerDown={(e) => {
                      if (tool !== "select" || space) return;
                      e.stopPropagation();
                      setSel({ kind: "zone", id: zone.id });
                      drag.current = { kind: "move", start: toPlan(e), original: layoutRef.current, lineIds: [], endpoints: [], zoneId: zone.id };
                    }}
                    style={{ cursor: tool === "select" ? "move" : undefined }}
                  />
                  <text x={c.x} y={c.y} fontSize={px(13)} textAnchor="middle" fill="var(--ink-2)" fontFamily="var(--font-serif)" pointerEvents="none">
                    {zone.label}
                  </text>
                  {on &&
                    zone.points.map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={px(5)}
                        fill="var(--surface)"
                        stroke="var(--accent)"
                        strokeWidth={px(1.5)}
                        style={{ cursor: "grab" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          drag.current = { kind: "vertex", original: layoutRef.current, zoneId: zone.id, index: i };
                        }}
                      />
                    ))}
                </g>
              );
            })}

            {/* Placed furniture footprints, for reference */}
            {placements.map((pl) => {
              const it = items.get(pl.itemId);
              if (!it?.model) return null;
              const corners = obbCorners({ center: { x: pl.x, y: pl.y }, hw: it.model.dims.w / 2, hd: it.model.dims.d / 2, angle: (pl.rotation * Math.PI) / 180 });
              return (
                <g key={pl.id} pointerEvents="none" opacity={pl.draft ? 0.45 : 0.8}>
                  <polygon points={corners.map((p) => `${p.x},${p.y}`).join(" ")} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={px(1)} strokeDasharray={pl.draft ? `${px(4)} ${px(3)}` : undefined} />
                  {it.model.dims.w * z > 50 && (
                    <text x={pl.x} y={pl.y} fontSize={px(10)} textAnchor="middle" dominantBaseline="middle" fill="var(--accent)">
                      {it.name}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Fixtures */}
            {layout.lines.filter(isFixture).map((l) => {
              const corners = obbCorners(fixtureRect(l));
              const c = scale(add(corners[0], corners[2]), 0.5);
              return (
                <g key={l.id}>
                  <polygon points={corners.map((p) => `${p.x},${p.y}`).join(" ")} fill={l.type === "column" ? "var(--plan-wall)" : "url(#hatch)"} stroke="var(--plan-wall-int)" strokeWidth={px(1.2)} pointerEvents="none" />
                  {l.type !== "column" && lineLength(l) * z > 50 && (
                    <text x={c.x} y={c.y} fontSize={px(10)} textAnchor="middle" dominantBaseline="middle" fill="var(--ink-2)" pointerEvents="none">
                      {l.label || l.type}
                    </text>
                  )}
                  <polygon points={corners.map((p) => `${p.x},${p.y}`).join(" ")} fill="transparent" onPointerDown={(e) => startMoveLine(e, l)} style={{ cursor: tool === "select" ? "move" : undefined }} />
                </g>
              );
            })}

            {/* Walls */}
            {layout.lines.filter(isWall).map((l) => (
              <g key={l.id}>
                <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={l.type === "wall-exterior" ? "var(--plan-wall)" : "var(--plan-wall-int)"} strokeWidth={wallThickness(l, layout)} strokeLinecap="square" pointerEvents="none" />
                {wallLabel(l)}
                {hit(l)}
              </g>
            ))}

            {/* Openings */}
            {layout.lines.filter(isOpening).map((l) => {
              const T = layout.wallThickness + 2;
              return (
                <g key={l.id}>
                  <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="var(--plan-bg)" strokeWidth={T} pointerEvents="none" />
                  {l.type === "window" && (
                    <>
                      <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="var(--plan-wall)" strokeWidth={T} strokeOpacity={0.15} pointerEvents="none" />
                      <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="var(--plan-wall)" strokeWidth={px(1.4)} pointerEvents="none" />
                    </>
                  )}
                  {l.type === "door" && doorGraphic(l)}
                  {l.type === "opening" && <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="var(--plan-wall-int)" strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} pointerEvents="none" />}
                  {hit(l)}
                </g>
              );
            })}

            {/* Dimension lines */}
            {layout.lines
              .filter((l) => l.type === "dimension")
              .map((l) => {
                const L = lineLength(l);
                const dir = L > 0 ? scale(sub(l.b, l.a), 1 / L) : { x: 1, y: 0 };
                const n = { x: -dir.y, y: dir.x };
                const tick = (p: Vec2) => (
                  <line x1={p.x - n.x * px(6)} y1={p.y - n.y * px(6)} x2={p.x + n.x * px(6)} y2={p.y + n.y * px(6)} stroke="var(--accent)" strokeWidth={px(1.4)} />
                );
                const mid = add(scale(add(l.a, l.b), 0.5), scale(n, px(-10)));
                const off = l.realLength && Math.abs(l.realLength - L) > 1;
                return (
                  <g key={l.id} pointerEvents="none">
                    <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="var(--accent)" strokeWidth={px(1.4)} />
                    {tick(l.a)}
                    {tick(l.b)}
                    <text x={mid.x} y={mid.y} fontSize={px(11)} textAnchor="middle" fill="var(--accent)" fontWeight={600}>
                      {lenText(L)}
                      {off ? ` (labeled ${lenText(l.realLength!)})` : ""}
                    </text>
                    <g pointerEvents="all">{hit(l)}</g>
                  </g>
                );
              })}

            {/* Outlets */}
            {layout.points.map((p) => {
              const on = sel?.kind === "point" && sel.id === p.id;
              return (
                <g
                  key={p.id}
                  onPointerDown={(e) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    setSel({ kind: "point", id: p.id });
                    drag.current = { kind: "move", start: toPlan(e), original: layoutRef.current, lineIds: [], endpoints: [], pointId: p.id };
                  }}
                  style={{ cursor: tool === "select" ? "move" : undefined }}
                >
                  <circle cx={p.at.x} cy={p.at.y} r={px(7)} fill="var(--surface)" stroke={on ? "var(--accent)" : "var(--ink-2)"} strokeWidth={px(1.5)} />
                  <line x1={p.at.x - px(2)} y1={p.at.y - px(3)} x2={p.at.x - px(2)} y2={p.at.y + px(1)} stroke="var(--ink-2)" strokeWidth={px(1.3)} />
                  <line x1={p.at.x + px(2)} y1={p.at.y - px(3)} x2={p.at.x + px(2)} y2={p.at.y + px(1)} stroke="var(--ink-2)" strokeWidth={px(1.3)} />
                </g>
              );
            })}

            {/* Selection handles */}
            {selectedLine && (
              <g>
                <line x1={selectedLine.a.x} y1={selectedLine.a.y} x2={selectedLine.b.x} y2={selectedLine.b.y} stroke="var(--accent)" strokeWidth={px(2)} pointerEvents="none" />
                {(["a", "b"] as const).map((end) => (
                  <circle
                    key={end}
                    cx={selectedLine[end].x}
                    cy={selectedLine[end].y}
                    r={px(6)}
                    fill="var(--surface)"
                    stroke="var(--accent)"
                    strokeWidth={px(2)}
                    style={{ cursor: "grab" }}
                    onPointerDown={(e) => startEndpoint(e, selectedLine, end)}
                  />
                ))}
              </g>
            )}

            {/* Drawing previews */}
            {preview && (
              <g pointerEvents="none">
                <line
                  x1={preview.a.x}
                  y1={preview.a.y}
                  x2={preview.b.x}
                  y2={preview.b.y}
                  stroke="var(--accent)"
                  strokeWidth={tool.startsWith("wall") ? (tool === "wall-interior" ? 10 : layout.wallThickness) : px(3)}
                  strokeOpacity={tool.startsWith("wall") ? 0.45 : 1}
                  strokeLinecap="square"
                />
                <text x={preview.b.x + px(12)} y={preview.b.y - px(12)} fontSize={px(12)} fill="var(--accent)" fontWeight={600}>
                  {typed ? `${typed}▏` : lenText(dist(preview.a, preview.b))}
                </text>
              </g>
            )}
            {zonePts.length > 0 && (
              <polyline
                points={[...zonePts, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(" ")}
                fill="var(--accent-soft)"
                fillOpacity={0.4}
                stroke="var(--accent)"
                strokeWidth={px(1.5)}
                pointerEvents="none"
              />
            )}
            {cursor && <circle cx={cursor.x} cy={cursor.y} r={px(4)} fill="var(--accent)" pointerEvents="none" />}
            {start && <circle cx={start.x} cy={start.y} r={px(4)} fill="none" stroke="var(--accent)" strokeWidth={px(1.5)} pointerEvents="none" />}
          </g>
        </svg>

        <div className="plan-hud">
          <span className="hud-pill">{activeTool.hint}</span>
          <span className="hud-pill">
            Grid{" "}
            <select value={gridStep} onChange={(e) => setGridStep(Number(e.target.value))} style={{ border: 0, background: "transparent" }}>
              {[1, 5, 10, 25].map((g) => (
                <option key={g} value={g}>
                  {formatLength(g, units, { precise: true })}
                </option>
              ))}
            </select>
          </span>
          <span className="hud-pill">
            Hold <span className="kbd">Alt</span> to place freely
          </span>
          <button className="btn sm" onClick={undo} title="Undo (Ctrl+Z)">
            <Icon name="undo" size={14} />
          </button>
          <button className="btn sm" onClick={redo} title="Redo (Ctrl+Shift+Z)">
            <Icon name="redo" size={14} />
          </button>
          <button className="btn sm" onClick={fit}>
            Fit
          </button>
          <button className="btn sm" onClick={() => setShowProps(!showProps)}>
            {showProps ? "Hide panel" : "Show panel"}
          </button>
        </div>
      </div>

      <div className={`props ${showProps ? "" : "collapsed"}`} style={showProps ? undefined : { display: "none" }}>
        <LayoutProps
          layout={layout}
          selection={sel}
          onCommit={commit}
          onDelete={deleteSelection}
          onCalibrate={calibrate}
          onTraceWithClaude={onTraceWithClaude}
          tracing={tracing}
        />
      </div>
    </div>
  );
}
