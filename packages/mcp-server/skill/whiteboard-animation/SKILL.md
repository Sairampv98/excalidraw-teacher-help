---
name: whiteboard-animation
description: How to animate a chart for a class: play and present, the camera, the look, and export to a GIF, an MP4 or a PDF handout. Load it when the teacher wants a chart to move or to be taken away as a file.
---

# Animating a chart

## Playing it

- `list_flow_charts` gives the chartId.
- `play_flow` with `mode` set to `play` runs the animation by itself. With `mode` set to `present` the teacher steps through it by hand, full screen, using Present steps.
- `stop_flow` ends it and gives the canvas back. Always stop what you started.

## The camera

`set_flow_look` with `camera` set to true flies the view to each step. It is **off by default**, it is remembered, and it moves the page away from under the students' eyes, so do not switch it on unless the teacher asks. The teacher can switch it on or off at any time with the Fly button in the animation bar, also while presenting. If it was on, tell the teacher.

## The look

`set_flow_look` also sets `speed` (10 to 600), `durationMs` (100 to 10000), `loop`, the colours (a hex colour like #6965db) and the glow. What you do not give stays as it was. A slower animation (`durationMs` 1500 or more) is easier to follow in a class; a loop is for a chart that stays on the screen while the teacher talks.

Keep the colours readable: run `check_page` after you change them.

## Taking it away

- `export_animation` writes a GIF, an animated WebP or an MP4 into `exports/`. Use MP4 for a computer that has a video player, GIF for a browser. The answer gives the path, the size and the number of steps: tell the teacher.
- `export_handout` writes the pages as one PDF. This is what the students are given, and it is what to use on a computer where nothing else will run.
- A file that already exists is never written over: use a new name.
