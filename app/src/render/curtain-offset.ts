export type { CurtainPoint } from '@shared/types';
export type RoomCenter = Pick<import('@shared/types').ResolvedRoom, 'x' | 'z'>;
export { offsetCurtainPointsInterior } from '@shared/render/CurtainGeometry';
