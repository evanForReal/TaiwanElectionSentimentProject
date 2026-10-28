import type { Layout } from "../../shared/types.ts";
import { floorPolygon, isFixture, isOpening, isWall, layoutBounds } from "../../shared/geometry.ts";

export function PlanThumb({ layout }: { layout: Layout }) {
  const { min, max } = layoutBounds(layout);
  const pad = 40;
  const w = Math.max(100, max.x - min.x) + pad * 2;
  const h = Math.max(100, max.y - min.y) + pad * 2;
  const floor = floorPolygon(layout);
  return (
    <svg className="plan-thumb" viewBox={`${min.x - pad} ${min.y - pad} ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      {floor.length > 2 && <polygon points={floor.map((p) => `${p.x},${p.y}`).join(" ")} fill="var(--surface-2)" />}
      {layout.zones.map((z) => (
        <polygon key={z.id} points={z.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={z.color} opacity={0.35} />
      ))}
      {layout.lines.map((l) => {
        const stroke = isWall(l)
          ? "var(--plan-wall)"
          : isOpening(l)
            ? "var(--plan-bg)"
            : isFixture(l)
              ? "var(--plan-wall-int)"
              : "transparent";
        const width = isWall(l) ? layout.wallThickness : isOpening(l) ? layout.wallThickness * 0.8 : 6;
        return <line key={l.id} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={stroke} strokeWidth={width} strokeLinecap="square" />;
      })}
      {layout.lines.length === 0 && (
        <text x={min.x + w / 2 - pad} y={min.y + h / 2 - pad} textAnchor="middle" fontSize={Math.max(w, h) / 14} fill="var(--muted)">
          Empty layout
        </text>
      )}
    </svg>
  );
}
