import type { Topic, SceneApi } from '@shared/types';
import { HvacTopic } from './HvacTopic.js';
import { FloorTopic } from './FloorTopic.js';
import { BedroomFloorTopic } from './BedroomFloorTopic.js';
import { WallTopic } from './WallTopic.js';
import { PaintTopic } from './PaintTopic.js';
import { CabinetTopic } from './CabinetTopic.js';
import { CountertopTopic } from './CountertopTopic.js';
import { SanitaryTopic } from './SanitaryTopic.js';
import { DoorTopic } from './DoorTopic.js';
import { CurtainTopic } from './CurtainTopic.js';

export class TopicRegistry {
  private topics = new Map<string, Topic>();
  private scene?: SceneApi;

  constructor(scene?: SceneApi) {
    this.scene = scene;
    this.register(new HvacTopic());
    this.register(new FloorTopic());
    this.register(new BedroomFloorTopic());
    this.register(new WallTopic());
    this.register(new PaintTopic());
    this.register(new CabinetTopic());
    this.register(new CountertopTopic());
    this.register(new SanitaryTopic());
    this.register(new DoorTopic());
    this.register(new CurtainTopic());
  }

  register(topic: Topic) {
    this.topics.set(topic.id, topic);
  }

  get(id: string): Topic | undefined {
    return this.topics.get(id);
  }

  list(): Topic[] {
    return Array.from(this.topics.values());
  }
}
