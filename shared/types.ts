// Domain types shared by the server and the web client.
// All lengths are stored in centimeters. The 3D scene converts to meters at render time.

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

// ---------- Parametric furniture models ----------

export const PART_SHAPES = ["box", "roundedBox", "cylinder", "sphere", "cone", "torus"] as const;
export type PartShape = (typeof PART_SHAPES)[number];

export const MATERIAL_KINDS = [
  "plain",
  "wood",
  "fabric",
  "leather",
  "metal",
  "glass",
  "stone",
  "ceramic",
  "plant",
  "rattan",
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export interface ModelMaterial {
  id: string;
  name: string;
  kind: MaterialKind;
  color: string; // #rrggbb
  roughness: number; // 0..1
  metalness: number; // 0..1
  opacity: number; // 0..1
}

/**
 * One primitive of a model. The item's origin is the center of its footprint on the floor:
 * x = width (left/right), y = up, z = depth (positive z is the front of the piece).
 * `position` is the part's center; `size` is its full extent along each axis before rotation.
 * Cylinders and cones use size.x as diameter and size.y as height; spheres use size as the
 * ellipsoid diameters; tori use size.x as outer diameter and size.y as tube diameter.
 */
export interface ModelPart {
  id: string;
  name: string;
  shape: PartShape;
  position: Vec3;
  size: Vec3;
  rotation: Vec3; // degrees
  cornerRadius: number; // roundedBox only, cm
  materialId: string;
}

export interface Dimensions {
  w: number; // width, x
  d: number; // depth, z
  h: number; // height, y
}

export interface ParametricModel {
  category: string;
  dims: Dimensions; // bounding box of all parts
  parts: ModelPart[];
  materials: ModelMaterial[];
  notes: string;
}

export interface ModelVersion {
  id: string;
  createdAt: string;
  source: "claude-generate" | "claude-edit" | "template" | "manual";
  instruction: string;
  model: ParametricModel;
}

export type ItemStatus = "draft" | "generating" | "ready" | "error";

export interface LibraryItem {
  id: string;
  name: string;
  category: string;
  photoIds: string[];
  knownDims: Partial<Dimensions>; // what the user entered
  notes: string;
  tags: string[];
  model: ParametricModel | null;
  history: ModelVersion[];
  status: ItemStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ITEM_CATEGORIES = [
  "sofa",
  "armchair",
  "chair",
  "dining-table",
  "coffee-table",
  "side-table",
  "desk",
  "bed",
  "nightstand",
  "dresser",
  "cabinet",
  "bookshelf",
  "tv-stand",
  "bench",
  "stool",
  "ottoman",
  "lamp-floor",
  "lamp-table",
  "pendant",
  "rug",
  "plant",
  "mirror",
  "art",
  "decor",
  "other",
] as const;

// ---------- Room layouts ----------

export const LINE_TYPES = [
  "wall-exterior",
  "wall-interior",
  "door",
  "window",
  "opening",
  "cabinet",
  "counter",
  "fireplace",
  "radiator",
  "column",
  "dimension",
] as const;
export type LineType = (typeof LINE_TYPES)[number];

export const WALL_TYPES: LineType[] = ["wall-exterior", "wall-interior"];
export const OPENING_TYPES: LineType[] = ["door", "window", "opening"];
export const FIXTURE_TYPES: LineType[] = ["cabinet", "counter", "fireplace", "radiator", "column"];

export interface LayoutLine {
  id: string;
  type: LineType;
  a: Vec2; // cm, plan coordinates (x right, y down = 3D +z)
  b: Vec2;
  // Walls
  thickness?: number;
  height?: number; // walls: override ceiling height; openings: head height; fixtures: height
  // Windows
  sill?: number;
  // Doors
  swing?: "left" | "right";
  swingIn?: boolean;
  // Fixtures extrude this far from the line to the side given by `side`
  depth?: number;
  side?: 1 | -1;
  // Dimension lines
  realLength?: number;
  label?: string;
}

export interface LayoutPoint {
  id: string;
  type: "outlet";
  at: Vec2;
  label?: string;
}

export interface Zone {
  id: string;
  label: string;
  color: string;
  points: Vec2[];
}

export interface LayoutBackground {
  imageId: string;
  // Placement of the image in plan space: top-left corner and cm-per-pixel
  x: number;
  y: number;
  cmPerPx: number;
  opacity: number;
  width: number; // px
  height: number; // px
}

export interface Layout {
  lines: LayoutLine[];
  points: LayoutPoint[];
  zones: Zone[];
  ceilingHeight: number;
  wallThickness: number;
  wallColor: string;
  floorColor: string;
  floorKind: "wood" | "stone" | "plain" | "carpet";
  background: LayoutBackground | null;
}

// ---------- Rooms, placements, configurations ----------

export interface Placement {
  id: string;
  itemId: string;
  x: number; // cm, plan coordinates
  y: number;
  rotation: number; // degrees about the vertical axis
  elevation: number; // cm above floor
  draft: boolean;
}

export interface RoomState {
  placements: Placement[];
  staging: string[]; // item ids waiting in the fold-out tray
}

export interface Room {
  id: string;
  projectId: string;
  name: string;
  layout: Layout;
  state: RoomState;
  sourceImageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoomConfiguration {
  id: string;
  roomId: string;
  name: string;
  state: RoomState;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  rooms?: Room[];
}

// ---------- Collections (Pinterest boards and in-app moodboards) ----------

export interface Pin {
  id: string;
  collectionId: string;
  imageId: string | null;
  imageUrl: string | null; // original remote URL
  title: string;
  link: string | null;
  pinterestPinId: string | null;
  createdAt: string;
}

export interface StyleEssential {
  name: string;
  category: string;
  why: string;
  priority: "must" | "nice";
}

export interface StyleSummary {
  styleName: string;
  oneLiner: string;
  description: string;
  palette: { hex: string; name: string }[];
  materials: string[];
  keywords: string[];
  essentials: StyleEssential[];
  layoutPrinciples: string[];
  avoid: string[];
  pinIds: string[];
  createdAt: string;
}

export interface Collection {
  id: string;
  name: string;
  source: "pinterest" | "manual";
  pinterestBoardId: string | null;
  summary: StyleSummary | null;
  itemIds: string[];
  createdAt: string;
  updatedAt: string;
  pinCount?: number;
  coverImageIds?: string[];
}

export interface ItemMatch {
  itemId: string;
  score: number;
  reason: string;
  fillsEssential: string | null;
}

export interface MatchResult {
  matches: ItemMatch[];
  missingEssentials: { name: string; category: string; suggestion: string }[];
}

// ---------- Images ----------

export interface ImageRecord {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  mime: string;
}

// ---------- Settings ----------

export interface AppSettings {
  units: "metric" | "imperial";
  hasAnthropicKey: boolean;
  anthropicKeySource: "env" | "settings" | null;
  pinterestConfigured: boolean;
  pinterestConnected: boolean;
  model: string;
}
