---
name: whiteboard-workflow
description: How to work on the whiteboard, for any model: read first, plan in numbers, use the tool that lays out for you, check the page, tell the teacher. Load it before the first change to the board.
---

# Working on the whiteboard: the loop

Follow these steps in order, every time.

1. **Find out what is allowed.** Call `describe_capabilities`. If Allow changes is off, every tool that changes the board is refused: tell the teacher to turn it on in the Assistant panel, and do not try to get round it.
2. **Read before you write.** Call `list_pages`, then `describe_page` for the page you will change. Change as little as you can: the board is the teacher's document, not a scratchpad.
3. **Plan the page in numbers.** A page is at least 1920 by 1080 scene units. Keep a margin of 100. Decide what goes where before you draw anything.
4. **Use the tool that lays out for you.** `build_page` for a lesson page, `make_slides` for a deck, `create_flow_chart` for a diagram. Use `create_elements` only for what those cannot make. Never draw boxes and arrows one by one when a flow chart does it.
5. **Check what you made.** After every change call `check_page`. Put right every issue whose severity is `problem`, then check again. A note is only a note.
6. **One call, one undo step.** Do not make the same thing twice to be safe: list what is there first. The teacher undoes a whole call with one Ctrl+Z.
7. **Ids.** In `create_elements` you may choose an id. An id that a live element holds is refused, and the answer says what holds it. Two elements of one id in one call are refused too. The id of a deleted element can be used again.
8. **A refusal is information.** Read the reason and change the thing it names. Do not send the same call again unchanged.
9. **Tell the teacher what you did** in a few plain sentences: which pages, what is on them, anything you were not sure of.

## What good looks like

- One idea on a page. A heading, a few lines, one picture or one chart.
- Text no smaller than 18, and 28 or more for what the back row must read.
- Dark text on a light shape, or light text on a dark shape. `check_page` measures the text against the shape it is on.
- The same layout on every page of a lesson, so the students know where to look.
