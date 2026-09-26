import { supabase } from "./supabase";
import type { BoardGame, BoardMeta, Comparison, MarketKey, Period } from "./odds";

// Thin wrappers over the board RPCs. Users never touch the tables — everything
// (including which books are visible and whether a fair line is shown) is
// decided server-side.

export interface BoardResponse { games: BoardGame[]; meta: BoardMeta }

export async function fetchBoard(sport: string, period: Period): Promise<BoardResponse> {
  const { data, error } = await supabase.rpc("board_games", { p_sport: sport, p_period: period });
  if (error) throw new Error(error.message);
  const r = data as BoardResponse | null;
  return {
    games: r?.games ?? [],
    meta: r?.meta ?? { enabled: false, staleMin: 30, periodEnabled: false, periodWindowHours: 30 },
  };
}

export async function fetchEdgeComparison(edgeId: string): Promise<Comparison | null> {
  const { data, error } = await supabase.rpc("edge_comparison", { p_edge_id: edgeId });
  if (error) throw new Error(error.message);
  return (data as Comparison | null) ?? null;
}

export async function fetchMarketComparison(
  gameId: string, period: Period, market: MarketKey, outcome: string
): Promise<Comparison | null> {
  const { data, error } = await supabase.rpc("market_comparison", {
    p_game_id: gameId, p_period: period, p_market: market, p_outcome: outcome,
  });
  if (error) throw new Error(error.message);
  return (data as Comparison | null) ?? null;
}
