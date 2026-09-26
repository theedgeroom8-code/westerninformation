import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

/**
 * Calls `onChange` (debounced) whenever the engine ingests fresh lines.
 * The engine touches one tiny `board_state` row per ingest — that is the only
 * table broadcast for the board, so an open screen refetches once per refresh
 * instead of once per changed price.
 */
export function useBoardRealtime(onChange: () => void, enabled = true, debounceMs = 1200) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // unique channel name: remounting a screen must never re-add handlers to a subscribed channel
    const channel = supabase
      .channel(`board-rt-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "board_state" }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => cb.current(), debounceMs);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled, debounceMs]);
}
