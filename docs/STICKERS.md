# The bundled stickers

The emoji and GIFs in the bar are **our own artwork** (D-157). Nothing was downloaded, nothing is loaded from a third party at run time, and no file here is somebody else's copyright.

- **What drew them:** `excalidraw-app/emoji/tools/build-stickers.mjs` - each sticker is a short list of circles, ellipses, rectangles, polygons and strokes in a 100 x 100 box.
- **How they were made:** one drawing gives the static SVG (the emoji) and, with a motion attached, an animated GIF (200 x 200, 12 frames, looping). The GIF encoder is in the same file; it decodes its own output as a check, so a bad stream stops the build.
- **Drawn on:** 2026-10-27
- **Licence:** CC0 1.0 - dedicated to the public domain. Use them for anything.
- **Rebuild:** `node excalidraw-app/emoji/tools/build-stickers.mjs` (the output is deterministic).
- **Size:** 67 files, 343 KB in all.

These are simplified drawings **inspired by the idea of** common emoji and reaction GIFs, not copies of any emoji font or GIF library. To add one: add a drawing and a catalog line to the tool and run it.

| File                   | Kind  | Bytes |
| ---------------------- | ----- | ----- |
| `skull.svg`            | emoji | 920   |
| `sob.svg`              | emoji | 755   |
| `joy.svg`              | emoji | 882   |
| `fire.svg`             | emoji | 522   |
| `hundred.svg`          | emoji | 1277  |
| `sparkles.svg`         | emoji | 453   |
| `eyes.svg`             | emoji | 462   |
| `heart.svg`            | emoji | 1282  |
| `pleading.svg`         | emoji | 1015  |
| `moai.svg`             | emoji | 585   |
| `cool.svg`             | emoji | 1002  |
| `clown.svg`            | emoji | 1041  |
| `thumbsup.svg`         | emoji | 721   |
| `rocket.svg`           | emoji | 581   |
| `popper.svg`           | emoji | 923   |
| `check.svg`            | emoji | 365   |
| `cross.svg`            | emoji | 488   |
| `star.svg`             | emoji | 412   |
| `bulb.svg`             | emoji | 1161  |
| `brain.svg`            | emoji | 845   |
| `bolt.svg`             | emoji | 201   |
| `hearteyes.svg`        | emoji | 1698  |
| `partying.svg`         | emoji | 1428  |
| `wink.svg`             | emoji | 771   |
| `nerd.svg`             | emoji | 1570  |
| `smirk.svg`            | emoji | 587   |
| `bruh.svg`             | emoji | 612   |
| `thinking.svg`         | emoji | 812   |
| `angry.svg`            | emoji | 821   |
| `scream.svg`           | emoji | 747   |
| `sleepy.svg`           | emoji | 680   |
| `trophy.svg`           | emoji | 892   |
| `crown.svg`            | emoji | 467   |
| `gem.svg`              | emoji | 359   |
| `sun.svg`              | emoji | 1293  |
| `rainbow.svg`          | emoji | 1511  |
| `balloon.svg`          | emoji | 496   |
| `gift.svg`             | emoji | 479   |
| `flower.svg`           | emoji | 450   |
| `cat.svg`              | emoji | 953   |
| `ghost.svg`            | emoji | 834   |
| `alien.svg`            | emoji | 431   |
| `pizza.svg`            | emoji | 556   |
| `coffee.svg`           | emoji | 761   |
| `brokenheart.svg`      | emoji | 1435  |
| `bomb.svg`             | emoji | 554   |
| `pumpkin.svg`          | emoji | 570   |
| `skull-shake.gif`      | gif   | 18765 |
| `sob-tears.gif`        | gif   | 22399 |
| `joy-bounce.gif`       | gif   | 21719 |
| `fire-flicker.gif`     | gif   | 15503 |
| `hundred-pulse.gif`    | gif   | 14312 |
| `sparkles-twinkle.gif` | gif   | 10183 |
| `eyes-look.gif`        | gif   | 15047 |
| `heart-beat.gif`       | gif   | 13145 |
| `clown-wobble.gif`     | gif   | 19883 |
| `popper-burst.gif`     | gif   | 11064 |
| `rocket-launch.gif`    | gif   | 16777 |
| `check-pop.gif`        | gif   | 16527 |
| `star-spin.gif`        | gif   | 13854 |
| `bulb-flash.gif`       | gif   | 12939 |
| `thumbs-bounce.gif`    | gif   | 12526 |
| `ghost-float.gif`      | gif   | 18580 |
| `cool-nod.gif`         | gif   | 19336 |
| `bomb-spark.gif`       | gif   | 12096 |
| `coffee-steam.gif`     | gif   | 12113 |
| `sleepy-zzz.gif`       | gif   | 16736 |
