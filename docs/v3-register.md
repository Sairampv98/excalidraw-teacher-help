# Version 3 feature register

This register describes usable entry points. Assistant tool names below are proposals for the assistant task, not tools implemented here.

## v3b-1-flow-arrows

| Word or control | Row | File | Clip idea | Proposed assistant tool |
| --- | --- | --- | --- | --- |
| `@elbow` (one native elbow) | D-482, D-483 | packages/excalidraw/scene/flowPresets.ts | Move the end node and watch its elbow follow | set_flow_route |
| `@curve` (smooth turn) | D-482, D-484 | packages/element/src/binding.ts | Follow a token through a curve | set_flow_route |
| `@straight` and no route word | D-482 | packages/excalidraw/scene/flowScript.ts | Compare a straight connection with a step | set_flow_route |
| Up to four route words in travel order; a fifth reports its line | D-482 | packages/element/src/binding.ts | Mix sharp corners and smooth turns, then correct an overlong route | set_flow_route |
| `:left` | D-482 | packages/element/src/binding.ts | Route to the left as you travel | set_flow_route |
| `:right` | D-482 | packages/element/src/binding.ts | Compare the other side of an arrow | set_flow_route |
| `:in` | D-482 | packages/element/src/binding.ts | Bring a bend toward the chart centre | set_flow_route |
| `:out` | D-482 | packages/element/src/binding.ts | Take a bend away from the chart centre | set_flow_route |
| `@fork-N` and comma-separated branches | D-499 | packages/excalidraw/scene/flowScript.ts | Make two, three and eight drops on a shared bar | make_flow_fork |
| Reverse fork `B, C -> A @fork-3` | D-499 | packages/excalidraw/scene/flowPresets.ts | Join branches into one node and leave one loose | make_flow_fork |
| Loose fork endpoints | D-499 | packages/excalidraw/scene/flowPresets.ts | Drag an empty drop onto a node | connect_flow_nodes |
| Fork in the native arrow properties and arrow tool | D-499 | packages/excalidraw/actions/actionProperties.tsx | Press 5, choose Fork, draw, undo once | make_flow_fork |
| Fork branches number box | D-499 | packages/excalidraw/actions/actionProperties.tsx | Add a drop and remove it again | set_flow_fork_count |
| Make fork on arrows with one source | D-499 | packages/excalidraw/scene/flowPresets.ts | Combine existing arrows without losing their bindings | make_flow_fork |
| Marching beams | D-485 | packages/excalidraw/scene/flowStyles.ts | Send repeated beams through all the bends | set_flow_animation |
| Marching tokens | D-485 | packages/excalidraw/scene/flowStyles.ts | Repeat the stepped token on every arrow | set_flow_animation |
| Marching marks alongside the step | D-485 | packages/excalidraw/components/flowPanel/FlowAnimationOptions.tsx | Combine a stepped token with marching beams | set_flow_animation |
| Marching spacing (default 150 scene units) | D-485 | packages/excalidraw/components/flowPanel/FlowAnimationOptions.tsx | Spread repeated marks apart in the preview | set_flow_animation |
| Show in class (class view and presenter only) and Preview class loop (editor) | D-486 | packages/excalidraw/components/FlowClassOverlay.tsx | Mark a chart, then tick Preview class loop to see what the class sees | set_flow_class_visibility |
| Mark spacing box in the Animation tab (dash gap, beam and token spacing) | D-485 | packages/excalidraw/components/FlowAnimationBar.tsx | Widen the gaps and watch the dashes spread | set_flow_animation |
| Gap between dashes (expanded Arrow window) | D-485 | packages/excalidraw/components/flowPanel/FlowAnimationOptions.tsx | Tighten the dashes | set_flow_animation |
| A node colour or glow with node animation none lights every node all the time | D-501 | packages/excalidraw/components/FlowAnimationOverlay.tsx | Colour a chart with no animation | set_flow_look |
| `@fill:#ffe3e3` | D-501 | packages/excalidraw/scene/flowScript.ts | Colour one node from the script | set_flow_look |
| `@outline:#862e9c` | D-501 | packages/excalidraw/scene/flowScript.ts | Colour one node or arrow outline | set_flow_look |
| `@glow` | D-501 | packages/excalidraw/components/FlowAnimationOverlay.tsx | Give a node or arrow marks their own glow | set_flow_look |
| `@style:marching-beam` (arrow) | D-501 | packages/excalidraw/components/FlowAnimationOverlay.tsx | Animate different arrows in different styles | set_flow_animation |
| `@style:focus` (node) | D-501 | packages/excalidraw/scene/flowScript.ts | Give one node its own focus highlight | set_flow_animation |
| `@style:pulse` (node) | D-501 | packages/excalidraw/scene/flowScript.ts | Pulse a chosen node | set_flow_animation |
| `@style:none` (node or arrow) | D-501 | packages/excalidraw/scene/flowScript.ts | Turn off a chosen part's animation | set_flow_animation |
| `@style:beam` (arrow) | D-501 | packages/excalidraw/scene/flowScript.ts | Send a single beam from a chosen source | set_flow_animation |
| `@style:token` (arrow) | D-501 | packages/excalidraw/scene/flowScript.ts | Send the stepped ball along one connection | set_flow_animation |
| `@style:marching` (arrow; alias marching-dashes) | D-501 | packages/excalidraw/scene/flowScript.ts | Give one arrow the existing dashes | set_flow_animation |
| `@style:marching-token` (arrow; alias marching-tokens) | D-501 | packages/excalidraw/scene/flowScript.ts | Give one arrow repeated balls | set_flow_animation |
| `@style:pipe` (arrow) | D-501 | packages/excalidraw/scene/flowScript.ts | Choose the existing pipe for one arrow | set_flow_animation |
| `animation:` | D-501 | packages/excalidraw/scene/flowScript.ts | Start a chart with marching-tokens from its script | set_flow_animation |
| `arrow-animation:` | D-501 | packages/excalidraw/scene/flowScript.ts | Set an arrow style by its explicit header | set_flow_animation |
| `node-animation:` | D-501 | packages/excalidraw/scene/flowScript.ts | Pick the chart's node highlight | set_flow_animation |
| `speed:` (multiplier, 1 = 240 scene units per second) | D-501 | packages/excalidraw/scene/flowScript.ts | Double the travel speed with speed: 2 | set_flow_animation |
| `step-ms:` | D-501 | packages/excalidraw/scene/flowScript.ts | Hold each step for 900 ms | set_flow_animation |
| `loop:` | D-501 | packages/excalidraw/scene/flowScript.ts | Stop at the last step or repeat | set_flow_animation |
| `spacing:` | D-501 | packages/excalidraw/scene/flowScript.ts | Set the repeated marks' spacing | set_flow_animation |
| `marching:` (none, marching-dashes, marching-beams or marching-tokens) | D-501 | packages/excalidraw/scene/flowScript.ts | Add a repeated layer beside a stepped animation | set_flow_animation |
| Neon glow slider for each part (Look tab) and `glow-shape-strength:`, `glow-text-strength:`, `glow-mark-strength:`, `glow-arrow-strength:` | D-501 | packages/excalidraw/components/FlowAnimationBar.tsx | Widen the neon of one part from faint to fierce | set_flow_look |
| Neon width Small (0.65), Normal, Large (2.5) for each part and `glow-<part>-width:` | D-501 | packages/excalidraw/components/FlowAnimationBar.tsx | Thin and thick neon lines | set_flow_look |
| Neon core Soft, White, Colour for each part and `glow-<part>-core:` | D-501 | packages/excalidraw/components/FlowAnimationBar.tsx | Change the bright middle of the neon | set_flow_look |
| Node and Arrow animation `off` (draws nothing; `none` lights every node and keeps the neon) | D-485, D-501 | packages/excalidraw/scene/flowStyles.ts | Compare None and Off with a colour set | set_flow_animation |
| Highlight on `all` (shape, text box and text) and `highlight: all` | D-501 | packages/excalidraw/scene/flowLook.ts | Light a whole node | set_flow_look |
| A neon arrow keeps its own drawing and head, and the head glows | D-501 | packages/excalidraw/scene/flowStyles.ts | Neon arrows with heads | set_flow_look |
| `background:` | D-501 | packages/excalidraw/scene/flowPresets.ts | Give a chart a coloured backing in the drawing | set_flow_look |
| `order: reverse` or `order: forward` | D-501 | packages/excalidraw/scene/flowOrder.ts | Read the steps in reverse order | set_flow_order |
| `node-color:` | D-501 | packages/excalidraw/scene/flowScript.ts | Match the Shape colour chip from a script | set_flow_colours |
| `text-color:` | D-501 | packages/excalidraw/scene/flowScript.ts | Match the Text colour chip from a script | set_flow_colours |
| `mark-color:` | D-501 | packages/excalidraw/scene/flowScript.ts | Match the Animation colour chip from a script | set_flow_colours |
| `arrow-color:` | D-501 | packages/excalidraw/scene/flowScript.ts | Match the Arrow colour chip from a script | set_flow_colours |
| `glow-shape:` | D-501 | packages/excalidraw/scene/flowScript.ts | Turn Shape neon on in the script | set_flow_look |
| `glow-text:` | D-501 | packages/excalidraw/scene/flowScript.ts | Turn Text neon on in the script | set_flow_look |
| `glow-mark:` | D-501 | packages/excalidraw/scene/flowScript.ts | Turn Animation neon on in the script | set_flow_look |
| `glow-arrow:` | D-501 | packages/excalidraw/scene/flowScript.ts | Turn Arrow neon on in the script | set_flow_look |
| `hide-arrow:` | D-501 | packages/excalidraw/scene/flowScript.ts | Hide the base arrow while marks play | set_flow_look |
| `highlight:` (shape, shape-box, shape-text, box, letters) | D-501 | packages/excalidraw/scene/flowScript.ts | Match Highlight on in the Look tab | set_flow_look |
| `shape:` | D-501 | packages/excalidraw/scene/flowPresets.ts | Set the chart shape from its header | set_flow_look |
| `fit:` | D-501 | packages/excalidraw/scene/flowPresets.ts | Choose page, spread or larger | set_flow_look |
| `arrows:` | D-501 | packages/excalidraw/scene/flowPresets.ts | Keep preset arrows or remove them | set_flow_look |
| `layout:` (TB or LR) | D-501 | packages/excalidraw/scene/flowPresets.ts | Choose downward or rightward fork drops | layout_flow |

The following D-522 words are preserved as script metadata for the animation engines in v3b-5; only the existing none, focus and pulse engines are supplied by this task.

| Node word (grammar; engine belongs to v3b-5) | Row | File | Clip idea when the engine is built | Proposed assistant tool |
| --- | --- | --- | --- | --- |
| `@style:ouroboros` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Circle the node outline | set_flow_animation |
| `@style:sparkle` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Twinkle at its edges | set_flow_animation |
| `@style:flowing-beam` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Run a beam around its outline | set_flow_animation |
| `@style:draw-on` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Draw the outline and fill | set_flow_animation |
| `@style:glint` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Sweep a shine across the node | set_flow_animation |
| `@style:orbit` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Orbit the node with a dot | set_flow_animation |
| `@style:ripple` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Send rings outward | set_flow_animation |
| `@style:breathing` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Slowly grow and shrink | set_flow_animation |
| `@style:wobble` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Shake a node briefly | set_flow_animation |
| `@style:flicker` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Flicker its neon outline | set_flow_animation |
| `@style:spotlight` | D-501, D-522 | packages/excalidraw/scene/flowScript.ts | Dim the rest of the chart | set_flow_animation |

## v3b-0-flow-panel

| Word or control | Row | File | Clip idea | Proposed assistant tool |
| --- | --- | --- | --- | --- |
| Look tab: layout, selection, shape, fit and colours | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Select one node and change the chart look | set_flow_look |
| Look tab table: a colour chip and a neon switch for Shape, Text, Animation and Arrow, one shared swatch pad (the colour presets are removed) | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Colour every part of a chart from one table | set_flow_colours |
| Hex code box under the colour pad of the Look tab (3 or 6 digits, empty is the default) | D-535 | packages/excalidraw/components/flowPanel/FlowHexInput.tsx | Type a brand colour for a part | set_flow_colours |
| Chart choice as a tab-like button at the start of the tabs | D-535 | packages/excalidraw/components/FlowAnimationBar.tsx | Choose which chart of a combo the tabs act on | select_flow_target |
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

## v3b-7a-win7-setup (D-493, D-518)

| What | Row | File | Clip idea | Assistant tool name |
| --- | --- | --- | --- | --- |
| the status `SCREEN_COPY` (the VS Code mirror's picture on Windows 7 is a copy of the screen) | D-493 | `packages/vscode-bridge/extension/media/capture.ps1` | "The mirror on an old classroom computer": the note under the picture, the editor kept in front | `describe_mirror_state` (reads: live / screen copy / covered / not visible) |
| the note "Screen copy: keep VS Code's window visible and not covered" (teacher's view only) | D-493 | `packages/excalidraw/components/MirrorPanelSurface.tsx` | same clip | - (read-only note) |
| the state `SCREEN_COPY_COVERED` ("VS Code's window is covered by another window - bring it to the front and keep it uncovered") | D-493 | `packages/vscode-bridge/extension/src/windowCapture.ts` | same clip: cover the editor, see the picture stop | `describe_mirror_state` |
| the main menu entry **Set up my editor** | D-518 | `excalidraw-app/components/AppMainMenu.tsx` | "Set up VS Code for the board from the page": menu, ticks, the file, the plan window | `open_editor_setup` (opens the dialog; the person still presses Set up) |
| the button **Set up my editor** in the VS Code mirror's connection state | D-518 | `packages/excalidraw/components/MirrorPanelSurface.tsx` | same clip | `open_editor_setup` |
| the dialog: editor (auto / VS Code / VSCodium), language groups (Python, C and C++, Java, JavaScript and TypeScript), profile name | D-518 | `excalidraw-app/setup/EditorSetupDialog.tsx` | same clip | `build_editor_setup_link` (editor, profile, groups -> the link, the command; never installs) |
| the link `excalidraw-setup://install?editor=..&profile=..&groups=..&vsix=..` | D-364, D-518 | `excalidraw-app/setup/editorSetup.ts` (`buildSetupLink`) | same clip | `build_editor_setup_link` |
| the file **ExcalidrawSetup.cmd** (download) | D-518 | `excalidraw-app/setup/editorSetup.ts` (`buildCmdFile`) | same clip | `build_editor_setup_link` (also returns the file's text) |
| the PowerShell command to copy | D-518 | `excalidraw-app/setup/editorSetup.ts` (`buildPowerShellCommand`) | same clip | `build_editor_setup_link` |
| `/setup/Bootstrap.ps1`, `EditorSetup.ps1`, `Open-SetupLink.ps1`, `Register-SetupLink.ps1`, `excalidraw-bridge.vsix` served by the page | D-518 | `scripts/setup/publish-editor-setup.mjs` (`public/setup/`) | - | `list_editor_setup_files` (reads the folder; names and sizes) |
| the pairing question in VS Code: "Allow the whiteboard at 127.0.0.1:3061 to connect?" (button Allow) | D-518 | `packages/vscode-bridge/extension/src/pairing.ts`, `extension.ts` | "Connect without copying a token": press Connect with the field empty, answer in VS Code | `connect_editor` (presses Connect with no token; the person answers in VS Code) |
| the command **Excalidraw Bridge: Forget the whiteboards that were allowed to connect** | D-518 | `packages/vscode-bridge/extension/package.json` | same clip (the end) | - (VS Code command) |
| the message `bridge:pair` (first frame, no token) | D-518 | `packages/vscode-bridge/bridge/src/protocol.ts` | - | - |
| the host's check before a virtual machine is started: `installer/win7/vm/check-host-disk.ps1 -Path D:\Hyper-V -MinGB 15` | D-493 | `installer/win7/vm/check-host-disk.ps1` | - | - (developer tool) |
| the proof script `installer/win7/vm/ps2-editor.ps1 [-Software]` (now says how the picture came and its brightness) | D-493 | `installer/win7/vm/ps2-editor.ps1` | - | - (developer tool) |
| the editor choice in the setup window (the one installed / VS Code / VSCodium / Both), ticked as the page said | D-518 | `installer/editor-setup/Open-SetupLink.ps1` | same clip: setting up both editors at once | `build_editor_setup_link` (the `editor` option; `both` is a window choice) |
| `Open-SetupLink.ps1 -Link <link> -Layout` (prints where every control of the window is; for tests) | D-518 | `installer/editor-setup/Open-SetupLink.ps1` | - | - (developer tool) |
| the message "The bridge extension in VS Code is an old version ... press Set up my editor" | D-518 | `packages/vscode-bridge/bridge/src/client.ts` | same clip (what an old bridge shows) | `describe_mirror_state` |
