import type {
  Collection,
  Layout,
  LibraryItem,
  ModelVersion,
  ParametricModel,
  Pin,
  Project,
  Room,
  RoomConfiguration,
  RoomState,
} from "../shared/types.ts";
import { db, json, newId, now } from "./db.ts";

// ---------- Items ----------

interface ItemRow {
  id: string;
  name: string;
  category: string;
  photo_ids: string;
  known_dims: string;
  notes: string;
  tags: string;
  model: string | null;
  history: string;
  status: LibraryItem["status"];
  error: string | null;
  created_at: string;
  updated_at: string;
}

const toItem = (r: ItemRow): LibraryItem => ({
  id: r.id,
  name: r.name,
  category: r.category,
  photoIds: json(r.photo_ids, []),
  knownDims: json(r.known_dims, {}),
  notes: r.notes,
  tags: json(r.tags, []),
  model: json<ParametricModel | null>(r.model, null),
  history: json(r.history, []),
  status: r.status,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listItems(): LibraryItem[] {
  return (db.prepare("SELECT * FROM items ORDER BY updated_at DESC").all() as ItemRow[]).map(toItem);
}

export function getItem(id: string): LibraryItem | null {
  const r = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
  return r ? toItem(r) : null;
}

export function getItems(ids: string[]): LibraryItem[] {
  return ids.map(getItem).filter((i): i is LibraryItem => i !== null);
}

export function saveItem(item: LibraryItem): LibraryItem {
  item.updatedAt = now();
  db.prepare(
    `INSERT INTO items (id, name, category, photo_ids, known_dims, notes, tags, model, history, status, error, created_at, updated_at)
     VALUES (@id, @name, @category, @photo_ids, @known_dims, @notes, @tags, @model, @history, @status, @error, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET name=@name, category=@category, photo_ids=@photo_ids, known_dims=@known_dims, notes=@notes,
       tags=@tags, model=@model, history=@history, status=@status, error=@error, updated_at=@updated_at`,
  ).run({
    id: item.id,
    name: item.name,
    category: item.category,
    photo_ids: JSON.stringify(item.photoIds),
    known_dims: JSON.stringify(item.knownDims),
    notes: item.notes,
    tags: JSON.stringify(item.tags),
    model: item.model ? JSON.stringify(item.model) : null,
    history: JSON.stringify(item.history),
    status: item.status,
    error: item.error,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  });
  return item;
}

const MAX_HISTORY = 30;

/** Sets a new current model and records it as a version. */
export function pushVersion(
  item: LibraryItem,
  model: ParametricModel,
  source: ModelVersion["source"],
  instruction: string,
): LibraryItem {
  item.model = model;
  item.history = [{ id: newId(), createdAt: now(), source, instruction, model }, ...item.history].slice(0, MAX_HISTORY);
  return item;
}

export function deleteItem(id: string) {
  db.prepare("DELETE FROM items WHERE id = ?").run(id);
  // Drop the item from collections and rooms that reference it
  for (const c of listCollections()) {
    if (c.itemIds.includes(id)) saveCollection({ ...c, itemIds: c.itemIds.filter((x) => x !== id) });
  }
  for (const r of db.prepare("SELECT id FROM rooms").all() as { id: string }[]) {
    const room = getRoom(r.id)!;
    const state: RoomState = {
      placements: room.state.placements.filter((p) => p.itemId !== id),
      staging: room.state.staging.filter((s) => s !== id),
    };
    if (state.placements.length !== room.state.placements.length || state.staging.length !== room.state.staging.length)
      saveRoom({ ...room, state });
  }
}

// ---------- Projects and rooms ----------

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}
const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listProjects(): Project[] {
  return (db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[]).map((p) => ({
    ...toProject(p),
    rooms: listRooms(p.id),
  }));
}

export function getProject(id: string): Project | null {
  const r = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return r ? { ...toProject(r), rooms: listRooms(id) } : null;
}

export function saveProject(p: Project) {
  p.updatedAt = now();
  db.prepare(
    `INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, updated_at = excluded.updated_at`,
  ).run(p.id, p.name, p.description, p.createdAt, p.updatedAt);
  return p;
}

export function touchProject(id: string) {
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), id);
}

interface RoomRow {
  id: string;
  project_id: string;
  name: string;
  layout: string;
  state: string;
  source_image_id: string | null;
  created_at: string;
  updated_at: string;
}

export const emptyLayout = (): Layout => ({
  lines: [],
  points: [],
  zones: [],
  ceilingHeight: 260,
  wallThickness: 15,
  wallColor: "#f2eee8",
  floorColor: "#c9a77e",
  floorKind: "wood",
  background: null,
});

const toRoom = (r: RoomRow): Room => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  layout: { ...emptyLayout(), ...json<Partial<Layout>>(r.layout, {}) },
  state: json<RoomState>(r.state, { placements: [], staging: [] }),
  sourceImageId: r.source_image_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listRooms(projectId: string): Room[] {
  return (db.prepare("SELECT * FROM rooms WHERE project_id = ? ORDER BY created_at").all(projectId) as RoomRow[]).map(toRoom);
}

export function getRoom(id: string): Room | null {
  const r = db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow | undefined;
  return r ? toRoom(r) : null;
}

export function saveRoom(room: Room) {
  room.updatedAt = now();
  db.prepare(
    `INSERT INTO rooms (id, project_id, name, layout, state, source_image_id, created_at, updated_at)
     VALUES (@id, @project_id, @name, @layout, @state, @source_image_id, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET name=@name, layout=@layout, state=@state, source_image_id=@source_image_id, updated_at=@updated_at`,
  ).run({
    id: room.id,
    project_id: room.projectId,
    name: room.name,
    layout: JSON.stringify(room.layout),
    state: JSON.stringify(room.state),
    source_image_id: room.sourceImageId,
    created_at: room.createdAt,
    updated_at: room.updatedAt,
  });
  touchProject(room.projectId);
  return room;
}

export function listConfigurations(roomId: string): RoomConfiguration[] {
  return (
    db.prepare("SELECT * FROM configurations WHERE room_id = ? ORDER BY created_at DESC").all(roomId) as {
      id: string;
      room_id: string;
      name: string;
      state: string;
      created_at: string;
    }[]
  ).map((r) => ({ id: r.id, roomId: r.room_id, name: r.name, state: json(r.state, { placements: [], staging: [] }), createdAt: r.created_at }));
}

// ---------- Collections and pins ----------

interface CollectionRow {
  id: string;
  name: string;
  source: Collection["source"];
  pinterest_board_id: string | null;
  summary: string | null;
  item_ids: string;
  created_at: string;
  updated_at: string;
}

const toCollection = (r: CollectionRow): Collection => ({
  id: r.id,
  name: r.name,
  source: r.source,
  pinterestBoardId: r.pinterest_board_id,
  summary: json(r.summary, null),
  itemIds: json(r.item_ids, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listCollections(): Collection[] {
  const rows = db.prepare("SELECT * FROM collections ORDER BY updated_at DESC").all() as CollectionRow[];
  return rows.map((r) => {
    const pins = db
      .prepare("SELECT image_id FROM pins WHERE collection_id = ? AND image_id IS NOT NULL ORDER BY created_at LIMIT 4")
      .all(r.id) as { image_id: string }[];
    const count = (db.prepare("SELECT COUNT(*) AS n FROM pins WHERE collection_id = ?").get(r.id) as { n: number }).n;
    return { ...toCollection(r), pinCount: count, coverImageIds: pins.map((p) => p.image_id) };
  });
}

export function getCollection(id: string): Collection | null {
  const r = db.prepare("SELECT * FROM collections WHERE id = ?").get(id) as CollectionRow | undefined;
  return r ? toCollection(r) : null;
}

export function saveCollection(c: Collection) {
  c.updatedAt = now();
  db.prepare(
    `INSERT INTO collections (id, name, source, pinterest_board_id, summary, item_ids, created_at, updated_at)
     VALUES (@id, @name, @source, @pinterest_board_id, @summary, @item_ids, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET name=@name, source=@source, pinterest_board_id=@pinterest_board_id, summary=@summary,
       item_ids=@item_ids, updated_at=@updated_at`,
  ).run({
    id: c.id,
    name: c.name,
    source: c.source,
    pinterest_board_id: c.pinterestBoardId,
    summary: c.summary ? JSON.stringify(c.summary) : null,
    item_ids: JSON.stringify(c.itemIds),
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  });
  return c;
}

interface PinRow {
  id: string;
  collection_id: string;
  image_id: string | null;
  image_url: string | null;
  title: string;
  link: string | null;
  pinterest_pin_id: string | null;
  created_at: string;
}

const toPin = (r: PinRow): Pin => ({
  id: r.id,
  collectionId: r.collection_id,
  imageId: r.image_id,
  imageUrl: r.image_url,
  title: r.title,
  link: r.link,
  pinterestPinId: r.pinterest_pin_id,
  createdAt: r.created_at,
});

export function listPins(collectionId: string): Pin[] {
  return (db.prepare("SELECT * FROM pins WHERE collection_id = ? ORDER BY created_at").all(collectionId) as PinRow[]).map(toPin);
}

export function getPin(id: string): Pin | null {
  const r = db.prepare("SELECT * FROM pins WHERE id = ?").get(id) as PinRow | undefined;
  return r ? toPin(r) : null;
}

export function insertPin(p: Omit<Pin, "id" | "createdAt">): Pin {
  const pin: Pin = { ...p, id: newId(), createdAt: now() };
  db.prepare(
    `INSERT INTO pins (id, collection_id, image_id, image_url, title, link, pinterest_pin_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(pin.id, pin.collectionId, pin.imageId, pin.imageUrl, pin.title, pin.link, pin.pinterestPinId, pin.createdAt);
  db.prepare("UPDATE collections SET updated_at = ? WHERE id = ?").run(now(), pin.collectionId);
  return pin;
}
