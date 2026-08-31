---
name: scene-archetypes
description: Reusable fact, datum, object, functional-review, aesthetic-review, and failure guidance for common interior-design scenes.
---

# Scene Archetypes

A scene may use multiple archetypes. These are review dimensions, not fixed object counts. Every choice returns to facts, alignment, and the frozen brief.

## `free_furniture`

- **Facts:** room edges, measured outer dimensions, doors/windows, opening and sitting/sleeping clearances, moving route, outlets, user habits, placed versus count-only status.
- **Datum:** `free_position` or `room_anchor`; plan placement/rotation, elevation height, section clearances.
- **Split:** body, movable parts, upholstery/accessories, fixings, and attached appliances by owner/maintenance; keep placed instances separate from inventory counts.
- **Functional review:** circulation, opening, collision, ergonomics, outlet relation, delivery/maintenance.
- **Aesthetic review:** proportion, sightline, hierarchy, negative space, material and composition.
- **Common failures:** guessed x/z/rotation; count treated as placed; blocked door/window/outlet; technically valid but visually poor placement.

## `wall_feature`

- **Facts:** wall material/structure/drillability, wall side, curtain/suppressed status, existing fixing points, services and inspection access.
- **Datum:** `wall_anchor`; explicit wall segment, wall_side, along-wall distance, install height, thickness, and section offsets.
- **Split:** low cabinet, PVC/backboard, floating panel, hanging item/device, cable route, and inspection access.
- **Functional review:** fixing/weight, collision, cable path, access, doors/windows/outlets, wall legality.
- **Aesthetic review:** vertical stacking, gaps, support logic, floating effect, transitions, scale and sightline.
- **Common failures:** hanging on glass curtain/suppressed wall; along confused with height; low cabinet/PVC/floating board relation wrong; legacy type semantics leak.

## `kitchen`

- **Facts:** cabinet/appliance dimensions, work triangle, water/drain, power, exhaust, counter, service access, delivery route.
- **Datum:** combine room/wall anchors and `service_route`; plan work zones, elevation counter/upper cabinet, section pipes/clearance.
- **Split:** carcass, doors/drawers, counter, appliances, plinth, pipes, exhaust, inspection panels.
- **Functional review:** door/drawer sweep, work clearance, heat/water/exhaust interfaces, maintenance, delivery.
- **Aesthetic review:** cabinet rhythm, appliance integration, end panels, materials, sightline and visual order.
- **Common failures:** appliance hidden inside an un-auditable cabinet object; net/overall confusion; ignored exhaust or service access.

## `bathroom`

- **Facts:** wet/dry boundary, waterproofing, measured fixtures, drain/slope, door sweep, glass, inspection, safety.
- **Datum:** room/wall anchor plus `service_route`; plan wet zone/sweep, elevation fixtures/accessories, section waterproofing/slope/clearance.
- **Split:** sanitaryware, screen, door, vanity, hardware, waterproofing/trim, drain and inspection.
- **Functional review:** wet/dry separation, door sweep, fixture clearances, slip/splash safety, drainage and access.
- **Aesthetic review:** proportion, grout/seam continuity, material transitions, sightline and light.
- **Common failures:** wall/glass responsibility unclear; plan-only review; attractive render masking clearance or waterproofing failure.

## `ceiling_hvac`

- **Facts:** slab/beams, ceiling levels, supply/return, access panels, routes, obstruction, noise and equipment clearance.
- **Datum:** `ceiling_anchor` or `service_route`; separate plan layout, elevation level, section height and service clearance.
- **Split:** ceiling plane, trim, supply, return, access panel, light, equipment, and route.
- **Functional review:** airflow, inspection, headroom, obstruction, collision, noise, sequence and access.
- **Aesthetic review:** ceiling proportion, rhythm, symmetry, vents/lights relation, shadow and cohesion.
- **Common failures:** furniture/HVAC mixed; along treated as height; vent blocked; scripts pass but scene is ugly.

## `lighting`

- **Facts:** circuit, power, fixture, CCT/lux goal, controls, glare, shadow, maintenance and fire/inspection constraints.
- **Datum:** ceiling/wall/free anchor or `service_route`; plan coverage, elevation mounting, section glare/clearance.
- **Split:** fixture, source, circuit, control, cove/baffle and material reflection.
- **Functional review:** electrical interface, coverage, control, glare, maintenance, fire/inspection.
- **Aesthetic review:** layers, focal light, CCT, shadow, material rendering and night composition.
- **Common failures:** render brightness substituted for function; guessed fixture point; circuit and object inseparable.

## `door_circulation`

- **Facts:** clear opening, leaf size, swing direction, route, carrying path, fire/accessibility, threshold and sightline.
- **Datum:** room/wall anchor; plan sweep/route, elevation frame, section threshold/head clearance.
- **Split:** opening geometry, leaf, frame, hardware, wall, buffer/trim.
- **Functional review:** passage, swing, collision, carrying, safety and accessibility.
- **Aesthetic review:** opening proportion, casing, axes, continuity and arrival sequence.
- **Common failures:** only closed state checked; sweep confused with trim; camera/axis direction wrong.

## `materials`

- **Facts:** substrate, thickness, edge/trim, grain direction, batch/color variation, wet-zone/durability, cleaning and replacement.
- **Datum:** bind surface/room/zone; declare plan/elevation/section grain direction and seam logic.
- **Split:** substrate, finish, edge, joint, corners, replaceable panel by construction and maintenance responsibility.
- **Functional review:** thickness, durability, waterproof/fire requirements, cleaning, replacement, interfaces.
- **Aesthetic review:** color, grain, seams, reflection, layering and consistency.
- **Common failures:** material exists only in render; grain direction wrong; missing trim; beauty disconnected from construction.

## Cross-archetype rules

- Type names are not facts; confirm wall, coordinates, dimensions, and responsibility from authority data.
- Every object has owner, datum, dependencies, interfaces, maintenance, collision policy, and validation refs.
- Plan, elevation, and section evidence are not interchangeable.
- Independent objects need a shared visual relationship; independence is not permission to scatter them.
- Configuration, geometry, function, aesthetics, construction, runtime, and evidence are separate gates.
