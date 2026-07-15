import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ProjectCatalog } from '../../server/project-catalog.js';

describe('model-geometry layout matches floor plan', () => {
  it('has expected rooms with approximate floor-plan dimensions', () => {
    const catalog = ProjectCatalog.load('.');
    const rooms = catalog.getRooms();
    const byId = new Map(rooms.map(r => [r.id, r]));

    assert(byId.has('master_bedroom'));
    const master = byId.get('master_bedroom')!;
    // 旋转后 width/depth 互换，所以任一维度在范围内即可
    assert(
      (master.width >= 4.0 && master.width <= 4.4) ||
      (master.depth >= 4.0 && master.depth <= 4.4),
      'master width or depth ~4.2m'
    );
    assert(
      (master.depth >= 4.0 && master.depth <= 4.6) ||
      (master.width >= 4.0 && master.width <= 4.6),
      'master depth or width ~4.3m'
    );

    assert(byId.has('living_dining'));
    const living = byId.get('living_dining')!;
    assert(
      (living.width >= 3.0 && living.width <= 6.6) ||
      (living.depth >= 3.0 && living.depth <= 6.6) ||
      (living.width >= 6.2 && living.depth >= 7.0) ||
      (living.depth >= 6.2 && living.width >= 7.0),
      'living_dining long edge ~6.2-7.8m, short ~6.2m'
    );

    assert(byId.has('bedroom_se'));
    const bedroom_se = byId.get('bedroom_se')!;
    assert(
      (bedroom_se.width >= 2.5 && bedroom_se.width <= 3.5) ||
      (bedroom_se.depth >= 2.5 && bedroom_se.depth <= 3.5),
      'bedroom_se short edge ~3.0m'
    );
    assert(
      (bedroom_se.depth >= 4.0 && bedroom_se.depth <= 4.8) ||
      (bedroom_se.width >= 4.0 && bedroom_se.width <= 4.8),
      'bedroom_se long edge ~4.4m'
    );

    assert(byId.has('entry_garden'));
    const entry = byId.get('entry_garden')!;
    assert(
      (entry.width >= 4.0 && entry.width <= 4.8) ||
      (entry.depth >= 4.0 && entry.depth <= 4.8),
      'entry garden long edge ~4.45m'
    );
  });
});
