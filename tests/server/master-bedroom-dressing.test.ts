import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { FURNITURE_DIMS } from '../../shared/types.js';

type Furnishing = { type: string; x?: number; z?: number; rotation?: number };
type ElectricalPoint = { id: string; x?: number; z?: number; wall_side?: string };
type PlumbingPoint = { id: string; x?: number; z?: number };

const house = load(readFileSync('config/house.yaml', 'utf8')) as { furnishings: Record<string, Furnishing[]> };
const electrical = load(readFileSync('config/electrical.yaml', 'utf8')) as ElectricalPoint[];
const plumbing = load(readFileSync('config/plumbing.yaml', 'utf8')) as PlumbingPoint[];
const master = house.furnishings.master_bedroom;

function placed(type: string): Furnishing {
  const item = master.find((candidate) => candidate.type === type && candidate.x !== undefined && candidate.z !== undefined);
  assert.ok(item, `missing placed ${type}`);
  return item;
}

test('master bedroom frozen bed and wardrobe transforms remain unchanged', () => {
  assert.deepEqual(placed('bed_180'), { type: 'bed_180', x: 3.20, z: 7.875, rotation: 270 });
  assert.deepEqual(placed('wardrobe_240_split'), { type: 'wardrobe_240_split', x: 3.00, z: 5.95, rotation: 0 });
});

test('south bedside dressing table and compact stool use the frozen geometry', () => {
  const table = placed('master_dressing_table');
  const stool = placed('dressing_stool');
  assert.deepEqual(table, { type: 'master_dressing_table', x: 4.00, z: 9.245, rotation: 270 });
  assert.deepEqual(stool, { type: 'dressing_stool', x: 3.75, z: 9.245, rotation: 270 });
  assert.deepEqual(FURNITURE_DIMS.master_dressing_table, { width: 0.85, depth: 0.40 });
  assert.deepEqual(FURNITURE_DIMS.dressing_stool, { width: 0.42, depth: 0.40 });
  assert.equal(master.some((item) => item.type === 'vanity_dresser'), false);
  assert.equal(master.some((item) => item.type === 'chair' && item.x === 0.80 && item.z === 3.66), false);
});

test('washbasin-only cabinet preserves envelope and plumbing center without a dressing chair', () => {
  assert.deepEqual(placed('mb_washbasin_cabinet'), { type: 'mb_washbasin_cabinet', x: 0.55, z: 3.16, rotation: 0 });
  assert.deepEqual(FURNITURE_DIMS.mb_washbasin_cabinet, { width: 1.10, depth: 0.50 });
  const faucet = plumbing.find((point) => point.id === 'faucet_mbath_vanity');
  assert.ok(faucet);
  assert.equal(faucet.x, 0.26);
  assert.equal(faucet.z, 2.96);
});

test('dressing table reuses the existing south bedside socket within the MEP alarm threshold', () => {
  const table = placed('master_dressing_table');
  const socket = electrical.find((point) => point.id === 'sock_master_bed_r');
  assert.ok(socket?.x !== undefined && socket.z !== undefined);
  assert.equal(socket.wall_side, 'west');
  const distance = Math.hypot(table.x! - socket.x, table.z! - socket.z);
  assert.ok(distance < 0.21, `table-socket distance ${distance.toFixed(3)}m`);
  assert.ok(distance <= 1.5);
});
