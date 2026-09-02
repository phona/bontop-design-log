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

test('master bedroom candidate bed and tall wardrobe use the calculated transforms', () => {
  assert.deepEqual(placed('bed_180'), { type: 'bed_180', x: 3.20, z: 6.85, rotation: 270 });
  assert.deepEqual(placed('master_wardrobe_tall_240'), { type: 'master_wardrobe_tall_240', x: 3.00, z: 8.40, rotation: 0 });
  assert.equal(master.some((item) => item.type === 'master_wardrobe_tall_160'), false);
  assert.equal(master.some((item) => item.type === 'wardrobe_240_split'), false);
  assert.deepEqual(FURNITURE_DIMS.master_wardrobe_tall_240, { width: 2.40, depth: 0.60 });
});

test('south bedside dressing table and compact stool use the frozen geometry', () => {
  const table = placed('master_dressing_table');
  const stool = placed('dressing_stool');
  assert.deepEqual(table, { type: 'master_dressing_table', x: 3.65, z: 9.15, rotation: 270 });
  assert.deepEqual(stool, { type: 'dressing_stool', x: 3.40, z: 9.15, rotation: 270 });
  assert.deepEqual(FURNITURE_DIMS.master_dressing_table, { width: 0.85, depth: 0.40 });
  assert.deepEqual(FURNITURE_DIMS.dressing_stool, { width: 0.42, depth: 0.40 });
  assert.equal(master.some((item) => item.type === 'vanity_dresser'), false);
  assert.equal(master.some((item) => item.type === 'chair' && item.x === 0.80 && item.z === 3.66), false);
});

test('washbasin-only cabinet preserves envelope and plumbing center without a dressing chair', () => {
  // 2026-09-02 初版（迭代 mb-washbasin-curtain-20260901，假定玻璃通高，待量房终核）：
  // 柜体东移 5cm 收宽 1.05，盆/龙头居中至 x=0.575
  assert.deepEqual(placed('mb_washbasin_cabinet'), { type: 'mb_washbasin_cabinet', x: 0.575, z: 3.16, rotation: 0 });
  assert.deepEqual(FURNITURE_DIMS.mb_washbasin_cabinet, { width: 1.05, depth: 0.50 });
  const faucet = plumbing.find((point) => point.id === 'faucet_mbath_vanity');
  assert.ok(faucet);
  assert.equal(faucet.x, 0.575);
  assert.equal(faucet.z, 2.96);
});

test('dressing table reuses the existing south bedside socket within the MEP alarm threshold', () => {
  const table = placed('master_dressing_table');
  const socket = electrical.find((point) => point.id === 'sock_master_bed_r');
  assert.ok(socket?.x !== undefined && socket.z !== undefined);
  assert.equal(socket.wall_side, 'west');
  const distance = Math.hypot(table.x! - socket.x, table.z! - socket.z);
  assert.ok(distance <= 1.5, `table-socket distance ${distance.toFixed(3)}m`);
  assert.ok(distance <= 1.5);
});

test('master bed has two independent north-head sockets on opposite sides', () => {
  const left = electrical.find((point) => point.id === 'sock_master_bed_l');
  const right = electrical.find((point) => point.id === 'sock_master_bed_r_head');
  assert.ok(left?.x !== undefined && left.z !== undefined);
  assert.ok(right?.x !== undefined && right.z !== undefined);
  assert.notEqual(left.id, right.id);
  assert.equal(left.x, 4.20);
  assert.equal(right.x, 4.20);
  assert.ok(left.z < right.z);
  assert.ok(left.z >= 5.95 && left.z <= 7.75);
  assert.ok(right.z > 7.75 && right.z <= 8.10, 'right bedside socket must sit just beyond the north head edge');
  const doorSwitch = electrical.find((point) => point.id === 'switch_master_door');
  assert.ok(doorSwitch?.z !== undefined);
  assert.ok(Math.abs(left.z - doorSwitch.z) >= 0.4, 'left bedside socket must clear the door switch');
});


test('master bedroom candidate bed and wardrobe retain the recorded functional risk gap', () => {
  const bed = placed('bed_180');
  const wardrobe = placed('master_wardrobe_tall_240');
  const bedSouth = bed.z! + FURNITURE_DIMS.bed_180.width / 2; // rotation=270 swaps 1.8m width onto world z
  const wardrobeNorth = wardrobe.z! - FURNITURE_DIMS.master_wardrobe_tall_240.depth / 2;
  const gap = wardrobeNorth - bedSouth;
  assert.ok(Math.abs(gap - 0.35) < 1e-9, `bed-to-wardrobe gap ${gap.toFixed(3)}m`);
  assert.ok(gap < 0.60, '0.60m operation clearance must remain an explicit unresolved risk');
  assert.ok(Math.abs(wardrobe.x! + FURNITURE_DIMS.master_wardrobe_tall_240.width / 2 - 4.20) < 1e-9);
  assert.ok(Math.abs(wardrobe.z! + FURNITURE_DIMS.master_wardrobe_tall_240.depth / 2 - 8.70) < 1e-9);
});
