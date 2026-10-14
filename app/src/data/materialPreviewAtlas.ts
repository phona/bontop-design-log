import type { MaterialManufacturerAtlas, MaterialPreviewAtlasConfig } from '@shared/types';

export interface MaterialPreviewAtlas {
  id: string;
  label: string;
  note: string;
  atlas: MaterialManufacturerAtlas;
}

/** Resolve a declared regular contact-sheet grid into explicit source-image rectangles. */
export function resolvePreviewAtlas(config: MaterialPreviewAtlasConfig): MaterialPreviewAtlas {
  const { grid } = config;
  const inset = Math.max(0, grid.inset ?? 0);
  const faces = Array.from({ length: grid.columns * grid.rows }, (_, index) => {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    return {
      id: `face-${String(index + 1).padStart(2, '0')}`,
      x: Math.round(grid.x + column * (grid.cellWidth + grid.gapX) + inset),
      y: Math.round(grid.y + row * (grid.cellHeight + grid.gapY) + inset),
      width: Math.floor(grid.cellWidth - inset * 2),
      height: Math.floor(grid.cellHeight - inset * 2),
    };
  });
  return {
    id: config.id,
    label: config.label,
    note: config.note,
    atlas: {
      atlasUrl: config.atlasUrl,
      atlasHash: config.atlasHash,
      status: config.status,
      declaredFaceCount: config.declaredFaceCount,
      faces,
    },
  };
}
