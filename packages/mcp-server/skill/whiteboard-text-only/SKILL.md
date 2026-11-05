---
name: whiteboard-text-only
description: For a model that cannot look at pictures: how to build a good page using numbers and descriptions instead of a screenshot. Load it when you cannot read images, or when you are not sure that you can.
---

# If you cannot see the page

You can still make a good page. You check with numbers, not with your eyes, and you never say that a page looks good.

## Do not call `screenshot`

It returns a picture. If you cannot read pictures, use `describe_page` instead: it lists every thing on the page in reading order (top to bottom, then left to right) with its id, type, place and size, the words in it, its fill, and for an arrow the words of the two shapes it joins. `lines` is the same list as plain sentences.

## Let the tools do the geometry

Prefer `build_page`, `make_slides` and `create_flow_chart`: they place everything, so the positions are not yours to get wrong. Draw by hand with `create_elements` only for small things, and then work in the numbers below.

## Numbers to design with

- A page is at least 1920 by 1080. `check_page` and `describe_page` return `pageSize`: use it.
- Margin 100 on every side. Space of at least 24 between two things.
- A character is about 0.55 times the font size wide, and a line is about 1.25 times the font size tall. So text of size 28 in a box 700 wide holds about 45 characters a line.
- Sizes: title 48 or more, body 28 or more, code 24 or more, never under 18.
- Contrast: text under 24 needs a ratio of 4.5, text of 24 or more needs 3. Use `#1e1e1e` on light shapes and `#ffffff` on dark ones.

## Check, then report numbers

1. `check_page`: you want `ok: true` and `fits: true`.
2. `lowest.bottom` must be at least 60 less than `pageSize.height`. If it is not, the page is full: move the last block to a new page.
3. `describe_page`: read the list. Is every word you meant to write there? Is the order the order you would read it? Does each arrow join the right two shapes (`from` and `to`)?
4. Say what you found with the numbers: 'fits: true, the lowest thing ends at y=940 of 1080, 7 things, the arrows join Start to Insert'.

## Pictures

Do not put in a picture you have not been given. Use shapes, charts and words. If the teacher gave an image file, place it and say that you could not check how it looks.
