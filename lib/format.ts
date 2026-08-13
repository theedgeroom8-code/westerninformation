/** "Starts in" countdown that stays human at every scale:
 *  42m · 5h 12m · 3d 4h — never "425h 45m". */
export function formatTimeToGame(minutes: number): string {
  const mins = Math.max(0, Math.floor(minutes));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
