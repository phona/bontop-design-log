import * as THREE from 'three';
import type { MepCoordination, MepRoute } from '@shared/mep-hvac-coordination-schema';
import { isMepPhysicalRoute, mepRoutePoints, resolveMepEndpoint, type MepEndpointSources } from '@shared/mep-hvac-coordination-schema';
import { lintLevel, type MepLintResult } from '@shared/mep-hvac-lint';

export interface MepRenderReport {
  total: number;
  resolved: number;
  skipped: number;
  skippedRoutes: string[];
}

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
  private renderReport: MepRenderReport = { total: 0, resolved: 0, skipped: 0, skippedRoutes: [] };
  private viewOnlyRoot?: THREE.Object3D;
  private opacityMultiplier = 1;
  private readonly baseOpacity = new Map<THREE.Material, number>();
  private readonly endpointIndex = new Map<string, Set<THREE.Object3D>>();
  private readonly statusColors: Record<MepRoute['status'], number> = {
    confirmed: 0x22c55e,
    inferred: 0xf59e0b,
    pending: 0x94a3b8,
  };

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'MEP_COORDINATION';
    this.attach();
  }

  attach(viewOnlyRoot?: THREE.Object3D): void {
    const parent = viewOnlyRoot ?? this.viewOnlyRoot ?? this.scene;
    this.viewOnlyRoot = parent;
    if (this.group.parent !== parent) parent.add(this.group);
  }

  render(config: MepCoordination, sources: MepEndpointSources, lint?: MepLintResult): void {
    this.attach();
    this.clear();
    this.renderReport = { total: config.routes.length, resolved: 0, skipped: 0, skippedRoutes: [] };
    this.endpointIndex.clear();
    for (const route of config.routes) {
      const layer = config.layers[route.layer];
      const from = resolveMepEndpoint(route.from, sources);
      const to = resolveMepEndpoint(route.to, sources);
      if (!from || !to) {
        this.renderReport.skipped += 1;
        this.renderReport.skippedRoutes.push(route.id);
        console.warn(`[mep] skipped unresolved route ${route.id}`);
        continue;
      }
      this.renderReport.resolved += 1;
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
      const routeKind = route.route_kind ?? (route.source_status === 'design_requirement' ? 'requirement' : undefined);
      const visualMode = routeKind === 'requirement' ? 'requirement' : routeKind === 'candidate' ? 'candidate' : route.status;
      const visualStyle = routeKind === 'requirement' || routeKind === 'candidate'
        ? 'wireframe-dashed'
        : route.status === 'confirmed' ? 'solid' : route.status === 'inferred' ? 'dashed-marker' : 'low-opacity-dashed';
      const routeIssues = lint ? {
        errors: lint.errors.filter((item) => item.routeId === route.id),
        warnings: lint.warnings.filter((item) => item.routeId === route.id),
      } : undefined;
      group.userData = {
        type: 'mep_coordination_route', objectId: group.name, routeId: route.id,
        name: route.label ?? route.id,
        status: route.status, source_status: route.source_status, construction_status: route.construction_status,
        layer: route.layer, method: route.method,
        diameter: route.diameter, width: route.width, depth: route.depth,
        from_height: route.from_height, to_height: route.to_height,
        label: route.label, reason: route.reason, endpointMeta, points: rawPoints,
        physicalRoute: isMepPhysicalRoute(route, rawPoints), routeKind,
        lintLevel: routeIssues && lint ? lintLevel({
          errors: routeIssues.errors,
          warnings: routeIssues.warnings,
          counts: { ...lint.counts, errors: routeIssues.errors.length, warnings: routeIssues.warnings.length },
        }) : undefined,
        lintCodes: routeIssues ? [...routeIssues.errors, ...routeIssues.warnings].map((item) => item.code) : [],
        lintWarnings: routeIssues ? routeIssues.warnings.map((item) => item.message) : [],
        visualMode, visualStyle,
        warning: (route.layer === 'condensate' || route.layer === 'drainage') && route.method?.includes('gravity') ? '重力排水/冷凝水候选路线：待现场确认，非施工依据。' : undefined,
        reviewLabel: route.construction_status === 'pending' ? '待现场确认' : undefined,
      };
      for (const endpoint of [route.from, route.to]) {
        const key = endpoint.toString();
        const routes = this.endpointIndex.get(key) ?? new Set<THREE.Object3D>();
        routes.add(group);
        this.endpointIndex.set(key, routes);
      }
      const opacity = route.status === 'confirmed' ? 0.88 : route.status === 'pending' ? 0.32 : 0.58;
      const isNonPhysical = routeKind !== undefined;
      const routeColor = routeKind === 'requirement' ? 0xa78bfa : routeKind === 'candidate' ? 0x38bdf8 : this.statusColors[route.status];
      const material = new THREE.MeshBasicMaterial({
        color: routeColor || hexColor(layer.color), transparent: true,
        opacity: opacity * this.opacityMultiplier, depthWrite: !isNonPhysical,
        wireframe: routeKind !== undefined,
      });
      material.userData.mepStatus = route.status;
      material.userData.mepRouteKind = routeKind;
      material.userData.mepBaseOpacity = opacity;
      const isDuct = route.layer === 'supply_air' || route.layer === 'return_air' || route.method === 'rectangular';
      const radius = route.diameter !== undefined ? route.diameter / 2 : 0.045;
      const width = route.width ?? 0.18;
      const depth = route.depth ?? 0.12;
      const bends = new THREE.Group();
      bends.name = 'bends';
      bends.userData = {
        ...group.userData,
        type: 'mep_coordination_route',
        routePart: 'bends',
        elevations: rawPoints.map((point) => point.y),
      };
      for (let i = 1; i < points.length - 1; i += 1) {
        const markerMaterial = material.clone();
        markerMaterial.userData.mepBaseOpacity = opacity;
        const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(radius, 0.045), 8, 8), markerMaterial);
        marker.position.copy(points[i]);
        marker.userData = { ...group.userData, type: 'mep_route_bend', bendIndex: i };
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
      if (visualStyle !== 'solid') {
        const overlayMaterial = new THREE.LineDashedMaterial({
          color: routeColor || hexColor(layer.color), transparent: true,
          opacity: opacity * this.opacityMultiplier,
          dashSize: routeKind !== undefined ? 0.16 : 0.22,
          gapSize: routeKind !== undefined ? 0.1 : 0.14,
          depthTest: false,
        });
        overlayMaterial.userData.mepStatus = route.status;
        overlayMaterial.userData.mepRouteKind = routeKind;
        overlayMaterial.userData.mepBaseOpacity = opacity;
        const overlayGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const overlay = new THREE.Line(overlayGeometry, overlayMaterial);
        overlay.name = 'visual-line-overlay';
        overlay.userData = {
          type: 'mep_route_visual_overlay', routeId: route.id, status: route.status,
          routeKind, visualStyle, interactive: false,
        };
        overlay.raycast = () => undefined;
        overlay.computeLineDistances();
        group.add(overlay);
      }
      group.add(bends);
      this.group.add(group);
      this.routeGroups.set(route.id, group);
      this.bendGroups.set(route.id, bends);
    }
  }

  getRenderReport(): MepRenderReport { return { ...this.renderReport, skippedRoutes: [...this.renderReport.skippedRoutes] }; }

  setVisible(visible: boolean): void { this.group.visible = visible; }

  setOpacityMultiplier(multiplier: number): void {
    this.opacityMultiplier = Math.max(0, Math.min(1, multiplier));
    this.group.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      for (const item of Array.isArray(material) ? material : [material]) {
        if (!item) continue;
        const base = typeof item.userData?.mepBaseOpacity === 'number' ? item.userData.mepBaseOpacity : item.opacity;
        item.userData.mepBaseOpacity = base;
        item.transparent = true;
        item.opacity = base * this.opacityMultiplier;
        item.needsUpdate = true;
      }
    });
  }

  getOpacityMultiplier(): number { return this.opacityMultiplier; }

  setOpacity(opacity: number): void { this.setOpacityMultiplier(opacity); }

  getRouteObject(routeId: string): THREE.Object3D | undefined { return this.routeGroups.get(routeId); }

  getEndpointRoute(endpointRef: string): THREE.Object3D | undefined { return this.endpointIndex.get(endpointRef)?.values().next().value; }

  getRouteStatusSummary(): Record<MepRoute['status'] | 'requirement', number> {
    const summary: Record<MepRoute['status'] | 'requirement', number> = { confirmed: 0, inferred: 0, pending: 0, requirement: 0 };
    for (const route of this.routeGroups.values()) {
      if (route.userData.routeKind === 'requirement' || route.userData.routeKind === 'candidate' || route.userData.source_status === 'design_requirement') summary.requirement += 1;
      else if (route.userData.status in summary) summary[route.userData.status as MepRoute['status']] += 1;
    }
    return summary;
  }

  highlightRoute(routeId: string, durationMs = 1400): void {
    const route = this.routeGroups.get(routeId);
    if (!route) return;
    const materials: THREE.Material[] = [];
    route.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      for (const item of Array.isArray(material) ? material : [material]) if (item) materials.push(item);
    });
    const originals = materials.map((material) => ({ material, color: (material as THREE.MeshBasicMaterial).color?.clone(), opacity: material.opacity }));
    for (const material of materials) {
      const color = (material as THREE.MeshBasicMaterial).color;
      color?.set(0xffffff);
      material.opacity = Math.min(1, Math.max(material.opacity, 0.9));
      material.transparent = true;
      material.needsUpdate = true;
    }
    setTimeout(() => {
      for (const original of originals) {
        if (original.color) (original.material as THREE.MeshBasicMaterial).color.copy(original.color);
        original.material.opacity = original.opacity;
        original.material.needsUpdate = true;
      }
    }, durationMs);
  }

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
