import type {
  AppSettings,
  ArrangeProposal,
  RoomStyle,
  Collection,
  Dimensions,
  ImageRecord,
  Layout,
  LibraryItem,
  MatchResult,
  ParametricModel,
  Pin,
  Project,
  Room,
  RoomConfiguration,
  RoomState,
} from "../../shared/types.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? data?.message ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

const get = <T>(url: string) => req<T>("GET", url);
const post = <T>(url: string, body?: unknown) => req<T>("POST", url, body ?? {});
const patch = <T>(url: string, body: unknown) => req<T>("PATCH", url, body);
const del = <T>(url: string) => req<T>("DELETE", url);

export type SettingsResponse = AppSettings & { pinterestRedirectUri: string };
export type CollectionWithPins = Collection & { pins: Pin[] };
export type LayoutDraftResponse = { layout: Layout; notes: string; scaleReasoning: string; imageKind: string };
export type PinterestBoard = { id: string; name: string; description: string; pinCount: number; coverUrl: string | null };

export const api = {
  settings: () => get<SettingsResponse>("/api/settings"),
  updateSettings: (body: Record<string, unknown>) => patch<SettingsResponse>("/api/settings", body),

  uploadImages: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("file", f, f.name));
    return post<ImageRecord[]>("/api/images", fd);
  },
  imageFromUrl: (url: string) => post<ImageRecord>("/api/images/from-url", { url }),
  image: (id: string) => get<ImageRecord>(`/api/images/${id}`),

  items: () => get<LibraryItem[]>("/api/items"),
  item: (id: string) => get<LibraryItem>(`/api/items/${id}`),
  createItem: (body: {
    name?: string;
    category?: string;
    photoIds?: string[];
    knownDims?: Partial<Dimensions>;
    notes?: string;
    tags?: string[];
    generate?: "claude" | "template";
  }) => post<LibraryItem>("/api/items", body),
  updateItem: (id: string, body: Partial<LibraryItem> & { model?: ParametricModel; versionNote?: string }) =>
    patch<LibraryItem>(`/api/items/${id}`, body),
  regenerate: (id: string, body: { mode?: "claude" | "template"; hint?: string }) =>
    post<LibraryItem>(`/api/items/${id}/generate`, body),
  editItem: (id: string, instruction: string) => post<LibraryItem>(`/api/items/${id}/edit`, { instruction }),
  revertItem: (id: string, versionId: string) => post<LibraryItem>(`/api/items/${id}/revert`, { versionId }),
  duplicateItem: (id: string) => post<LibraryItem>(`/api/items/${id}/duplicate`),
  deleteItem: (id: string) => del(`/api/items/${id}`),

  projects: () => get<Project[]>("/api/projects"),
  project: (id: string) => get<Project>(`/api/projects/${id}`),
  createProject: (name: string, description = "") => post<Project>("/api/projects", { name, description }),
  updateProject: (id: string, body: { name?: string; description?: string }) => patch<Project>(`/api/projects/${id}`, body),
  deleteProject: (id: string) => del(`/api/projects/${id}`),

  createRoom: (projectId: string, body: { name?: string; layout?: Partial<Layout>; sourceImageId?: string }) =>
    post<Room>(`/api/projects/${projectId}/rooms`, body),
  room: (id: string) => get<Room>(`/api/rooms/${id}`),
  updateRoom: (id: string, body: { name?: string; layout?: Layout; state?: RoomState; style?: RoomStyle; sourceImageId?: string | null }) =>
    patch<Room>(`/api/rooms/${id}`, body),
  styleCheck: (roomId: string) => post<Room>(`/api/rooms/${roomId}/style-check`),
  arrange: (roomId: string, instruction: string, includeStaging: boolean) =>
    post<ArrangeProposal>(`/api/rooms/${roomId}/arrange`, { instruction, includeStaging }),
  deleteRoom: (id: string) => del(`/api/rooms/${id}`),
  draftLayout: (roomId: string, imageId: string, hint: string) =>
    post<LayoutDraftResponse>(`/api/rooms/${roomId}/draft-layout`, { imageId, hint }),
  configurations: (roomId: string) => get<RoomConfiguration[]>(`/api/rooms/${roomId}/configurations`),
  saveConfiguration: (roomId: string, name: string) => post<RoomConfiguration[]>(`/api/rooms/${roomId}/configurations`, { name }),
  applyConfiguration: (id: string) => post<Room>(`/api/configurations/${id}/apply`),
  deleteConfiguration: (id: string) => del(`/api/configurations/${id}`),

  collections: () => get<Collection[]>("/api/collections"),
  collection: (id: string) => get<CollectionWithPins>(`/api/collections/${id}`),
  createCollection: (name: string) => post<Collection>("/api/collections", { name }),
  renameCollection: (id: string, name: string) => patch<Collection>(`/api/collections/${id}`, { name }),
  deleteCollection: (id: string) => del(`/api/collections/${id}`),
  addPins: (id: string, body: { pinIds?: string[]; imageIds?: string[]; urls?: string[] }) =>
    post<{ added: Pin[]; failed: { url: string; error: string }[] }>(`/api/collections/${id}/pins`, body),
  removePins: (collectionId: string, pinIds: string[]) => post(`/api/collections/${collectionId}/pins/remove`, { pinIds }),
  allPins: () => get<Pin[]>("/api/pins"),
  /** Adds pins to `to`; with `from`, moves them out of that collection. */
  linkPins: (pinIds: string[], to: string, from?: string) => post("/api/pins/link", { pinIds, to, from }),
  summarize: (id: string, pinIds?: string[]) => post<Collection>(`/api/collections/${id}/summarize`, { pinIds }),
  match: (id: string, request: string) => post<MatchResult>(`/api/collections/${id}/match`, { request }),
  setCollectionItems: (id: string, itemIds: string[], mode: "add" | "remove" | "set") =>
    post<Collection>(`/api/collections/${id}/items`, { itemIds, mode }),

  pinterestBoards: () => get<PinterestBoard[]>("/api/pinterest/boards"),
  pinterestImport: (boardId: string, boardName: string, collectionId?: string) =>
    post<{ collectionId: string; added: number; skipped: number; failed: number }>("/api/pinterest/import", {
      boardId,
      boardName,
      collectionId,
    }),
  pinterestDisconnect: () => post("/api/pinterest/disconnect"),
};
