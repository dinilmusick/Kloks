export interface SocketCoordOptions {
  cardWidth: number;
  isOutput: boolean;
  clearance?: number;
  nudge?: { x: number; y: number };
}

export interface SocketCoordResult {
  baseX: number;
  effectiveX: number;
  effectiveY: number;
  nudge: { x: number; y: number };
}

/**
 * Calculates socket handle coordinates enforcing the 12px spatial clearance invariant
 * and applying custom nudge displacement offsets.
 */
export function calculateSocketCoordinates(
  baseY: number,
  options: SocketCoordOptions
): SocketCoordResult {
  const clearance = options.clearance ?? 12;
  const nudge = options.nudge ?? { x: 0, y: 0 };
  
  // Anti-obscuring rule: pushed outward from node body edge by at least 12px
  const baseX = options.isOutput 
    ? (options.cardWidth / 2) + clearance 
    : -(options.cardWidth / 2) - clearance;

  return {
    baseX,
    effectiveX: baseX + nudge.x,
    effectiveY: baseY + nudge.y,
    nudge
  };
}

/**
 * Dual-layered polygon beam points helper for tapered energy beam tethers.
 * Tapers from thick at base (node body) to a fine point at head (displaced handle).
 */
export const getBeamPoints = (
  nudge: { x: number; y: number },
  baseW = 5,
  headW = 1.2
): string => {
  const vx = -nudge.x;
  const vy = -nudge.y;
  const d = Math.sqrt(vx * vx + vy * vy);
  if (d < 1) return "";

  const px = -vy / d;
  const py = vx / d;

  const hL_x = -px * headW;
  const hL_y = -py * headW;
  const hR_x = px * headW;
  const hR_y = py * headW;

  const bR_x = vx + px * baseW;
  const bR_y = vy + py * baseW;
  const bL_x = vx - px * baseW;
  const bL_y = vy - py * baseW;

  return `${hL_x},${hL_y} ${hR_x},${hR_y} ${bR_x},${bR_y} ${bL_x},${bL_y}`;
};
