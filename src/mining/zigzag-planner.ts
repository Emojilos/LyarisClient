import { Vec3 } from 'vec3';
import type { NormalizedArea } from '../types.js';

/**
 * Generates mining positions in a zigzag pattern.
 * Goes top-to-bottom (Y), alternating X direction per Z row.
 * This ensures the bot moves efficiently without backtracking.
 */
export function generateZigzagPositions(area: NormalizedArea): Vec3[] {
  const positions: Vec3[] = [];

  for (let y = area.max.y; y >= area.min.y; y--) {
    let reverseX = false;
    for (let z = area.min.z; z <= area.max.z; z++) {
      if (reverseX) {
        for (let x = area.max.x; x >= area.min.x; x--) {
          positions.push(new Vec3(x, y, z));
        }
      } else {
        for (let x = area.min.x; x <= area.max.x; x++) {
          positions.push(new Vec3(x, y, z));
        }
      }
      reverseX = !reverseX;
    }
  }

  return positions;
}
