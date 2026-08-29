import * as THREE from 'three';
import type { LightingRenderConfig, RenderLightingFixture } from '../types.js';
import { getResolvedTrackLightHeads, getTrackLightConfig } from './TrackLightLayout.js';

export interface LightingFixtureBuildResult {
  group: THREE.Group;
  fixtures: Map<string, THREE.Group>;
  parts: number;
}

const CEILING_CLEARANCE = 0.05;

function material(color: number, roughness = 0.6, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function emissive(color: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xfff5e0,
    emissive: color,
    emissiveIntensity: 1.4,
    roughness: 0.6,
  });
}

function part<T extends THREE.Object3D>(object: T, fixture: RenderLightingFixture, name: string, role: string): T {
  object.name = `electrical:${fixture.id}:part=${name}:role=${role}`;
  object.userData = { part: name, materialRole: role };
  return object;
}

function addPendant(group: THREE.Group, fixture: RenderLightingFixture, glow: THREE.Color): number {
  const { x, y, z } = fixture.position;
  const cord = part(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9), material(0x333333, 0.5, 0.6)), fixture, 'cord', 'fixture_metal');
  cord.position.set(x, y - 0.45, z);
  const shade = part(new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), emissive(glow)), fixture, 'shade', 'fixture_diffuser');
  shade.position.set(x, y - 0.9, z);
  group.add(cord, shade);
  return 2;
}

function addTrack(group: THREE.Group, fixture: RenderLightingFixture, glow: THREE.Color, lighting?: LightingRenderConfig): number {
  const { x, y, z } = fixture.position;
  const config = getTrackLightConfig(lighting, fixture.id, fixture.heads);
  const black = material(0x111111, 0.35, 0.75);
  const track = part(new THREE.Mesh(new THREE.BoxGeometry(config.length, 0.045, 0.08), black), fixture, 'track', 'fixture_track');
  track.position.set(x, y - CEILING_CLEARANCE, z);
  track.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
  group.add(track);
  for (const [index, resolved] of getResolvedTrackLightHeads(fixture.position, config).entries()) {
    const direction = new THREE.Vector3(resolved.direction.x, resolved.direction.y, resolved.direction.z);
    const headMetadata = {
      ...(resolved.purpose !== undefined ? { purpose: resolved.purpose } : {}),
      ...(resolved.role !== undefined ? { role: resolved.role } : {}),
    };
    const mount = part(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 12), black), fixture, `head:${index + 1}:mount`, 'fixture_metal');
    mount.userData = { ...mount.userData, ...headMetadata };
    mount.position.set(resolved.mountPosition.x, resolved.mountPosition.y - CEILING_CLEARANCE, resolved.mountPosition.z);
    const head = part(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.14, 12), black), fixture, `head:${index + 1}`, 'fixture_metal');
    head.userData = { ...head.userData, ...headMetadata };
    head.position.set(resolved.headPosition.x, resolved.headPosition.y - CEILING_CLEARANCE, resolved.headPosition.z);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    const lens = part(new THREE.Mesh(new THREE.CircleGeometry(0.038, 16), emissive(glow)), fixture, `head:${index + 1}:lens`, 'fixture_diffuser');
    lens.userData = { ...lens.userData, ...headMetadata };
    lens.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    lens.position.set(resolved.lensPosition.x, resolved.lensPosition.y - CEILING_CLEARANCE, resolved.lensPosition.z);
    group.add(mount, head, lens);
  }
  return 1 + config.heads.length * 3;
}

function addDome(group: THREE.Group, fixture: RenderLightingFixture, glow: THREE.Color): number {
  const dome = part(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), emissive(glow)), fixture, 'dome', 'fixture_diffuser');
  dome.scale.y = 0.4;
  dome.rotation.x = Math.PI;
  dome.position.copy(fixture.position);
  group.add(dome);
  return 1;
}

function addDownlight(group: THREE.Group, fixture: RenderLightingFixture, glow: THREE.Color): number {
  const { x, y, z } = fixture.position;
  const offset = fixture.recessed ? 0.04 : -CEILING_CLEARANCE - 0.04;
  const body = part(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.08, 20), material(0xd8d5ce, 0.45, 0.15)), fixture, 'body', 'fixture_metal');
  body.position.set(x, y + offset, z);
  const ring = part(new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.012, 8, 20), material(0xb4afa6, 0.4, 0.3)), fixture, 'ring', 'fixture_metal');
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, y + (fixture.recessed ? -0.002 : -CEILING_CLEARANCE - 0.082), z);
  const lens = part(new THREE.Mesh(new THREE.CircleGeometry(0.052, 20), emissive(glow)), fixture, 'lens', 'fixture_diffuser');
  lens.rotation.x = Math.PI / 2;
  lens.position.set(x, y + (fixture.recessed ? -0.006 : -CEILING_CLEARANCE - 0.083), z);
  group.add(body, ring, lens);
  return 3;
}

function addWallLamp(group: THREE.Group, fixture: RenderLightingFixture, glow: THREE.Color): number {
  const { x, y, z } = fixture.position;
  const base = part(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12), material(0x8a6d3b, 0.4, 0.7)), fixture, 'base', 'fixture_metal');
  base.rotation.z = Math.PI / 2;
  base.position.set(x, y + 0.08, z);
  const shade = part(new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), emissive(glow)), fixture, 'shade', 'fixture_diffuser');
  shade.position.set(x, y - 0.05, z);
  group.add(base, shade);
  return 2;
}

function addLedStrip(group: THREE.Group, fixture: RenderLightingFixture, glow: THREE.Color): number {
  const strip = part(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 2.4), emissive(glow)), fixture, 'strip', 'cove_light');
  strip.position.copy(fixture.position);
  group.add(strip);
  return 1;
}

function buildFixture(fixture: RenderLightingFixture, lighting?: LightingRenderConfig): { group: THREE.Group; parts: number } {
  const group = new THREE.Group();
  group.name = `electrical:${fixture.id}`;
  group.userData = {
    type: 'lighting_fixture',
    objectId: `electrical:${fixture.id}`,
    fixtureType: fixture.type,
    roomId: fixture.room,
    ...(fixture.type === 'track_light' && lighting?.fixtures.find((config) => config.id === fixture.id)
      ? { headPurposes: lighting.fixtures.find((config) => config.id === fixture.id)!.heads.map((head) => ({ purpose: head.purpose, role: head.role })) }
      : {}),
  };
  const glow = new THREE.Color().setHSL(0.1, 0.25, 0.95);
  switch (fixture.type) {
    case 'pendant': return { group, parts: addPendant(group, fixture, glow) };
    case 'track_light': return { group, parts: addTrack(group, fixture, glow, lighting) };
    case 'downlight': return { group, parts: addDownlight(group, fixture, glow) };
    case 'wall_lamp': return { group, parts: addWallLamp(group, fixture, glow) };
    case 'led_strip': return { group, parts: addLedStrip(group, fixture, glow) };
    case 'dome':
    case 'ceiling_light':
    default: return { group, parts: addDome(group, fixture, glow) };
  }
}

export function buildLightingFixtures(fixtures: RenderLightingFixture[], lighting?: LightingRenderConfig): LightingFixtureBuildResult {
  const group = new THREE.Group();
  group.name = 'LIGHTING_FIXTURES';
  const index = new Map<string, THREE.Group>();
  let parts = 0;
  for (const fixture of fixtures) {
    if (!fixture.enabled) continue;
    const built = buildFixture(fixture, lighting);
    group.add(built.group);
    index.set(String(built.group.userData.objectId), built.group);
    parts += built.parts;
  }
  return { group, fixtures: index, parts };
}

export const buildLightingFixtureGeometry = buildLightingFixtures;
