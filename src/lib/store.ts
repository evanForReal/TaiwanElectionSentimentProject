import { useMemo } from "react";
import { create } from "zustand";
import type { LibraryItem } from "../../shared/types.ts";
import type { Units } from "../../shared/units.ts";
import { api, type SettingsResponse } from "./api.ts";

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

interface AppStore {
  settings: SettingsResponse | null;
  units: Units;
  loadSettings: () => Promise<void>;
  setUnits: (u: Units) => void;

  items: LibraryItem[];
  itemsLoaded: boolean;
  loadItems: () => Promise<void>;
  upsertItem: (item: LibraryItem) => void;
  removeItem: (id: string) => void;

  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
}

let toastId = 0;

export const useApp = create<AppStore>((set, get) => ({
  settings: null,
  units: "metric",
  loadSettings: async () => {
    const s = await api.settings();
    set({ settings: s, units: s.units });
  },
  setUnits: (units) => {
    set({ units });
    api.updateSettings({ units }).catch(() => {});
  },

  items: [],
  itemsLoaded: false,
  loadItems: async () => {
    const items = await api.items();
    set({ items, itemsLoaded: true });
  },
  upsertItem: (item) => {
    const items = get().items;
    const i = items.findIndex((x) => x.id === item.id);
    set({ items: i === -1 ? [item, ...items] : items.map((x) => (x.id === item.id ? item : x)) });
  },
  removeItem: (id) => set({ items: get().items.filter((i) => i.id !== id) }),

  toasts: [],
  toast: (text, kind = "info") => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === "error" ? 6000 : 3200);
  },
}));

export const toast = (text: string, kind?: Toast["kind"]) => useApp.getState().toast(text, kind);
export const toastError = (err: unknown) => toast(err instanceof Error ? err.message : String(err), "error");

/** Lookup map of library items, kept fresh from the store. */
export function useItemMap(): Map<string, LibraryItem> {
  const items = useApp((s) => s.items);
  return useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
}
