---
name: excalidraw-whiteboard
description: Draw on, and teach with, a running Excalidraw whiteboard: its pages and elements, its charts and their animation, a deck of slides and a lesson page. Use it when the work is a class, a lesson, a diagram, a slide deck or a handout on a whiteboard.
---

# The whiteboard for a class

This is a running Excalidraw board - a fork of the whiteboard a teacher draws on. You draw on it with the tools below; the teacher sees every change as it happens and can undo it.

## The pages and the positions

The board holds pages, numbered from 1 as the teacher sees them. The page that is open is the one a tool works on when no page is named.

Positions are page-relative: (0, 0) is the top-left corner of the page, in scene units. A page is at least 1920 by 1080 scene units, and a smaller page (a note, a slide) sits in the top-left of that area. A tool that says it works in scene units takes absolute positions instead.

The elements come in the order they are drawn, bottom first. `list_elements` gives them in short, and `get_element` gives everything about one of them.

## The tools, in groups

### Look

- `describe_capabilities` - What this whiteboard can do right now: whether changes are allowed, the app, the features that are on, the limits, and the pages.
- `list_pages` - The pages of the document, in order: number, id, name, size, whether the frame and the page number are shown, the paper, how many elements are on it, and which page is open.
- `list_elements` - The elements of the document in short: id, type, position and size (page-relative), text, colours, lock, groups, link, and the shape a text is in.
- `get_element` - Everything the document holds about one element, with its position relative to its page.
- `get_selection` - The ids of the elements that are selected now, and the page they are on.
- `screenshot` - A picture of what is on the whiteboard, for a model that can see: the page that is open (or the one named), the selection, or some elements.
- `get_stats` - The numbers the stats panel shows: how many elements of each type, how many on each page, and for the selection (or for ids) where it is on its page and how large.
- `find_text` - Find the words in the document: every text, and the shape it is in, that has the query in it.
- `check_page` - Look at a page for what would not read well: things that reach outside the page, things that lie on each other, text that is small, and text whose colour is too near the colour behind it.

### Create, change, delete

- `create_elements` - Create elements on a page.
- `update_elements` - Change elements: each update names an id and the things to change - x, y (page-relative), width, height, angle (radians), text, points, locked, link.
- `delete_elements` - Delete elements (and the text bound to them).
- `duplicate_elements` - Copy elements, with the text bound to them and the arrows between them, and put the copies dx and dy to the side (default 40 and 40).
- `style_text` - Make a text, or a part of it (start and end are positions in the words), bold or italic - or plain again with false.
- `bind_arrow` - Bind the ends of an arrow to shapes (start and/or end: an element id), or take an end off with null.
- `mermaid_to_diagram` - Draw a diagram from Mermaid text (a flowchart, sequence diagram, class diagram...) as ordinary elements, with its top-left at x, y on the page (default 100, 100).
- `select_elements` - Select elements (an empty list clears the selection).

### The properties panel and ink

- `describe_properties` - What the properties panel would show for these elements: for each property its current value ("mixed" when they differ), and the values it may take.
- `set_properties` - Change properties of elements the way the properties panel does: strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, roundness, opacity, fontFamily, fontSize, textAlign, verticalAlign, startArrowhead, endArrowhead, arrowType.
- `set_ink` - Change the ink look of drawn elements (shapes, lines, freedraw, text): look (normal, neon, chalk, marker, pencil), amount (1 to 100: the glow of neon, the dust of chalk, the width of marker, the darkness of pencil) and color.

### The editor's actions

- `list_actions` - Every action the editor has, and how you reach it: the ones run_action runs, the ones another tool does, the ones that come with a later part of the server, and the ones that are not for an assistant, with why.
- `run_action` - Run one of the editor's actions on elements - align, distribute, flip, group and ungroup, layers (bring to front...), lock, bind a text to a shape, bold, bigger or smaller text, close a line into a polygon, put in a frame, snapping and the grid.

### Pages and their look

- `add_page` - Add a page.
- `rename_page` - Give a page a name.
- `move_page` - Move a page to a place in the order (1 is first).
- `delete_page` - Delete a page with everything on it.
- `clear_page` - Delete everything that is on a page and keep the page.
- `list_deleted_pages` - The pages that were deleted and are kept, newest first: id, name, when, and how many elements were on them.
- `restore_page` - Bring a deleted page back, as a new page after the last one, with everything that was on it.
- `set_page` - Change a page: frame (the rectangle drawn round it), pageNumber (the number in its footer), preset (a size - see describe_page_look) or width and height (never below 1920 by 1080), and paper: {type, color, grain, age}.
- `scale_page_content` - Make what is on a page smaller (shrink: half the size, to get more room) or larger (grow: back by two).
- `describe_page_look` - What a page looks like now (size, frame, number, paper) and what it may be: the paper types, the twelve paper colours, grain and age, the size presets, and the four one-click looks (old paper, green chalkboard, blackboard, neon night) with the ink each brings.
- `apply_page_look` - Give a page one of the one-click looks: its paper, and the ink the next elements are drawn with (as the person's Page look dialog does).
- `go_to_page` - Open a page and bring it into view.

### The canvas and the view

- `set_canvas` - Change the canvas: backgroundColor, grid and gridSize, snapToObjects, snapToMidpoints, theme (light or dark), zen (hide the chrome), viewOnly, stats (the numbers panel), and the document's name.
- `set_view` - Move what the person sees: fit a page (fit: page), the selection or some elements into view, set a zoom, or centre on a point of a page.
- `set_tool` - Pick the tool the person draws with next: selection, lasso, rectangle, diamond, ellipse, arrow, line, freedraw, text, eraser, hand, frame, embeddable or laser.

### Export and insert

- `export_scene` - Export as a PNG (an image), SVG or the saved-document JSON (text): a page, the whole document (scope all) or the selection.
- `insert_document` - Put a saved whiteboard document (the text of an .excalidraw file) on a page, beside what is there.

### Library, stickers, tables, code

- `library_list` - What the shape library holds: each item's id, name, how many elements it has and its size.
- `library_insert` - Put an item of the shape library on a page, with its top-left at x, y (page-relative, default 100, 100).
- `list_stickers` - The whiteboard's own emoji and animated GIFs, found by words (every word must match): id, kind (emoji or gif), label and tags.
- `insert_sticker` - Put a sticker (an emoji or an animated GIF, by the id list_stickers gives) on a page, with its top-left at x, y (page-relative; the middle of the page when not given), its longest side size long (default 200).
- `insert_table` - Draw a table on a page: rows is a list of rows, each a list of cell texts, with the top-left at x, y (page-relative, default 100, 100).
- `insert_code_card` - Put code on a page as a syntax-highlighted card (dark, monospace, real text that can be edited), with its top-left at x, y (page-relative, default 100, 100).

### Flow charts

- `flow_kinds` - The kinds of flow chart the whiteboard makes - process, decision, steps, cycle, tiers, integration, network, list, grid, matrix, pyramid, funnel, timeline, target, venn, hierarchy - and the teacher's own, each with what it is and an example script to follow, and how a script is written.
- `check_flow_script` - Check a script for a kind of chart without making it: whether it can be made, how many nodes and arrows it has, the text size and how many pages it would need, and what is wrong with it, line by line.
- `create_flow_chart` - Make a flow chart from a script, on a page: kind (see flow_kinds), script (one line to a node, as the kind's example shows), fit (page: the text gets smaller until it fits, the default; larger: the text stays large and the chart goes past the page; spread: over the pages that follow, which are made when missing), shape (own, or one shape for every node), arrows (own, or none).
- `list_flow_charts` - The flow charts on the pages: each one's chartId, kind, script, fit, shape, arrows, the pages it is on and how many nodes it has.
- `edit_flow_chart` - Change a flow chart in place: a new script, kind, fit, shape or arrows (what is not given stays).
- `delete_flow_chart` - Delete a flow chart: every shape, text and arrow of it.
- `convert_flow_script` - Write a script for another kind of chart, keeping its words: from and to are kinds (see flow_kinds).
- `describe_flow_look` - How the animation of a chart looks and plays now: the colours, the glows, the arrow, the highlight, the step's length, the speed, the node and arrow styles - and what may be chosen.
- `set_flow_look` - Change how the animation of a chart looks and plays: nodeColor, textColor, markColor, arrowColor (a hex colour like #6965db, or nothing for the accent colour), hideArrow, glowShape, glowText, glowMark, glowArrow, loop, camera, nodeTarget, durationMs (100 to 10000), speed (10 to 600), nodeStyle, arrowStyle.
- `play_flow` - Play a chart: the animation walks the chart the teacher drew, step by step.
- `stop_flow` - End the animation and give the canvas back.

### Slides and lesson pages

- `make_slides` - Make a deck of slides from a script: the slides are separated by a line of three dashes (---).
- `build_page` - Build a lesson page out of blocks, one under the other: a title, a heading, a text, bullets, a quote, a divider, a table, a code and a chart.

### Pictures, documents, files and the internet

- `list_allowed_folders` - The folders the person has allowed the assistant to read from and write to (the server was started with them), and whether the internet is on.
- `list_folder` - What is in a folder of an allowed folder: files with their kind (image, video, document, captions, whiteboard) and size, and folders.
- `file_info` - What a file in an allowed folder is, by its bytes and not its name: kind, type, size, and for a picture its size in pixels.
- `insert_image` - Put a picture on a page: a file of an allowed folder (path) or a picture from the internet (url, when the internet is on).
- `crop_image` - Crop a picture to a part of it: left, top, width, height as fractions of the whole picture (0 to 1).
- `list_sources` - Where the pictures that came from outside came from: url, licence and attribution, with the element and page.
- `read_document` - Read a document of an allowed folder: a text or markdown file comes back as its text (at most maxChars, 20000 by default; truncated says if it was cut); a PDF comes back as the text of the pages asked for (pages, like 1-3,5; the first ten by default, at most thirty at a time) and, with images: true, a picture of each of the first three, so you can see what is on them.
- `insert_markdown` - Put markdown on a page as what a page is made of, top to bottom from x, y (page-relative, default 100, 100) in width (default: the page's width less margins): headings, paragraphs and quotes as text that wraps, lists, a code block as a code card, a table as a table, a rule as a line; bold and italic are kept.
- `insert_pdf_page` - Put a page of a PDF of an allowed folder on a page as a picture, or a part of it: pdfPage (from 1) and an optional region (left, top, width, height as fractions of the PDF page, 0 to 1).
- `read_image_text` - Read the words in a picture on a page (OCR, in the browser): the whole text and each line with where it is in the picture (as fractions of it).
- `list_panels` - The panels on the pages - videos, YouTube videos and code editors: each one's id, page, place, size and what it holds (a video's source and caption tracks, a code panel's language and how much code).
- `insert_video` - Put a video of an allowed folder on a page as a video panel (mp4, webm, mov, m4v, ogv), with its top-left at x, y (page-relative; the middle of the page when not given) and width (default: the video's own width, at most 480).
- `insert_youtube` - Put a YouTube video on a page as a video panel, played by YouTube's own player (the browser needs the internet to show it): url is a YouTube link (youtube.com/watch?v=..., youtu.be/..., shorts, embed) or the 11-character video id.
- `insert_code_panel` - Put a code editor panel on a page - an editor that works in the browser, holds code the teacher can edit, and runs Python and JavaScript.
- `set_code_panel` - Change the code of a code panel, its language, or both.
- `read_code_panel` - Read a code panel: its language and its code (at most 100000 characters; truncated says if it was cut), and whether the text is the teacher's own or what the editor mirrors.
- `run_code` - Run Python or JavaScript in the browser and say what it printed: give the id of a code panel (its code and language are run) or the code and its language (default python).
- `fetch_resource` - Fetch something from the internet (only when the internet is on in the whiteboard's Assistant tab): https only, never an address on this computer or its network, at most 25 MB.

## What is refused, and why

- A change while **Allow changes** is off. The teacher turns it on in the board's Assistant panel; every tool that changes the board is refused until then.
- A file outside the folders the teacher listed. The server reads and writes only in those folders, and a path that leaves them is refused.
- The internet while **Allow internet** is off. It is off by default, and when it is on only https addresses that are public are fetched.
- A tool that does not exist, or an argument of the wrong shape. The answer says what was expected.
- A change that would be too large: more than 500 elements in one call, a document too long to read, a file too big to fetch.

## How a change is undone

Every change is one undo step: the teacher presses Ctrl+Z once and the whole of it goes. A deck of slides is one step and not one step per slide, and a lesson page with a chart in it is one step too.

Read a page before you change it, and change as little as you can. The teacher's board is the document, not a scratchpad.
