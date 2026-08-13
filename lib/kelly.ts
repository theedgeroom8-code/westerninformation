// Kelly Criterion — brief §2.4:
//   Full Kelly % = (Edge × Decimal Odds) / (Decimal Odds − 1)
//   Wager = bankroll × Full Kelly % × (user Kelly fraction)
// Always computed client-side from the LIVE bankroll (brief §7.2).

export const americanToDecimal = (odds: number): number =>
  odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);

export function recommendedWager(
  edgePct: number,
  americanOdds: number,
  bankroll: number,
  kellyFraction: number
): number {
  if (bankroll <= 0 || edgePct <= 0) return 0;
  const dec = americanToDecimal(americanOdds);
  const fullKelly = (edgePct / 100) * dec / (dec - 1);
  const wager = bankroll * fullKelly * (kellyFraction / 100);
  return Math.max(0, Math.round(wager));
}

// No-Vig helper (admin calculator): two-sided juice → fair probabilities/odds.
export function noVig(juiceA: number, juiceB: number) {
  const impl = (o: number) => (o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100));
  const pA = impl(juiceA);
  const pB = impl(juiceB);
  const total = pA + pB;
  const fairA = pA / total;
  const fairB = pB / total;
  const toAmerican = (p: number) =>
    p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
  return {
    vigPct: (total - 1) * 100,
    fairProbA: fairA,
    fairProbB: fairB,
    fairOddsA: toAmerican(fairA),
    fairOddsB: toAmerican(fairB),
  };
}
