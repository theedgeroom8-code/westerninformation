// Pure helpers for the games board + line comparison — no React, no native
// modules, so everything here is unit-testable in plain Node.

// ---------------------------------------------------------------------------
// Types (shapes returned by the board_games / market_comparison / edge_comparison RPCs)
// ---------------------------------------------------------------------------
export type Period = "FG" | "1H" | "2H" | "1Q" | "2Q" | "3Q" | "4Q";
export type MarketKey = "h2h" | "h2h3" | "spreads" | "totals";

export interface Outcome { name: string; price: number; point?: number | null }

export interface BoardMarket {
  book: string;
  market: MarketKey;
  outcomes: Outcome[];
  updatedAt: string | null;
  stale: boolean;
}

export interface BoardGame {
  id: string;
  home: string;
  away: string;
  commence: string;
  status: "upcoming" | "live" | "final";
  homeScore: number | null;
  awayScore: number | null;
  markets: { h2h?: BoardMarket; spreads?: BoardMarket; totals?: BoardMarket };
}

export interface BoardMeta {
  enabled: boolean;
  updatedAt?: string | null;
  staleMin: number;
  fgRefreshMin?: number;
  periodRefreshMin?: number;
  periodEnabled: boolean;
  periodWindowHours: number;
}

export interface LineRow {
  book: string;
  point: number | null;
  price: number;
  updatedAt: string | null;
  stale: boolean;
  sharp?: boolean;
}

export interface FairLine { price: number; point: number | null; updatedAt: string | null; stale: boolean }

export interface Comparison {
  edgeId?: string;
  period: Period;
  market: MarketKey;
  outcome: string;
  point?: number | null;
  sourceBook?: string;
  sourcePrice?: number;
  staleMin: number;
  rows: LineRow[];
  fair?: FairLine | null;
  sharp?: { book: string; point: number | null; price: number; updatedAt: string | null } | null;
  game?: {
    id: string; sport: string; home: string; away: string; commence: string;
    homeScore: number | null; awayScore: number | null; completed: boolean;
  } | null;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------
export const PERIODS: { key: Period; label: string; name: string; rule: string }[] = [
  { key: "FG", label: "Full Game", name: "Full Game", rule: "Full game — overtime included." },
  { key: "1H", label: "1H", name: "1st Half", rule: "First half only — overtime not included." },
  { key: "2H", label: "2H", name: "2nd Half", rule: "Second half. Overtime treatment varies by sportsbook — check the book's rules." },
  { key: "1Q", label: "1Q", name: "1st Quarter", rule: "First quarter only — overtime not included." },
  { key: "2Q", label: "2Q", name: "2nd Quarter", rule: "Second quarter only — overtime not included." },
  { key: "3Q", label: "3Q", name: "3rd Quarter", rule: "Third quarter only — overtime not included." },
  { key: "4Q", label: "4Q", name: "4th Quarter", rule: "Fourth quarter. Overtime treatment varies by sportsbook — check the book's rules." },
];
export const periodMeta = (p: Period) => PERIODS.find((x) => x.key === p) ?? PERIODS[0];

export const MARKET_NAMES: Record<MarketKey, string> = {
  h2h: "Moneyline", h2h3: "Moneyline (3-way)", spreads: "Spread", totals: "Total",
};

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------
const MINUS = "−"; // typographic minus, as in the sportsbook screens

/** 275 → "+275" · −105 → "−105" */
export function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : "0";
}

/** 7 → "7" · 50.5 → "50.5" · −7 → "−7" ; signed:true adds "+" to positives */
export function fmtPoint(p: number | null | undefined, signed = false): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  const abs = Math.abs(p);
  const body = Number.isInteger(abs) ? String(abs) : String(abs);
  if (p < 0) return `${MINUS}${body}`;
  return signed && p > 0 ? `+${body}` : body;
}

export const decimalOdds = (price: number): number =>
  price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);

/** American price on a scale where even money (±100) is 0, so a step from −105
 *  to +100 reads as 5, not 205. Prices inside ±100 don't exist; they map to 0. */
export function centsFromEven(price: number): number {
  if (price >= 100) return price - 100;
  if (price <= -100) return price + 100;
  return 0;
}

// ---------------------------------------------------------------------------
// Eastern Time (DST-correct without relying on Intl time-zone support, which
// is patchy on some React Native engines)
// ---------------------------------------------------------------------------
const nthSundayUtc = (year: number, month: number, n: number, hourUtc: number): number => {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0 = Sunday
  const firstSunday = 1 + ((7 - first) % 7);
  return Date.UTC(year, month, firstSunday + 7 * (n - 1), hourUtc, 0, 0);
};

/** ET offset in minutes for a UTC instant: −240 (EDT) or −300 (EST). US rules:
 *  DST starts 2nd Sunday of March 02:00 EST (07:00 UTC), ends 1st Sunday of
 *  November 02:00 EDT (06:00 UTC). */
export function etOffsetMinutes(ms: number): number {
  const y = new Date(ms).getUTCFullYear();
  const start = nthSundayUtc(y, 2, 2, 7);
  const end = nthSundayUtc(y, 10, 1, 6);
  return ms >= start && ms < end ? -240 : -300;
}

/** A Date whose UTC getters read as the Eastern wall clock. */
export const toET = (ms: number): Date => new Date(ms + etOffsetMinutes(ms) * 60000);

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sun, Sep 27" */
export function formatDateET(input: Date | string | number): string {
  const e = toET(new Date(input).getTime());
  return `${DOW[e.getUTCDay()]}, ${MON[e.getUTCMonth()]} ${e.getUTCDate()}`;
}

/** "1:00 PM" */
export function formatTimeET(input: Date | string | number): string {
  const e = toET(new Date(input).getTime());
  const h = e.getUTCHours();
  const m = e.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Sun, Sep 27 · 1:00 PM ET" — the full kickoff stamp the client asked for. */
export function formatKickoff(input: Date | string | number): string {
  return `${formatDateET(input)} · ${formatTimeET(input)} ET`;
}

/** Eastern calendar day as YYYY-MM-DD (sortable, used to group the board). */
export function etDayKey(input: Date | string | number): string {
  const e = toET(new Date(input).getTime());
  return `${e.getUTCFullYear()}-${String(e.getUTCMonth() + 1).padStart(2, "0")}-${String(e.getUTCDate()).padStart(2, "0")}`;
}

/** "Today" · "Tomorrow" · "Sat, Oct 3" — relative to the Eastern calendar. */
export function dayTitle(input: Date | string | number, nowMs: number = Date.now()): string {
  const key = etDayKey(input);
  const today = toET(nowMs);
  const tomorrow = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  const k = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  if (key === k(today)) return "Today";
  if (key === k(tomorrow)) return "Tomorrow";
  return formatDateET(input);
}

/** "just now" · "4m ago" · "2h 5m ago" · "3d ago" */
export function timeAgo(iso: string | number | Date | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "—";
  const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return "—";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Board grouping
// ---------------------------------------------------------------------------
export interface DayGroup { key: string; title: string; games: BoardGame[] }

/** Group games under Eastern-calendar date headers, kickoff-sorted. */
export function groupByDay(games: BoardGame[], nowMs: number = Date.now()): DayGroup[] {
  const sorted = [...games].sort((a, b) => new Date(a.commence).getTime() - new Date(b.commence).getTime() || a.id.localeCompare(b.id));
  const out: DayGroup[] = [];
  for (const g of sorted) {
    // a game already under way belongs to today's group even if it started before midnight ET
    const key = g.status === "live" ? etDayKey(nowMs) : etDayKey(g.commence);
    let grp = out.find((x) => x.key === key);
    if (!grp) { grp = { key, title: dayTitle(g.status === "live" ? nowMs : g.commence, nowMs), games: [] }; out.push(grp); }
    grp.games.push(g);
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Board cell resolution
// ---------------------------------------------------------------------------
export type CellSide = "away" | "home" | "over" | "under" | "tie";

export interface Cell {
  market: MarketKey;
  outcome: string;      // the name the RPCs expect (team / Over / Under / Draw)
  point: number | null;
  price: number | null;
  stale: boolean;
  book: string | null;
}

const EMPTY = (market: MarketKey, outcome: string): Cell => ({ market, outcome, point: null, price: null, stale: false, book: null });

export function resolveCell(game: BoardGame, kind: "spreads" | "totals" | "h2h", side: CellSide): Cell {
  const teamName = side === "away" ? game.away : side === "home" ? game.home : side === "over" ? "Over" : side === "under" ? "Under" : "Draw";
  const m = game.markets[kind];
  if (!m) return EMPTY(kind === "h2h" ? "h2h" : kind, teamName);
  const o = m.outcomes.find((x) => x.name === teamName);
  if (!o || typeof o.price !== "number") return EMPTY(m.market, teamName);
  return { market: m.market, outcome: teamName, point: o.point ?? null, price: o.price, stale: m.stale, book: m.book };
}

/** The strongest active edge that sits on this cell's market + side + period. */
export function edgeOnCell<E extends { eventId?: string | null; period?: string; marketKey?: string | null; outcomeName?: string | null; edgePercentage: number; status?: string }>(
  edges: E[], gameId: string, period: Period, cell: Cell
): E | null {
  if (cell.price === null) return null;
  const mk = cell.market === "h2h3" ? "h2h" : cell.market;
  let best: E | null = null;
  for (const e of edges) {
    if (e.status && e.status !== "active") continue;
    if (e.eventId !== gameId || (e.period ?? "FG") !== period || e.marketKey !== mk || e.outcomeName !== cell.outcome) continue;
    if (!best || e.edgePercentage > best.edgePercentage) best = e;
  }
  return best;
}

/** "LA Chargers" style short label: last word of a nickname is too terse for
 *  colleges ("Rams"), so keep the full name — the card wraps it to two lines. */
export function teamNickname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

// ---------------------------------------------------------------------------
// Line comparison: ranking best → worst
// ---------------------------------------------------------------------------
/** Higher = better for the bettor, for the line itself (not the price). */
export function pointValue(market: MarketKey, outcome: string, point: number | null): number {
  if (point === null || point === undefined) return 0;
  if (market === "spreads") return point;                 // +7 beats +6.5 for the dog, −2.5 beats −3 for the favorite
  if (market === "totals") return outcome === "Over" ? -point : point; // lower total is better for Over, higher for Under
  return 0;
}

/** Sort rows best → worst. Fresh prices always outrank stale ones (a price the
 *  feed hasn't confirmed can't be "best"); then better line; then better price. */
export function rankRows(market: MarketKey, outcome: string, rows: LineRow[]): LineRow[] {
  return [...rows].sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    const pv = pointValue(market, outcome, b.point) - pointValue(market, outcome, a.point);
    if (pv !== 0) return pv;
    const dv = decimalOdds(b.price) - decimalOdds(a.price);
    if (Math.abs(dv) > 1e-9) return dv;
    return a.book.localeCompare(b.book);
  });
}

export interface Diff { text: string; tone: "best" | "worse" | "better" | "same" }

/** "Difference vs best": price gap in cents when the line is the same, the line
 *  gap when the numbers differ (the line is the bigger deal). */
export function diffVsBest(market: MarketKey, outcome: string, best: LineRow, row: LineRow): Diff {
  if (row === best) return { text: "—", tone: "best" };
  const dPoint = pointValue(market, outcome, row.point) - pointValue(market, outcome, best.point);
  if (dPoint !== 0) {
    const abs = Math.abs(dPoint);
    return { text: `${dPoint < 0 ? MINUS : "+"}${abs} pt`, tone: dPoint < 0 ? "worse" : "better" };
  }
  const dCents = centsFromEven(row.price) - centsFromEven(best.price);
  // level with the best (same line, same price) → it IS a best price too
  if (dCents === 0) return { text: "—", tone: "best" };
  return { text: `${dCents < 0 ? MINUS : "+"}${Math.abs(dCents)}`, tone: dCents < 0 ? "worse" : "better" };
}

/** Full label for the play's side: "New York Giants ML". */
export function sideHeader(market: MarketKey, outcome: string): string {
  if (market === "h2h") return `${outcome} ML`;
  if (market === "h2h3") return outcome === "Draw" ? "Tie" : `${outcome} ML (3-way)`;
  return outcome;
}

/** Compact column title for a phone-width table: "Giants ML", "Chargers", "Over". */
export function sideHeaderShort(market: MarketKey, outcome: string): string {
  const nick = teamNickname(outcome);
  if (market === "h2h") return `${nick} ML`;
  if (market === "h2h3") return outcome === "Draw" ? "Tie" : `${nick} ML`;
  if (market === "spreads") return nick;
  return outcome;
}

/** How one book's number reads in the comparison: "−3 / +130" or "+100". */
export function fmtLine(market: MarketKey, outcome: string, row: { point: number | null; price: number }): string {
  if (market === "h2h" || market === "h2h3") return fmtPrice(row.price);
  if (market === "totals") return `${outcome === "Under" ? "U" : "O"} ${fmtPoint(row.point)} / ${fmtPrice(row.price)}`;
  return `${fmtPoint(row.point, true)} / ${fmtPrice(row.price)}`;
}

// ---------------------------------------------------------------------------
// Sportsbook deep links (nice-to-have): open the book's site/app landing page
// ---------------------------------------------------------------------------
export const BOOK_LINKS: Record<string, string> = {
  DraftKings: "https://sportsbook.draftkings.com/",
  FanDuel: "https://sportsbook.fanduel.com/",
  BetMGM: "https://sports.betmgm.com/",
  Caesars: "https://sportsbook.caesars.com/",
  Circa: "https://circasports.com/",
  Wynn: "https://www.wynnbet.com/",
};
