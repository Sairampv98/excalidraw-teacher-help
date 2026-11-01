# What the MCP server does

Made from the code by `scripts/mcpCoverage.mjs` - the tools are defined once, in `packages/excalidraw/mcp/toolSpecs.ts`, and the actions in `packages/excalidraw/mcp/actionCatalog.ts`. `status` is the server's own: it tells the pairing code while no page is paired.

Positions are page-relative: (0, 0) is the top-left of the page, in scene units; pages are numbered from 1. A tool marked **changes** is refused while _Allow changes_ is off, and each is one undo step. A tool marked **server** is done by the server itself, which has the disk: it reads and writes only in the folders the person lists, and goes on the internet only while _Allow internet_ is on.

## Look

| Tool | What it does |  |
| --- | --- | --- |
| `describe_capabilities` | What this whiteboard can do right now: whether changes are allowed, the app, the features that are on, the limits, and the pages | reads |
| `list_pages` | The pages of the document, in order: number, id, name, size, whether the frame and the page number are shown, the paper, how many elements are on it, and which page is open | reads |
| `list_elements` | The elements of the document in short: id, type, position and size (page-relative), text, colours, lock, groups, link, and the shape a text is in | reads |
| `get_element` | Everything the document holds about one element, with its position relative to its page | reads |
| `get_selection` | The ids of the elements that are selected now, and the page they are on | reads |
| `screenshot` | A picture of what is on the whiteboard, for a model that can see: the page that is open (or the one named), the selection, or some elements | reads |
| `get_stats` | The numbers the stats panel shows: how many elements of each type, how many on each page, and for the selection (or for ids) where it is on its page and how large | reads |
| `find_text` | Find the words in the document: every text, and the shape it is in, that has the query in it | reads |
| `check_page` | Look at a page for what would not read well: things that reach outside the page, things that lie on each other, text that is small, and text whose colour is too near the colour behind it | reads |

## Create, change, delete

| Tool | What it does |  |
| --- | --- | --- |
| `create_elements` | Create elements on a page | changes |
| `update_elements` | Change elements: each update names an id and the things to change - x, y (page-relative), width, height, angle (radians), text, points, locked, link | changes |
| `delete_elements` | Delete elements (and the text bound to them) | changes |
| `duplicate_elements` | Copy elements, with the text bound to them and the arrows between them, and put the copies dx and dy to the side (default 40 and 40) | changes |
| `style_text` | Make a text, or a part of it (start and end are positions in the words), bold or italic - or plain again with false | changes |
| `bind_arrow` | Bind the ends of an arrow to shapes (start and/or end: an element id), or take an end off with null | changes |
| `mermaid_to_diagram` | Draw a diagram from Mermaid text (a flowchart, sequence diagram, class diagram...) as ordinary elements, with its top-left at x, y on the page (default 100, 100) | changes |
| `select_elements` | Select elements (an empty list clears the selection) | reads |

## The properties panel and ink

| Tool | What it does |  |
| --- | --- | --- |
| `describe_properties` | What the properties panel would show for these elements: for each property its current value ("mixed" when they differ), and the values it may take | reads |
| `set_properties` | Change properties of elements the way the properties panel does: strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, roundness, opacity, fontFamily, fontSize, textAlign, verticalAlign, startArrowhead, endArrowhead, arrowType | changes |
| `set_ink` | Change the ink look of drawn elements (shapes, lines, freedraw, text): look (normal, neon, chalk, marker, pencil), amount (1 to 100: the glow of neon, the dust of chalk, the width of marker, the darkness of pencil) and color | changes |

## The editor's actions

| Tool | What it does |  |
| --- | --- | --- |
| `list_actions` | Every action the editor has, and how you reach it: the ones run_action runs, the ones another tool does, the ones that come with a later part of the server, and the ones that are not for an assistant, with why | reads |
| `run_action` | Run one of the editor's actions on elements - align, distribute, flip, group and ungroup, layers (bring to front...), lock, bind a text to a shape, bold, bigger or smaller text, close a line into a polygon, put in a frame, snapping and the grid | changes |

## Pages and their look

| Tool | What it does |  |
| --- | --- | --- |
| `add_page` | Add a page | changes |
| `rename_page` | Give a page a name | changes |
| `move_page` | Move a page to a place in the order (1 is first) | changes |
| `delete_page` | Delete a page with everything on it | changes |
| `clear_page` | Delete everything that is on a page and keep the page | changes |
| `list_deleted_pages` | The pages that were deleted and are kept, newest first: id, name, when, and how many elements were on them | reads |
| `restore_page` | Bring a deleted page back, as a new page after the last one, with everything that was on it | changes |
| `set_page` | Change a page: frame (the rectangle drawn round it), pageNumber (the number in its footer), preset (a size - see describe_page_look) or width and height (never below 1920 by 1080), and paper: {type, color, grain, age} | changes |
| `scale_page_content` | Make what is on a page smaller (shrink: half the size, to get more room) or larger (grow: back by two) | changes |
| `describe_page_look` | What a page looks like now (size, frame, number, paper) and what it may be: the paper types, the twelve paper colours, grain and age, the size presets, and the four one-click looks (old paper, green chalkboard, blackboard, neon night) with the ink each brings | reads |
| `apply_page_look` | Give a page one of the one-click looks: its paper, and the ink the next elements are drawn with (as the person's Page look dialog does) | changes |
| `go_to_page` | Open a page and bring it into view | reads |

## The canvas and the view

| Tool | What it does |  |
| --- | --- | --- |
| `set_canvas` | Change the canvas: backgroundColor, grid and gridSize, snapToObjects, snapToMidpoints, theme (light or dark), zen (hide the chrome), viewOnly, stats (the numbers panel), and the document's name | changes |
| `set_view` | Move what the person sees: fit a page (fit: page), the selection or some elements into view, set a zoom, or centre on a point of a page | reads |
| `set_tool` | Pick the tool the person draws with next: selection, lasso, rectangle, diamond, ellipse, arrow, line, freedraw, text, eraser, hand, frame, embeddable or laser | reads |

## Export and insert

| Tool | What it does |  |
| --- | --- | --- |
| `export_scene` | Export as a PNG (an image), SVG or the saved-document JSON (text): a page, the whole document (scope all) or the selection | reads |
| `insert_document` | Put a saved whiteboard document (the text of an .excalidraw file) on a page, beside what is there | changes |

## Library, stickers, tables, code

| Tool | What it does |  |
| --- | --- | --- |
| `library_list` | What the shape library holds: each item's id, name, how many elements it has and its size | reads |
| `library_insert` | Put an item of the shape library on a page, with its top-left at x, y (page-relative, default 100, 100) | changes |
| `list_stickers` | The whiteboard's own emoji and animated GIFs, found by words (every word must match): id, kind (emoji or gif), label and tags | reads, app |
| `insert_sticker` | Put a sticker (an emoji or an animated GIF, by the id list_stickers gives) on a page, with its top-left at x, y (page-relative; the middle of the page when not given), its longest side size long (default 200) | changes, app |
| `insert_table` | Draw a table on a page: rows is a list of rows, each a list of cell texts, with the top-left at x, y (page-relative, default 100, 100) | changes, app |
| `insert_code_card` | Put code on a page as a syntax-highlighted card (dark, monospace, real text that can be edited), with its top-left at x, y (page-relative, default 100, 100) | changes, app |

## Flow charts

| Tool | What it does |  |
| --- | --- | --- |
| `flow_kinds` | The kinds of flow chart the whiteboard makes - process, decision, steps, cycle, tiers, integration, network, list, grid, matrix, pyramid, funnel, timeline, target, venn, hierarchy - and the teacher's own, each with what it is and an example script to follow, and how a script is written | reads |
| `check_flow_script` | Check a script for a kind of chart without making it: whether it can be made, how many nodes and arrows it has, the text size and how many pages it would need, and what is wrong with it, line by line | reads |
| `create_flow_chart` | Make a flow chart from a script, on a page: kind (see flow_kinds), script (one line to a node, as the kind's example shows), fit (page: the text gets smaller until it fits, the default; larger: the text stays large and the chart goes past the page; spread: over the pages that follow, which are made when missing), shape (own, or one shape for every node), arrows (own, or none) | changes |
| `list_flow_charts` | The flow charts on the pages: each one's chartId, kind, script, fit, shape, arrows, the pages it is on and how many nodes it has | reads |
| `edit_flow_chart` | Change a flow chart in place: a new script, kind, fit, shape or arrows (what is not given stays) | changes |
| `delete_flow_chart` | Delete a flow chart: every shape, text and arrow of it | changes |
| `convert_flow_script` | Write a script for another kind of chart, keeping its words: from and to are kinds (see flow_kinds) | reads |
| `describe_flow_look` | How the animation of a chart looks and plays now: the colours, the glows, the arrow, the highlight, the step's length, the speed, the node and arrow styles - and what may be chosen | reads |
| `set_flow_look` | Change how the animation of a chart looks and plays: nodeColor, textColor, markColor, arrowColor (a hex colour like #6965db, or nothing for the accent colour), hideArrow, glowShape, glowText, glowMark, glowArrow, loop, camera, nodeTarget, durationMs (100 to 10000), speed (10 to 600), nodeStyle, arrowStyle | changes |
| `play_flow` | Play a chart: the animation walks the chart the teacher drew, step by step | changes |
| `stop_flow` | End the animation and give the canvas back | changes |

## Slides and lesson pages

| Tool | What it does |  |
| --- | --- | --- |
| `make_slides` | Make a deck of slides from a script: the slides are separated by a line of three dashes (---) | changes, app |
| `build_page` | Build a lesson page out of blocks, one under the other: a title, a heading, a text, bullets, a quote, a divider, a table, a code and a chart | changes, app |

## Pictures, documents, files and the internet

| Tool | What it does |  |
| --- | --- | --- |
| `list_allowed_folders` | The folders the person has allowed the assistant to read from and write to (the server was started with them), and whether the internet is on | reads, server |
| `list_folder` | What is in a folder of an allowed folder: files with their kind (image, video, document, captions, whiteboard) and size, and folders | reads, server |
| `file_info` | What a file in an allowed folder is, by its bytes and not its name: kind, type, size, and for a picture its size in pixels | reads, server |
| `insert_image` | Put a picture on a page: a file of an allowed folder (path) or a picture from the internet (url, when the internet is on) | changes, server |
| `crop_image` | Crop a picture to a part of it: left, top, width, height as fractions of the whole picture (0 to 1) | changes |
| `list_sources` | Where the pictures that came from outside came from: url, licence and attribution, with the element and page | reads |
| `read_document` | Read a document of an allowed folder: a text or markdown file comes back as its text (at most maxChars, 20000 by default; truncated says if it was cut); a PDF comes back as the text of the pages asked for (pages, like 1-3,5; the first ten by default, at most thirty at a time) and, with images: true, a picture of each of the first three, so you can see what is on them | reads, server |
| `insert_markdown` | Put markdown on a page as what a page is made of, top to bottom from x, y (page-relative, default 100, 100) in width (default: the page's width less margins): headings, paragraphs and quotes as text that wraps, lists, a code block as a code card, a table as a table, a rule as a line; bold and italic are kept | changes, server |
| `insert_pdf_page` | Put a page of a PDF of an allowed folder on a page as a picture, or a part of it: pdfPage (from 1) and an optional region (left, top, width, height as fractions of the PDF page, 0 to 1) | changes, server |
| `read_image_text` | Read the words in a picture on a page (OCR, in the browser): the whole text and each line with where it is in the picture (as fractions of it) | reads, app |
| `list_panels` | The panels on the pages - videos, YouTube videos and code editors: each one's id, page, place, size and what it holds (a video's source and caption tracks, a code panel's language and how much code) | reads |
| `insert_video` | Put a video of an allowed folder on a page as a video panel (mp4, webm, mov, m4v, ogv), with its top-left at x, y (page-relative; the middle of the page when not given) and width (default: the video's own width, at most 480) | changes, server |
| `insert_youtube` | Put a YouTube video on a page as a video panel, played by YouTube's own player (the browser needs the internet to show it): url is a YouTube link (youtube.com/watch?v=..., youtu.be/..., shorts, embed) or the 11-character video id | changes, app |
| `insert_code_panel` | Put a code editor panel on a page - an editor that works in the browser, holds code the teacher can edit, and runs Python and JavaScript | changes, app |
| `set_code_panel` | Change the code of a code panel, its language, or both | changes, app |
| `read_code_panel` | Read a code panel: its language and its code (at most 100000 characters; truncated says if it was cut), and whether the text is the teacher's own or what the editor mirrors | reads, app |
| `run_code` | Run Python or JavaScript in the browser and say what it printed: give the id of a code panel (its code and language are run) or the code and its language (default python) | changes, app |
| `fetch_resource` | Fetch something from the internet (only when the internet is on in the whiteboard's Assistant tab): https only, never an address on this computer or its network, at most 25 MB | reads, server |

## The editor's actions (108)

Every action the editor registers is named, and a test fails when one is not: 38 run with `run_action`, 47 are done by a tool of their own, 5 come with a later part of the server, 18 are not for an assistant.

| Action | How |
| --- | --- |
| `addToLibrary` | run_action: Add the elements to the shape library. |
| `alignLeft` | run_action: Align the elements by their left edges. |
| `alignRight` | run_action: Align the elements by their right edges. |
| `alignTop` | run_action: Align the elements by their top edges. |
| `alignBottom` | run_action: Align the elements by their bottom edges. |
| `alignHorizontallyCentered` | run_action: Centre the elements on one vertical line. |
| `alignVerticallyCentered` | run_action: Centre the elements on one horizontal line. |
| `distributeHorizontally` | run_action: Space the elements evenly from left to right. |
| `distributeVertically` | run_action: Space the elements evenly from top to bottom. |
| `bringForward` | run_action: Bring the elements one layer forward. |
| `bringToFront` | run_action: Bring the elements to the front. |
| `sendBackward` | run_action: Send the elements one layer back. |
| `sendToBack` | run_action: Send the elements to the back. |
| `flipHorizontal` | run_action: Flip the elements left to right. |
| `flipVertical` | run_action: Flip the elements top to bottom. |
| `group` | run_action: Group the elements. |
| `ungroup` | run_action: Take the elements out of their group. |
| `duplicateSelection` | run_action: Duplicate the elements, a little to the side (duplicate_elements places the copies where you say). |
| `toggleElementLock` | run_action: Lock the elements, or unlock them when all are locked. |
| `unlockAllElements` | run_action: Unlock every element of the document. |
| `autoResize` | run_action: Let a text grow with its words, or give it a fixed width. |
| `bindText` | run_action: Put a text inside the shape it is selected with. |
| `unbindText` | run_action: Take the text out of the shape. |
| `wrapTextInContainer` | run_action: Put each text in a box of its own. |
| `toggleBold` | run_action: Make the text bold, or plain when all of it is bold (style_text does a part of it). |
| `toggleItalic` | run_action: Make the text italic, or upright when all of it is (style_text does a part of it). |
| `increaseFontSize` | run_action: Make the text one step larger. |
| `decreaseFontSize` | run_action: Make the text one step smaller. |
| `togglePolygon` | run_action: Close a line into a polygon, or open it. |
| `wrapSelectionInFrame` | run_action: Put the elements in a new frame. |
| `removeAllElementsFromFrame` | run_action: Take every element out of the frame. |
| `selectAllElementsInFrame` | run_action: Select what is in the frame. |
| `linkToElement` | run_action: Link the element to another element of the document. |
| `arrowBinding` | run_action: Turn arrow binding on or off for what the person draws next. |
| `midpointSnapping` | run_action: Turn snapping to the middle of shapes on or off. |
| `objectsSnapMode` | run_action: Turn snapping to other elements on or off. |
| `gridMode` | run_action: Turn the grid on or off. |
| `updateFrameRendering` | run_action: Show or hide the names and outlines of frames. |
| `changeStrokeColor` | the tool `set_properties` |
| `changeBackgroundColor` | the tool `set_properties` |
| `changeFillStyle` | the tool `set_properties` |
| `changeStrokeWidth` | the tool `set_properties` |
| `changeStrokeStyle` | the tool `set_properties` |
| `changeSloppiness` | the tool `set_properties` |
| `changeRoundness` | the tool `set_properties` |
| `changeOpacity` | the tool `set_properties` |
| `changeFontFamily` | the tool `set_properties` |
| `changeFontSize` | the tool `set_properties` |
| `changeFontStyle` | the tool `style_text` |
| `changeTextAlign` | the tool `set_properties` |
| `changeVerticalAlign` | the tool `set_properties` |
| `changeArrowType` | the tool `set_properties` |
| `changeArrowhead` | the tool `set_properties` |
| `changeArrowProperties` | the tool `set_properties` |
| `changeInkLook` | the tool `set_ink` |
| `changePage` | the tool `set_page` |
| `copyStyles` | the tool `set_properties` |
| `pasteStyles` | the tool `set_properties` |
| `deleteSelectedElements` | the tool `delete_elements` |
| `deselect` | the tool `select_elements` |
| `selectAll` | the tool `select_elements` |
| `hyperlink` | the tool `update_elements` |
| `changeViewBackgroundColor` | the tool `set_canvas` |
| `toggleTheme` | the tool `set_canvas` |
| `zenMode` | the tool `set_canvas` |
| `viewMode` | the tool `set_canvas` |
| `stats` | the tool `get_stats` |
| `searchMenu` | the tool `find_text` |
| `changeExportBackground` | the tool `export_scene` |
| `changeExportEmbedScene` | the tool `export_scene` |
| `changeExportScale` | the tool `export_scene` |
| `exportWithDarkMode` | the tool `export_scene` |
| `changeProjectName` | the tool `set_canvas` |
| `zoomIn` | the tool `set_view` |
| `zoomOut` | the tool `set_view` |
| `resetZoom` | the tool `set_view` |
| `zoomToFit` | the tool `set_view` |
| `zoomToFitSelection` | the tool `set_view` |
| `zoomToFitSelectionInViewport` | the tool `set_view` |
| `toggleEraserTool` | the tool `set_tool` |
| `toggleHandTool` | the tool `set_tool` |
| `toggleLassoTool` | the tool `set_tool` |
| `setEmbeddableAsActiveTool` | the tool `set_tool` |
| `setFrameAsActiveTool` | the tool `set_tool` |
| `insertDocument` | the tool `insert_document` |
| `changePanel` | `set_panel`, in a later part of the server |
| `cropEditor` | `crop_image`, in a later part of the server |
| `flowClass` | `flow_class`, in a later part of the server |
| `flowLayout` | `flow_layout`, in a later part of the server |
| `flowResetLayout` | `flow_reset_layout`, in a later part of the server |
| `copy` | not for the assistant: the person's clipboard is the person's own |
| `cut` | not for the assistant: the person's clipboard is the person's own |
| `paste` | not for the assistant: the person's clipboard is the person's own |
| `copyAsPng` | not for the assistant: the person's clipboard is the person's own |
| `copyAsSvg` | not for the assistant: the person's clipboard is the person's own |
| `copyText` | not for the assistant: the person's clipboard is the person's own |
| `copyElementLink` | not for the assistant: the person's clipboard is the person's own |
| `undo` | not for the assistant: the history holds the person's own work as well; the person undoes with Ctrl+Z |
| `redo` | not for the assistant: the history holds the person's own work as well; the person redoes with Ctrl+Shift+Z |
| `clearCanvas` | not for the assistant: it empties every page at once; clear_page and delete_elements do it with a name on it |
| `loadScene` | not for the assistant: it opens a file dialog, and the files are read by the server itself |
| `saveFileToDisk` | not for the assistant: it opens a file dialog, and the files are read by the server itself |
| `saveToActiveFile` | not for the assistant: it opens a file dialog, and the files are read by the server itself |
| `finalize` | not for the assistant: it is a mode of the person's own editing, not a change of the document |
| `toggleLinearEditor` | not for the assistant: it is a mode of the person's own editing, not a change of the document |
| `toggleShapeSwitch` | not for the assistant: it is a mode of the person's own editing, not a change of the document |
| `toggleShortcuts` | not for the assistant: it is a mode of the person's own editing, not a change of the document |
| `goToCollaborator` | not for the assistant: collaboration is not part of this whiteboard |

## Still to come

- The export of an animation and of a handout, the VS Code terminal.
