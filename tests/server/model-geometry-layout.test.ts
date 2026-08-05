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

    assert(living.depth >= 6.7 && living.depth <= 7.1, 'living depth ~6.9m (DEC-014 吞并餐厅带+走廊 z:[2.90,9.80])');

    assert(byId.has('kitchen'));
    const kitchen = byId.get('kitchen')!;
    assert(kitchen.width >= 3.4 && kitchen.width <= 3.8, 'kitchen width ~3.6m');
    assert(kitchen.depth >= 2.7 && kitchen.depth <= 3.1, 'kitchen depth ~2.9m (DEC-014 南界 z=2.9)');

    assert(byId.has('balcony'));
    const balcony = byId.get('balcony')!;
    assert(balcony.depth >= 1.0 && balcony.depth <= 1.5, 'balcony (生活阳台) depth ~1.2m');

    assert(byId.has('entry_garden'));
    const entry = byId.get('entry_garden')!;
    assert(entry.width >= 4.3 && entry.width <= 4.6, 'entry garden width ~4.45m (x:[10.80,15.25])');
  });
});
