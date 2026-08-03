# Open Node Studio User Guide

This guide describes the reference graph studio included with Open Node. The same project model can also be embedded in another product or used headlessly.

## 1. Create a graph

1. Press left `Alt`, or double-click an empty Canvas area, to open the Library at the pointer.
2. Drag a Node or Container to the Canvas. Double-clicking a Library item creates it at the current viewport center.
3. Drag from an output port to a compatible input port.
4. Edit inline parameters or click the entity to open Inspector.
5. Press `Enter` or click **Run**.

The eleven round buttons above the Library create annotations and toggle visual layers, including the Canvas grid. The Library has three normal views:

- **Recently** contains the most recently created Node types and Container presets;
- **Nodes** contains every registered Node definition;
- **Containers** contains an empty Container and saved Container presets.

Typing in Search temporarily combines Nodes and Containers into one result grid.

## 2. Navigate the Canvas

- Mouse wheel: zoom under the pointer.
- Middle-button drag or `Space + left drag`: pan.
- Double-tap `Space`: return to world origin.
- **Fit**: frame the complete graph.
- **Origin**: keep the current zoom and center world coordinate `0, 0`.

Settings control the solid/gradient background, hierarchical grid, grid color and grid step. When **Snap to grid** is enabled, Nodes, Containers and Groups snap while being created, moved, resized, pasted or edited through Transform fields. Annotations intentionally remain freeform.

## 3. Select and edit

Click-drag on empty Canvas space to marquee-select. Hold `Shift` while clicking entities to add or remove them from the selection. Drag any selected top-level entity to move the entire selection.

The following commands work for one entity or a multi-selection:

| Action | Shortcut |
|---|---|
| Copy | `Ctrl/Cmd + C` |
| Cut | `Ctrl/Cmd + X` |
| Paste at pointer | `Ctrl/Cmd + V` |
| Duplicate | `Ctrl/Cmd + D` |
| Delete and remove attached connections | `Backspace` or `Delete` |
| Toggle bypass | `B` |
| Undo / Redo | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` |

Copy, cut, duplicate and paste retain connections whose source and target are both inside the copied selection. Connections to entities outside that selection are not copied.

Hold left `Alt` while dragging an entity or selection to drag a duplicate.

## 4. Inspector

Click an entity to open Inspector. Clicking another entity replaces Inspector content without closing the panel. Clicking the currently inspected entity again closes Inspector. Clicking outside the panel and Canvas entities also closes it.

Inspector edits names, colors, bypass/collapse state, parameters, ports, Container order, transform and runtime hints. Inline controls on Nodes and text annotations remain editable directly on the Canvas.

## 5. Nodes

Nodes are executable graph operations. Their colors identify their type and are reused by ports, selection glow and connection gradients. A Node can expose typed data ports, control ports, inline parameters, previews and runtime status.

Universal Import has one dynamic output. Importing a file changes that output type to match the detected asset.

## 6. Containers

Containers execute compatible Nodes in visible top-to-bottom order. Drag a compatible Canvas Node over a highlighted insertion slot to add it; existing external connections to that Node are removed at the Container boundary. Drag a contained Node to another slot, another Container, or the Canvas.

Right-click a Container to save it as a reusable preset. Saved presets appear in the Containers Library tab.

## 7. Groups

Hold left `Alt` and drag an empty Canvas area to create a Group. Nodes and Containers geometrically contained by the Group become members. A Group moves its current members, including entities added later. Groups can be renamed and resized directly on the Canvas.

## 8. Connections

Drag from an output port to a compatible input port. When the input accepts only one connection, a new valid connection replaces the previous one.

Right-click a connection to select:

- the project-default or a per-connection route: Bezier, Smooth step, Orthogonal or Straight;
- Line, Vector or Bidirectional arrowheads.

Drag a selected connection endpoint away to disconnect and delete the connection.

## 9. Annotations

The Library toolbar creates arrows, curves/brush strokes, text, rectangles, ellipses and diamonds. Annotation geometry does not snap to the graph grid. For rectangles, ellipses and diamonds, **Opacity** affects only the fill; the outline remains fully opaque and is controlled independently by its color and stroke width. Annotation layers render above graph entities.

Double-click text to edit it in place. Selected arrows and curves expose editable endpoints; rotatable annotations expose a rotation control.

## 10. Execution and Timeline

- **Manual** runs on demand.
- **Reactive** responds to graph changes.
- **Continuous** supports streaming Nodes and bounded queues.
- **Timeline** provides shared time and frame context.

If entities are selected, Run uses the selected execution scope; otherwise it runs the whole graph. Stop cancels the active session.

The Timeline supports play, pause, stop, one-frame backward/forward stepping, FPS, loop and playback rate.

## 11. Projects and persistence

Up to four projects can be open at once. The project menu beside the project name provides Save, Load, Settings and Documentation.

The canonical `.onode.json` file stores:

- every Node instance, including type/version, parameters, instantiated ports, size/position, color, bypass, UI state, runtime hints and unresolved raw state;
- Containers, ordered membership, Groups, annotations, connections with routing/arrow/style overrides and presets;
- project metadata and dependencies;
- complete execution and Timeline settings, including the current Timeline time;
- viewport and Canvas background;
- grid visibility, hierarchy, step, color, opacity and snapping;
- panel and layer visibility toggles;
- Library position, size and recent items;
- asset references.

Save always exports the current project snapshot. JSON and packaged ZIP exports use the same canonical schema and reject non-JSON third-party state instead of silently dropping or transforming it.

Loading a file or dropping a valid pipeline into the studio opens it in a new project tab. Dropping a JSON file specifically onto Universal Import treats it as an imported asset instead.

Closing a project tab offers Save & Close. Closing the browser tab triggers the browser's unsaved-work warning.

Selection, clipboard contents, open context menus, Inspector visibility and the set of currently open project tabs are interaction/session state and are intentionally not stored. Each open project is saved independently.

## 12. Visibility and diagnostics

The Library toolbar can hide connections, ports, Groups and annotations without deleting them. Minimap follows the main viewport. Resources reports browser-provided live metrics and explicitly marks restricted values when the browser does not expose them.
