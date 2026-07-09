# Design: Object-First Interaction Model for 3D Interior Design

## 1. Background

The current 3D interior-design app treats the **room** as the first-class interactive object. In both orbit and first-person modes, the user clicks an invisible floor plane or a room wall to open an info panel, and then applies material/HVAC decisions to that room. This model has two problems:

1. **It is not a natural interaction pattern.** Rooms are not concrete objects in a 3D space — blocks, surfaces, fixtures, and systems are. Users do not expect to click a "room" to edit it; they expect to select a material or object and then apply it to a surface or place it in a location.
2. **It overloads the 3D scene with editing responsibility.** The 3D view should primarily be a spatial preview and a targeting tool, not a complex decision panel.

We want to align the interaction model with simpler, more familiar patterns such as Minecraft's "select item, then apply to target" model, while keeping the scope appropriate for interior design rather than voxel building.

## 2. Goal

Make the 3D interaction model **object-first** instead of **room-first**. The user selects a design element (material, fixture, system) from a panel or toolbar, and then applies it to a concrete target in the 3D scene: a surface, a room area, or a placement point. Rooms remain visible and labeled, but they are containers and targets, not primary editable objects.

## 3. Scope

### In scope

- Redefine first-class interactive objects in the 3D scene: surfaces, fixtures, systems, and placement points.
- Remove the room floor plane as a clickable object.
- Keep walls, floors, ceilings, doors, windows, HVAC units, and future fixtures as visible and potentially targetable surfaces/objects.
- Reframe the existing topics (floor, wall, paint, HVAC) as "select topic option, then apply to target" actions.
- Update the hover tooltip and info panel to show information about the clicked target, not to initiate room-level editing.
- Update the design-rules object mapping to reflect object-first targets.
- Update tests and documentation.

### Out of scope

- Voxel/block-based editing (we are not turning the house into Minecraft blocks).
- Full drag-and-drop furniture placement in this iteration.
- Advanced surface editing (painting individual wall patches, multi-tile patterns).
- Changing the budget calculation or rule engine.
- Changing the CAD-driven layout pipeline itself; the pipeline still feeds room geometry, but the CAD label convention can be relaxed to use Chinese names instead of `[project-id]`.

## 4. Design

### 4.1 Core principle: select → apply

The interaction follows a two-step pattern inspired by Minecraft's hotbar model:

1. **Select**: The user chooses a design element from a palette or panel. Examples:
   - "地砖 A" from the floor topic
   - "乳胶漆 B" from the paint topic
   - "一拖五 HVAC 方案" from the HVAC topic
2. **Apply**: The user chooses a target in the 3D scene or in a side panel. Examples:
   - Apply floor tile to "主卧" (by clicking the floor of the room)
   - Apply wall paint to "全屋墙面" (from a panel)
   - Apply HVAC scheme to the whole house (from a panel)

The 3D scene is the **targeting and preview layer**, not the **decision layer**.

### 4.2 First-class objects in the 3D scene

The following objects can be hovered, highlighted, and clicked. Their user data should carry an `objectId`, `type`, and optional `roomId` for context.

| Object | type | roomId | Example objectId | Click behavior |
|--------|------|--------|------------------|----------------|
| Room floor | `floor` | room id | `floor:master_bedroom` | Highlight floor; show room context |
| Wall segment | `wall` | room id | `wall:master_bedroom:north` | Highlight wall; show wall context |
| Ceiling | `ceiling` | room id | `ceiling:master_bedroom` | Highlight ceiling |
| Door | `door` | room id | `door:entry` | Show door info |
| Window | `window` | room id | `window:master_bedroom:south` | Show window info |
| HVAC indoor unit | `hvac_indoor` | room id | `hvac:indoor:living_dining` | Show HVAC info |
| HVAC outdoor unit | `hvac_outdoor` | platform | `hvac:outdoor:west_platform` | Show HVAC info |
| Platform | `platform` | west_platform | `platform_boundary` | Show platform info |

**Rooms themselves are not clickable.** A room label is a visual aid, not an object.

### 4.3 Room as container and label

A room is a logical container with a boundary, but it is not a 3D object. Its roles are:

- Provide a boundary for surface highlighting.
- Provide a human-readable name (e.g., "主卧") via a 3D label.
- Be a valid target in the side panel (e.g., "apply to 主卧").
- Carry metadata such as area, orientation, and furniture concept.

When the user clicks a floor surface, the app knows which room it belongs to and can display the room name, but the room itself is not the clicked object.

### 4.4 Decision flow

```text
User selects option from panel/toolbar
        ↓
  Option has a default scope (global / room / surface)
        ↓
  User can override scope by clicking a 3D target
        ↓
  App updates the scheme and re-renders the scene
```

Examples:

- **Floor topic**: user selects "地砖 A". Default scope is "whole house". If the user clicks a floor in the master bedroom, the scope becomes "master_bedroom only".
- **Wall topic**: user selects "墙砖 B". Default scope is "all wet walls". If the user clicks a kitchen wall, the scope becomes "kitchen walls".
- **Paint topic**: user selects "乳胶漆 C". Default scope is "all painted walls". User can click a wall to apply to that room only.
- **HVAC topic**: user selects a scheme. Default scope is "whole house". The system places units automatically per room; user can override per room by clicking a unit or from the panel.

### 4.5 Hover and info panel

- **Hover tooltip**: shows the target name and type (e.g., "主卧地面", "北墙", "西平台外机").
- **Info panel**: shows the selected object/room context and the relevant topics, but the primary action is not "edit this room". Instead, it shows what is currently selected and lets the user choose options from the panel.
- **No invisible room floor plane**: the floor is a visible mesh with `type: 'floor'` and `objectId: 'floor:<room_id>'`. It is a surface, not a room abstraction.

### 4.6 Object mapping update

The `config/design-rules.yaml` object mapping should be updated to target object types, not room IDs.

```yaml
objectMapping:
  - pattern: "floor:*"
    topics: [floor]
  - pattern: "wall:*"
    topics: [wall, paint]
  - pattern: "ceiling:*"
    topics: [paint]
  - pattern: "hvac:*"
    topics: [hvac]
  - pattern: "platform_boundary"
    topics: [hvac]
```

### 4.7 CAD implications

The CAD-driven layout pipeline still needs to identify rooms because surfaces must be associated with room metadata. However, the labeling convention can be relaxed:

- The parser can map Chinese room names (`主卧`, `次卧`) to project IDs (`master_bedroom`, `bedroom_nw`) without requiring the designer to add `[project-id]` to the CAD labels.
- Ambiguous Chinese names (e.g., two `次卧`) can be disambiguated by area or position.
- Rooms that are not labeled in the CAD (e.g., `入户花园`, `南向大阳台`) can be supplied manually or detected from geometry in a future iteration.

This removes the friction that required the designer to change CAD conventions.

## 5. Behavior

After the change:

- The user clicks a floor and sees "主卧地面" in the hover tooltip.
- The info panel shows floor/paint topics for that room, but the user applies choices from the panel, not from the 3D click itself.
- The user clicks a wall and sees "主卧北墙" in the hover tooltip.
- The user clicks an HVAC unit and sees "客餐厅空调内机" in the hover tooltip.
- Rooms are still visible as labeled areas, but clicking a room label does nothing.
- The first-person crosshair only shows meaningful targets (walls, floors, fixtures, systems), not invisible room planes.

## 6. Verification

1. Run `npm run typecheck` and confirm no errors.
2. Run `npm run test:server` and `cd app && npm run test` and confirm all tests pass.
3. Start the app and verify that clicking a floor shows a floor tooltip, not a room tooltip.
4. Verify that the info panel still shows the correct topics for the clicked surface/object.
5. Verify that HVAC units, walls, and platform remain clickable.
6. Update and run any new tests that assert the object-first mapping.

## 7. Non-Goals

- No voxel/block-based editing.
- No drag-and-drop furniture placement in this iteration.
- No per-tile or per-patch material editing.
- No changes to the budget calculation or rule engine.
- No removal of the CAD-driven layout pipeline; the pipeline is preserved but the label convention is relaxed.
