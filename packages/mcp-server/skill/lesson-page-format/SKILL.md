---
name: lesson-page-format
description: The layout of a tutorial page in the style of a good web tutorial (like the W3Schools data structures pages): short sections in a fixed order, an example you can run, an exercise, a way on. Load it before build_page or make_slides for a lesson.
---

# The page of a lesson

A tutorial page is short, the same every time, and ends with something to do. Build it with `build_page`; the blocks go one under the other in this order.

| Order | Block | What goes in it |
| --- | --- | --- |
| 1 | `title` | The name of the topic, plain: 'Queue'. |
| 2 | `text` | One sentence that says what it is, then one that says what it is for. |
| 3 | `heading` + `chart` | 'See it move': a flow chart of the idea, in the animation's order. |
| 4 | `heading` + `table` | 'Operations': a table of the operation, what it does and what it costs. |
| 5 | `heading` + `code` | 'The code': one `code` block for each language, with `language` set. |
| 6 | `quote` | 'Remember': one line the student can take away. |
| 7 | `heading` + `bullets` | 'Try it': two or three small tasks. |
| 8 | `heading` + `text` | 'Next': the name of the next page and why it follows. |

## Rules

- One idea a page. If it does not fit, make a second page; do not shrink the text.
- The same words for the same thing on every page and in every language: enqueue, dequeue, peek, isEmpty.
- A code block holds code that has been compiled or run. Do not write code you have not run.
- A table has a header row, and no cell is longer than a short line.
- Start the blocks at x 100, y 100 and keep the default width unless the code is wider.
- After `build_page` call `check_page`. If it does not fit, split the page at a heading.

## A deck instead

For slides, `make_slides` takes a script: slides separated by a line of three dashes, each beginning with its heading, then words, bullets, a table or a code block. The same order applies, one idea to a slide.
