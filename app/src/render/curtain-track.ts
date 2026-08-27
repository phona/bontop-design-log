export type { CurtainPoint } from '@shared/types';
export type CurtainTrackPoint = import('@shared/render/CurtainGeometry').CurtainTrackPoint;
export {
  gatheredCurtainSegments,
  sampleCurtainTrack,
  sliceCurtainTrack,
} from '@shared/render/CurtainGeometry';
