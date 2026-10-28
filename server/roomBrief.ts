import type { LibraryItem, Room } from "../shared/types.ts";
import {
  fixtureDefaults,
  fixtureRect,
  floorPolygon,
  isFixture,
  isOpening,
  isWall,
  lineLength,
  obbCorners,
  openingsOnWall,
  polygonCentroid,
  wallThickness,
} from "../shared/geometry.ts";

const r = (n: number) => Math.round(n);
const pt = (p: { x: number; y: number }) => `(${r(p.x)}, ${r(p.y)})`;

/**
 * Plain-text description of a room for Claude: geometry in plan centimeters, every opening
 * located on its wall, fixtures, zones, and the pieces placed or waiting in the tray.
 */
export function describeRoom(room: Room, items: Map<string, LibraryItem>, stagingIds: string[]): string {
  const { layout, state } = room;
  const floor = floorPolygon(layout);
  const centroid = floor.length ? polygonCentroid(floor) : null;
  const lines: string[] = [];

  lines.push(`Ceiling height: ${r(layout.ceilingHeight)} cm.`);
  if (floor.length) lines.push(`Floor outline (walls' centerlines): ${floor.map(pt).join(" → ")}.`);
  if (centroid) lines.push(`Room center: ${pt(centroid)}.`);

  lines.push("", "Walls:");
  for (const w of layout.lines.filter(isWall)) {
    const ops = openingsOnWall(w, layout);
    const opText = ops.length
      ? ` Openings: ${ops
          .map((o) => {
            const mid = { x: (o.line.a.x + o.line.b.x) / 2, y: (o.line.a.y + o.line.b.y) / 2 };
            const extra = o.line.type === "window" ? `, sill ${r(o.bottom)} cm, head ${r(o.top)} cm` : o.line.type === "door" ? `, ${r(o.top)} cm tall` : "";
            return `${o.line.type} ${r(o.to - o.from)} cm wide centered at ${pt(mid)}${extra}`;
          })
          .join("; ")}.`
      : "";
    lines.push(`- ${w.type === "wall-exterior" ? "Wall" : "Interior wall"} ${w.id} from ${pt(w.a)} to ${pt(w.b)}, ${r(lineLength(w))} cm long, ${r(wallThickness(w, layout))} cm thick.${opText}`);
  }

  const fixtures = layout.lines.filter(isFixture);
  if (fixtures.length) {
    lines.push("", "Fixed fixtures (nothing can go through them):");
    for (const f of fixtures) {
      const corners = obbCorners(fixtureRect(f));
      lines.push(`- ${f.label || f.type}, ${r(f.height ?? fixtureDefaults(f.type).height)} cm tall, footprint ${corners.map(pt).join(" ")}.`);
    }
  }
  const stray = layout.lines.filter((l) => isOpening(l) && !layout.lines.some((w) => isWall(w) && openingsOnWall(w, layout).some((o) => o.line.id === l.id)));
  for (const o of stray) lines.push(`- ${o.type} from ${pt(o.a)} to ${pt(o.b)}.`);

  if (layout.zones.length) {
    lines.push("", "Zones the user marked:");
    for (const z of layout.zones) lines.push(`- "${z.label}": ${z.points.map(pt).join(" ")}.`);
  }
  if (layout.points.length) lines.push("", `Power outlets at: ${layout.points.map((p) => pt(p.at)).join(", ")}.`);

  const desc = (it: LibraryItem | undefined) =>
    it?.model ? `"${it.name}" (${it.category}, ${r(it.model.dims.w)} wide × ${r(it.model.dims.d)} deep × ${r(it.model.dims.h)} tall)` : "unknown piece";

  lines.push("", "Pieces placed in the room:");
  if (state.placements.length === 0) lines.push("- none");
  for (const p of state.placements) {
    lines.push(
      `- placementId ${p.id}: ${desc(items.get(p.itemId))} at ${pt(p)}, rotation ${r(((p.rotation % 360) + 360) % 360)}°, elevation ${r(p.elevation)} cm${p.draft ? " (draft)" : ""}.`,
    );
  }
  if (stagingIds.length) {
    lines.push("", "Pieces in the staging tray (not yet placed; place them if the request calls for it):");
    for (const id of stagingIds) lines.push(`- itemId ${id}: ${desc(items.get(id))}.`);
  }
  return lines.join("\n");
}
