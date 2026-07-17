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
    assert(master.width >= 4.0 && master.width <= 4.4, 'master width ~4.2m');
    assert(master.depth >= 4.0 && master.depth <= 4.6, 'master depth ~4.3m');

    assert(byId.has('living_dining'));
    const living = byId.get('living_dining')!;
    assert(living.width >= 5.8 && living.width <= 6.6, 'living width ~6.2m');

    assert(byId.has('balcony'));
    const balcony = byId.get('balcony')!;
    assert(balcony.depth >= 1.0 && balcony.depth <= 1.5, 'balcony (生活阳台) depth ~1.2m');

    assert(byId.has('entry_garden'));
    const entry = byId.get('entry_garden')!;
    assert(entry.width >= 4.0 && entry.width <= 4.8, 'entry garden width ~4.45m');
  });
});
