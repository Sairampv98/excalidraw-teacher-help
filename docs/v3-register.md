# Version 3 feature register

This register describes usable entry points. Assistant tool names below are proposals for the assistant task, not tools implemented here.

## v3b-0-flow-panel

| Word or control | Row | File | Clip idea | Proposed assistant tool |
| --- | --- | --- | --- | --- |
| Look tab: layout, selection, shape, fit and colours | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Select one node and change the chart look | set_flow_look |
| Animation tab: nodes, arrows, speed, step and loop | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Combine a node highlight with arrow tokens | set_flow_animation |
| Script tab: preset, script, validation, Apply and examples | D-535 | packages/excalidraw/components/FlowScriptEditor.tsx | Correct a script line and apply once | edit_flow_chart |
| Present in class tab: show in class and preview class loop | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Compare editor preview with class visibility | set_flow_class_visibility |
| Save as preset tab | D-535 | packages/excalidraw/components/flowPanel/FlowPresetSave.tsx | Name a script template and find it in Flow | save_flow_preset |
| Camera tab: Fly the view to each step | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Switch between a still view and flying steps | set_flow_camera |
| Export tab: GIF, WebP, MP4, options, progress and Stop | D-535 | packages/excalidraw/components/FlowExportPanel.tsx | Export an animation and cancel another | export_animation |
| This chart dropdown | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Locate the chart target before changing options | select_flow_target |
| Add a chart to a combo: single-chart explanation | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Show what the plus means before combos are available | describe_flow_combo |
| Four-dot grip: move, edge dock, arrow-key movement, double-click follow | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Put the panel beside the chart using mouse and keyboard | place_flow_panel |
| Close into pill; Enter or Space to reopen | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Collapse during a lesson and reopen without stopping | collapse_flow_panel |
| Last tab and panel place remembered locally | D-535 | packages/excalidraw/components/flowPanel/FlowPanelTabs.tsx | Reopen and continue from the previous tab | select_flow_tab |
| More animation options | D-537 | packages/excalidraw/components/flowPanel/FlowAnimationOptions.tsx | Change a draft while the board stays unchanged | preview_flow_animation |
| Nodes and Arrow expanded sub-tabs | D-537 | packages/excalidraw/components/flowPanel/FlowAnimationOptions.tsx | Compare colours, timing and mark styles in the preview | preview_flow_animation |
| Meta node, Connect / remove arrows and Background information | D-537 | packages/excalidraw/components/flowPanel/FlowAnimationOptions.tsx | Inspect the chart's parts, connections and current background | describe_flow_chart |
| Apply once; undo and redo the option draft | D-537 | packages/excalidraw/components/flowPanel/FlowAnimationOptions.tsx | Apply several changes, then undo once | apply_flow_options |
| Close or Escape discards the option draft and restores focus | D-537 | packages/excalidraw/components/flowPanel/FlowExpandedWindow.tsx | Try an animation, cancel, and continue by keyboard | discard_flow_options |
| Shared chart preview with its own camera and animation loop | D-537 | packages/excalidraw/components/flowPanel/FlowChartPreview.tsx | Preview a large chart without moving the board | preview_flow_chart |
| Script and Save as preset tabs keep the panel on its chart after Apply | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Apply a long script and keep editing the same chart | pin_flow_panel |
| Generic expanded window with data-driven sub-tabs | D-537 | packages/excalidraw/components/flowPanel/FlowExpandedWindow.tsx | Reuse the same window for the next option engine | open_flow_options |

The executable old-control inventory is in `excalidraw-app/tests/flowPanelTabs.test.tsx`; the existing bar, pill, script, appearance, preset and exporter suites retain the detailed behaviour checks. Combo operations, new meta nodes, connect/remove editing, chart backgrounds, composed camera, new animation engines, Mermaid and PowerPoint remain the tasks named by their SPEC rows.
