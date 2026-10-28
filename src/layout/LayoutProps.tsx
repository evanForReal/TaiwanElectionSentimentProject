import { useState } from "react";
import type { Layout, LayoutLine, LineType } from "../../shared/types.ts";
import { FIXTURE_TYPES, OPENING_TYPES, WALL_TYPES } from "../../shared/types.ts";
import { add, fixtureDefaults, lineLength, openingDefaults, scale, sub } from "../../shared/geometry.ts";
import { formatLength } from "../../shared/units.ts";
import { useApp } from "../lib/store.ts";
import { Icon, ImageDrop, LengthInput, Seg, Spinner } from "../components/ui.tsx";
import { LINE_LABELS, ZONE_COLORS } from "./tools.ts";

type Selection = { kind: "line" | "point" | "zone"; id: string } | null;

export function LayoutProps({
  layout,
  selection,
  onCommit,
  onDelete,
  onCalibrate,
  onTraceWithClaude,
  tracing,
}: {
  layout: Layout;
  selection: Selection;
  onCommit: (l: Layout) => void;
  onDelete: () => void;
  onCalibrate: (line: LayoutLine, real: number) => void;
  onTraceWithClaude?: () => void;
  tracing?: boolean;
}) {
  const hasKey = useApp((s) => s.settings?.hasAnthropicKey);

  const updateLine = (id: string, patch: Partial<LayoutLine>) =>
    onCommit({ ...layout, lines: layout.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  if (selection?.kind === "line") {
    const l = layout.lines.find((x) => x.id === selection.id);
    if (!l) return null;
    return <LineProps key={l.id} line={l} layout={layout} update={(p) => updateLine(l.id, p)} onDelete={onDelete} onCalibrate={onCalibrate} />;
  }

  if (selection?.kind === "zone") {
    const z = layout.zones.find((x) => x.id === selection.id);
    if (!z) return null;
    const update = (patch: Partial<typeof z>) => onCommit({ ...layout, zones: layout.zones.map((x) => (x.id === z.id ? { ...x, ...patch } : x)) });
    return (
      <div className="stack">
        <h3>Zone</h3>
        <div className="field">
          <label>Label</label>
          <input className="input" autoFocus value={z.label} onChange={(e) => update({ label: e.target.value })} />
        </div>
        <div className="field">
          <label>Color</label>
          <div className="row">
            {ZONE_COLORS.map((c) => (
              <button key={c} className="swatch" style={{ background: c, outline: c === z.color ? "2px solid var(--accent)" : undefined }} onClick={() => update({ color: c })} aria-label={c} />
            ))}
          </div>
        </div>
        <button className="btn danger sm" onClick={onDelete}>
          <Icon name="trash" size={14} /> Delete zone
        </button>
      </div>
    );
  }

  if (selection?.kind === "point") {
    const p = layout.points.find((x) => x.id === selection.id);
    if (!p) return null;
    return (
      <div className="stack">
        <h3>Power outlet</h3>
        <div className="field">
          <label>Label</label>
          <input
            className="input"
            value={p.label ?? ""}
            placeholder="e.g. double, USB, floor"
            onChange={(e) => onCommit({ ...layout, points: layout.points.map((x) => (x.id === p.id ? { ...x, label: e.target.value } : x)) })}
          />
        </div>
        <button className="btn danger sm" onClick={onDelete}>
          <Icon name="trash" size={14} /> Delete outlet
        </button>
      </div>
    );
  }

  // Nothing selected: room-wide settings
  const bg = layout.background;
  const counts = {
    walls: layout.lines.filter((l) => WALL_TYPES.includes(l.type)).length,
    openings: layout.lines.filter((l) => OPENING_TYPES.includes(l.type)).length,
    fixtures: layout.lines.filter((l) => FIXTURE_TYPES.includes(l.type)).length,
  };
  return (
    <div className="stack">
      <div>
        <h3>Room</h3>
        <div className="muted small">
          {counts.walls} walls · {counts.openings} openings · {counts.fixtures} fixtures · {layout.zones.length} zones
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Ceiling height</label>
          <LengthInput value={layout.ceilingHeight} onChange={(v) => v && onCommit({ ...layout, ceilingHeight: v })} />
        </div>
        <div className="field">
          <label>Wall thickness</label>
          <LengthInput value={layout.wallThickness} onChange={(v) => v && onCommit({ ...layout, wallThickness: v })} />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Wall color</label>
          <input type="color" className="input" style={{ padding: 2, height: 34 }} value={layout.wallColor} onChange={(e) => onCommit({ ...layout, wallColor: e.target.value })} />
        </div>
        <div className="field">
          <label>Floor</label>
          <div className="row">
            <input type="color" className="input" style={{ padding: 2, height: 34, width: 48 }} value={layout.floorColor} onChange={(e) => onCommit({ ...layout, floorColor: e.target.value })} />
            <select className="select" value={layout.floorKind} onChange={(e) => onCommit({ ...layout, floorKind: e.target.value as Layout["floorKind"] })}>
              <option value="wood">Wood</option>
              <option value="stone">Stone</option>
              <option value="carpet">Carpet</option>
              <option value="plain">Plain</option>
            </select>
          </div>
        </div>
      </div>

      <div className="divider" />
      <h3>Tracing image</h3>
      {bg ? (
        <>
          <div className="slider-row">
            <span className="small">Opacity</span>
            <input type="range" min={0} max={1} step={0.05} value={bg.opacity} onChange={(e) => onCommit({ ...layout, background: { ...bg, opacity: Number(e.target.value) } })} />
            <span className="small muted">{Math.round(bg.opacity * 100)}%</span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            To set the scale, draw a <strong>Measure</strong> line over something of known length and type its real length.
          </p>
          <div className="row wrap">
            {onTraceWithClaude && (
              <button className="btn sm accent" disabled={!hasKey || tracing} onClick={onTraceWithClaude} title={hasKey ? "" : "Needs an Anthropic API key"}>
                {tracing ? <Spinner /> : <Icon name="sparkle" size={14} />} Trace with Claude
              </button>
            )}
            <button className="btn sm danger" onClick={() => onCommit({ ...layout, background: null })}>
              Remove image
            </button>
          </div>
        </>
      ) : (
        <ImageDrop
          multiple={false}
          compact
          label="Add a floor plan or sketch to trace over"
          onUploaded={([img]) => onCommit({ ...layout, background: { imageId: img.id, x: 0, y: 0, cmPerPx: 1, opacity: 0.5, width: img.width, height: img.height } })}
        />
      )}

      <div className="divider" />
      <h3>Shortcuts</h3>
      <ul className="clean small muted">
        <li>
          While drawing a wall, type a length (<span className="kbd">350</span>, <span className="kbd">3.5m</span>, <span className="kbd">11'6"</span>) and press <span className="kbd">Enter</span>.
        </li>
        <li>
          <span className="kbd">Esc</span> ends a wall chain, <span className="kbd">Del</span> removes the selection.
        </li>
        <li>
          Scroll to zoom; drag empty space or hold <span className="kbd">Space</span> to pan.
        </li>
        <li>
          Lines snap to 15° angles, endpoints and the grid. Hold <span className="kbd">Alt</span> to turn snapping off.
        </li>
      </ul>
    </div>
  );
}

function LineProps({
  line: l,
  layout,
  update,
  onDelete,
  onCalibrate,
}: {
  line: LayoutLine;
  layout: Layout;
  update: (p: Partial<LayoutLine>) => void;
  onDelete: () => void;
  onCalibrate: (line: LayoutLine, real: number) => void;
}) {
  const units = useApp((s) => s.units);
  const L = lineLength(l);
  const [real, setReal] = useState<number | undefined>(l.realLength);
  const family: LineType[] = WALL_TYPES.includes(l.type)
    ? WALL_TYPES
    : OPENING_TYPES.includes(l.type)
      ? OPENING_TYPES
      : FIXTURE_TYPES.includes(l.type)
        ? FIXTURE_TYPES
        : [l.type];

  const setLength = (v: number | undefined) => {
    if (!v || L < 0.1) return;
    // Keep the start point; move the end along the same direction
    update({ b: add(l.a, scale(sub(l.b, l.a), v / L)) });
  };

  const od = openingDefaults(l);
  const fd = fixtureDefaults(l.type);

  return (
    <div className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>{LINE_LABELS[l.type]}</h3>
        <div className="spacer" />
        {family.length > 1 && (
          <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={l.type} onChange={(e) => update({ type: e.target.value as LineType })}>
            {family.map((t) => (
              <option key={t} value={t}>
                {LINE_LABELS[t]}
              </option>
            ))}
          </select>
        )}
      </div>

      {l.type === "dimension" ? (
        <>
          <div className="muted small">Measured on the drawing: {formatLength(L, units, { precise: true })}</div>
          <div className="field">
            <label>Real length</label>
            <LengthInput value={real} onChange={setReal} placeholder="Type the true length" />
            <span className="hint">Calibrating rescales every wall, zone and the tracing image so this line matches.</span>
          </div>
          <button className="btn primary sm" disabled={!real} onClick={() => real && onCalibrate(l, real)}>
            Calibrate drawing to {real ? formatLength(real, units, { precise: true }) : "…"}
          </button>
        </>
      ) : (
        <div className="field">
          <label>{l.type === "column" ? "Width" : "Length"}</label>
          <LengthInput value={L} onChange={setLength} />
        </div>
      )}

      {WALL_TYPES.includes(l.type) && (
        <div className="grid-2">
          <div className="field">
            <label>Thickness</label>
            <LengthInput value={l.thickness} placeholder={String(layout.wallThickness)} onChange={(v) => update({ thickness: v })} />
          </div>
          <div className="field">
            <label>Height</label>
            <LengthInput value={l.height} placeholder={String(layout.ceilingHeight)} onChange={(v) => update({ height: v })} />
          </div>
        </div>
      )}

      {l.type === "door" && (
        <>
          <div className="field">
            <label>Height</label>
            <LengthInput value={l.height ?? od.top} onChange={(v) => update({ height: v })} />
          </div>
          <div className="field">
            <label>Hinge side</label>
            <Seg value={l.swing ?? "left"} options={[{ value: "left", label: "Start" }, { value: "right", label: "End" }]} onChange={(v) => update({ swing: v })} />
          </div>
          <div className="field">
            <label>Swings</label>
            <Seg value={l.swingIn === false ? "out" : "in"} options={[{ value: "in", label: "Into room" }, { value: "out", label: "Outward" }]} onChange={(v) => update({ swingIn: v === "in" })} />
          </div>
        </>
      )}

      {l.type === "window" && (
        <div className="grid-2">
          <div className="field">
            <label>Sill height</label>
            <LengthInput value={l.sill ?? od.bottom} onChange={(v) => update({ sill: v })} />
          </div>
          <div className="field">
            <label>Head height</label>
            <LengthInput value={l.height ?? od.top} onChange={(v) => update({ height: v })} />
          </div>
        </div>
      )}

      {l.type === "opening" && (
        <div className="field">
          <label>Head height</label>
          <LengthInput value={l.height ?? od.top} onChange={(v) => update({ height: v })} />
        </div>
      )}

      {FIXTURE_TYPES.includes(l.type) && (
        <>
          <div className="grid-2">
            <div className="field">
              <label>Depth</label>
              <LengthInput value={l.depth ?? fd.depth} onChange={(v) => update({ depth: v })} />
            </div>
            <div className="field">
              <label>Height</label>
              <LengthInput value={l.height ?? fd.height} onChange={(v) => update({ height: v })} />
            </div>
          </div>
          {l.type !== "column" && (
            <button className="btn sm" onClick={() => update({ side: l.side === -1 ? 1 : -1 })}>
              <Icon name="refresh" size={14} /> Flip to other side
            </button>
          )}
          <div className="field">
            <label>Label</label>
            <input className="input" value={l.label ?? ""} placeholder={l.type} onChange={(e) => update({ label: e.target.value })} />
          </div>
        </>
      )}

      <div className="row">
        <button className="btn sm" onClick={() => update({ a: l.b, b: l.a })} title="Swap start and end">
          Reverse
        </button>
        <div className="spacer" />
        <button className="btn danger sm" onClick={onDelete}>
          <Icon name="trash" size={14} /> Delete
        </button>
      </div>
    </div>
  );
}
