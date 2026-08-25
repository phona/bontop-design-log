import * as THREE from 'three';
import type { MepCoordination, MepRoute } from '@shared/mep-hvac-coordination-schema';
import { resolveMepEndpoint, type MepEndpointSources } from '@shared/mep-hvac-coordination-schema';

function hexColor(value: string): number { return Number.parseInt(value.replace(/^#/, ''), 16); }

function heightOf(point: { y?: number }, fallback: number, override?: number): number {
  return override ?? point.y ?? fallback;
}

function orientSegment(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length <= 0) return;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

export class MepCoordinationRenderer {
  readonly group = new THREE.Group();
  private readonly routeGroups = new Map<string, THREE.Group>();
  private readonly bendGroups = new Map<string, THREE.Group>();

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'MEP_COORDINATION';
    this.scene.add(this.group);
  }

  render(config: MepCoordination, sources: MepEndpointSources): void {
    this.clear();
    for (const route of config.routes) {
      const layer = config.layers[route.layer];
      const from = resolveMepEndpoint(route.from, sources);
      const to = resolveMepEndpoint(route.to, sources);
      if (!from || !to) {
        console.warn(`[mep] skipped unresolved route ${route.id}`);
        continue;
      }
      const fromPoint: Extract<MepRoute['from'], object> | undefined = typeof route.from === 'object' ? route.from : undefined;
      const toPoint: Extract<MepRoute['to'], object> | undefined = typeof route.to === 'object' ? route.to : undefined;
      const rawPoints = [
        { ...from, y: heightOf(fromPoint ?? {}, layer.height, route.from_height) },
        ...route.via,
        { ...to, y: heightOf(toPoint ?? {}, layer.height, route.to_height) },
      ];
      const points = rawPoints.map((point) => new THREE.Vector3(point.x, point.y ?? layer.height, point.z));
      const group = new THREE.Group();
      group.name = `mep:route:${route.id}`;
      const endpointMeta = {
        from: { ref: route.from, source_status: fromPoint?.source_status, construction_status: fromPoint?.construction_status },
        to: { ref: route.to, source_status: toPoint?.source_status, construction_status: toPoint?.construction_status },
      };
      group.userData = {
        type: 'mep_coordination_route', objectId: group.name, routeId: route.id,
        status: route.status, source_status: route.source_status, construction_status: route.construction_status,
        layer: route.layer, method: route.method,
        diameter: route.diameter, width: route.width, depth: route.depth,
        from_height: route.from_height, to_height: route.to_height,
        label: route.label, reason: route.reason, endpointMeta, points: rawPoints,
        reviewLabel: route.construction_status === 'pending' ? '待现场确认' : undefined,
      };
      const opacity = route.status === 'confirmed' ? 0.88 : route.status === 'pending' ? 0.32 : 0.58;
      const material = new THREE.MeshBasicMaterial({ color: hexColor(layer.color), transparent: true, opacity });
      const isDuct = route.layer === 'supply_air' || route.layer === 'return_air' || route.method === 'rectangular';
      const radius = route.diameter ?? 0.045;
      const width = route.width ?? 0.18;
      const depth = route.depth ?? 0.12;
      const bends = new THREE.Group();
      bends.name = 'bends';
      bends.userData = {
        type: 'mep_route_bends', label: route.label, source_status: route.source_status,
        construction_status: route.construction_status, reviewLabel: group.userData.reviewLabel,
        elevations: rawPoints.map((point) => point.y),
      };
      for (let i = 1; i < points.length - 1; i += 1) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(radius, 0.045), 8, 8), material.clone());
        marker.position.copy(points[i]);
        bends.add(marker);
      }
      for (let i = 0; i < points.length - 1; i += 1) {
        const start = points[i];
        const end = points[i + 1];
        const segmentLength = start.distanceTo(end);
        if (segmentLength <= 0) continue;
        const geometry = isDuct
          ? new THREE.BoxGeometry(width, segmentLength, depth)
          : new THREE.CylinderGeometry(radius, radius, segmentLength, 10);
        const segment = new THREE.Mesh(geometry, material.clone());
        segment.userData = { ...group.userData, segmentIndex: i, start: rawPoints[i], end: rawPoints[i + 1] };
        orientSegment(segment, start, end);
        group.add(segment);
      }
      group.add(bends);
      this.group.add(group);
      this.routeGroups.set(route.id, group);
      this.bendGroups.set(route.id, bends);
    }
  }

  setVisible(visible: boolean): void { this.group.visible = visible; }

  setLayerVisible(layer: MepRoute['layer'], visible: boolean): void {
    for (const route of this.routeGroups.values()) if (route.userData.layer === layer) route.visible = visible;
  }

  setBendsVisible(visible: boolean): void {
    for (const bends of this.bendGroups.values()) bends.visible = visible;
  }

  clear(): void {
    while (this.group.children.length) {
      const child = this.group.remove(this.group.children[0]);
      child.traverse((object) => {
        const renderable = object as THREE.Mesh;
        renderable.geometry?.dispose();
        if (Array.isArray(renderable.material)) renderable.material.forEach((item) => item.dispose());
        else (renderable.material as THREE.Material | undefined)?.dispose();
      });
    }
    this.routeGroups.clear();
    this.bendGroups.clear();
  }

  dispose(): void {
    this.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
