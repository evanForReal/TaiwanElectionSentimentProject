import type { LineType } from "../../shared/types.ts";

export type ToolId = "select" | "pan" | LineType | "outlet" | "zone";

export interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  group: "edit" | "walls" | "openings" | "fixtures" | "notes";
  icon: string; // svg path in a 24 box
  hint: string;
}

export const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", key: "v", group: "edit", icon: "M5 3l14 8-6 2-2 6z", hint: "Click to select, drag to move. Drag empty space to pan." },
  { id: "pan", label: "Pan", key: "h", group: "edit", icon: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3", hint: "Drag to pan, scroll to zoom." },
  { id: "wall-exterior", label: "Wall", key: "w", group: "walls", icon: "M3 18V6h18v12", hint: "Click to start, click to add corners. Type a length then Enter for exact walls. Esc or double-click ends." },
  { id: "wall-interior", label: "Interior", key: "i", group: "walls", icon: "M3 12h18M12 4v16", hint: "Thinner partition walls. Same controls as walls." },
  { id: "door", label: "Door", key: "d", group: "openings", icon: "M4 20h4M8 20V6a14 14 0 0114 14", hint: "Click two points on a wall to span the door." },
  { id: "window", label: "Window", key: "n", group: "openings", icon: "M3 9h18v6H3zM3 12h18", hint: "Click two points on a wall to span the window." },
  { id: "opening", label: "Opening", key: "o", group: "openings", icon: "M3 12h5M16 12h5M8 8v8M16 8v8", hint: "An open passage or archway: two points on a wall." },
  { id: "cabinet", label: "Cabinet", key: "c", group: "fixtures", icon: "M4 6h16v12H4zM12 6v12M10 12h-1M15 12h-1", hint: "Built-in cabinetry: click along its back edge." },
  { id: "counter", label: "Counter", key: "k", group: "fixtures", icon: "M3 9h18v3H3zM5 12v7M19 12v7", hint: "Kitchen or bar counter: click along its back edge." },
  { id: "fireplace", label: "Fireplace", key: "f", group: "fixtures", icon: "M4 20V8h16v12M8 20v-6a4 4 0 018 0v6", hint: "Click along the wall it sits against." },
  { id: "radiator", label: "Radiator", key: "r", group: "fixtures", icon: "M4 8h16v9H4zM8 8v9M12 8v9M16 8v9", hint: "Click along the wall it sits against." },
  { id: "column", label: "Column", key: "l", group: "fixtures", icon: "M8 4h8v16H8z", hint: "Click to place a 30 cm column." },
  { id: "dimension", label: "Measure", key: "m", group: "notes", icon: "M4 17L17 4M4 13v4h4M13 4h4v4", hint: "Draw a line over a known distance, then type its real length to scale the whole drawing." },
  { id: "outlet", label: "Outlet", key: "p", group: "notes", icon: "M12 4a8 8 0 100 16 8 8 0 000-16zM10 9v3M14 9v3M12 15v1", hint: "Click on a wall to mark a power outlet." },
  { id: "zone", label: "Zone", key: "z", group: "notes", icon: "M4 5l9-1 7 7-3 9-12-3z", hint: "Click corners of an area, then click the first point or press Enter to close." },
];

export const LINE_LABELS: Record<LineType, string> = {
  "wall-exterior": "Wall",
  "wall-interior": "Interior wall",
  door: "Door",
  window: "Window",
  opening: "Opening",
  cabinet: "Cabinet",
  counter: "Counter",
  fireplace: "Fireplace",
  radiator: "Radiator",
  column: "Column",
  dimension: "Dimension",
};

export const ZONE_COLORS = ["#d9c7a7", "#b9c9b1", "#c7b6c9", "#a9bfcf", "#e0b9a3", "#cfd3a5"];
