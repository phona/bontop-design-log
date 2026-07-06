import type { Topic, SceneApi } from '@shared/types';
import { HvacTopic } from './HvacTopic.js';
import { FloorTopic } from './FloorTopic.js';
import { WallTopic } from './WallTopic.js';
import { PaintTopic } from './PaintTopic.js';

export class TopicRegistry {
  private topics = new Map<string, Topic>();
  private scene?: SceneApi;

  constructor(scene?: SceneApi) {
    this.scene = scene;
    this.register(new HvacTopic());
    this.register(new FloorTopic());
    this.register(new WallTopic());
    this.register(new PaintTopic());
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
