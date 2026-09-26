import { create } from "zustand";
import { fetchBoard } from "../lib/boardApi";
import type { BoardGame, BoardMeta, Period } from "../lib/odds";

// Games board cache, keyed by "SPORT:PERIOD". Switching tabs/periods shows the
// last data instantly (stale-while-revalidate) while a fresh copy loads.

export interface BoardSlice {
  games: BoardGame[];
  meta: BoardMeta | null;
  fetchedAt: number;   // epoch ms of the last successful load
  error: string | null;
}

interface GamesStore {
  slices: Record<string, BoardSlice>;
  loading: Record<string, boolean>;
  load: (sport: string, period: Period) => Promise<void>;
  clear: () => void;
}

const EMPTY: BoardSlice = { games: [], meta: null, fetchedAt: 0, error: null };
export const sliceKey = (sport: string, period: Period) => `${sport}:${period}`;
export const emptySlice = EMPTY;

// Only the newest request per key may write — a slow response for a tab the
// user already left must not overwrite a fresher one.
const seq: Record<string, number> = {};

export const useGamesStore = create<GamesStore>((set, get) => ({
  slices: {},
  loading: {},

  load: async (sport, period) => {
    const key = sliceKey(sport, period);
    const mine = (seq[key] = (seq[key] ?? 0) + 1);
    set((s) => ({ loading: { ...s.loading, [key]: true } }));
    try {
      const { games, meta } = await fetchBoard(sport, period);
      if (seq[key] !== mine) return;
      set((s) => ({
        slices: { ...s.slices, [key]: { games, meta, fetchedAt: Date.now(), error: null } },
        loading: { ...s.loading, [key]: false },
      }));
    } catch (e: any) {
      if (seq[key] !== mine) return;
      // keep whatever we already had; just flag the failure
      const prev = get().slices[key] ?? EMPTY;
      set((s) => ({
        slices: { ...s.slices, [key]: { ...prev, error: e?.message || "Couldn't load games" } },
        loading: { ...s.loading, [key]: false },
      }));
    }
  },

  clear: () => set({ slices: {}, loading: {} }),
}));
