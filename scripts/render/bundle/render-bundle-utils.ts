import type { CurtainRenderProjection } from '../../../shared/types.js';

/** Return the stable, sorted curtain node ids declared by the render-facts projection. */
export function expectedCurtainNodeIds(projection: CurtainRenderProjection): string[] {
  return projection.curtains.flatMap((curtain) => curtain.expectedVisibleNodes).sort();
}
