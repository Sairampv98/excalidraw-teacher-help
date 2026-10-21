"""Make the OCR benchmark's input images.

A 1080p screencast frame (a code editor with a subtitle band at the bottom)
and the crop of that band, which is what the ROI lever sends to the engine.

The frame is a measurement **input**, not a deliverable: it is generated here
so that the numbers in `benchmark-result.json` can be reproduced on another
machine. It needs Pillow (`pip install pillow`) and the fonts Windows ships.

    python excalidraw-app/ocr/make-frames.py <out-dir>
"""

import sys

from PIL import Image, ImageDraw, ImageFont

WIDTH = 1920
HEIGHT = 1080
BAND_TOP = 900
BAND_HEIGHT = HEIGHT - BAND_TOP

CODE = [
    "public static void main(String[] args) {",
    "    int[] a = { 5, 3, 9, 1, 7 };",
    "    sort(a);",
    "    for (int x : a) {",
    "        System.out.println(x);",
    "    }",
    "}",
]

CAPTION = "Now let us trace the two pointers, one from each end."


def main(out_dir: str) -> None:
    frame = Image.new("RGB", (WIDTH, HEIGHT), "#f6f8fa")
    draw = ImageDraw.Draw(frame)

    code_font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 26)
    caption_font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 34)

    # a title bar and the code, so the frame has the structure of a screencast
    draw.rectangle([0, 0, WIDTH, 56], fill="#24292f")
    draw.text((28, 16), "Sort.java  -  DSA demo", font=code_font, fill="#e6edf3")

    y = 110
    for line in CODE:
        draw.text((60, y), line, font=code_font, fill="#1f2328")
        y += 44

    # the subtitle band: the region the ROI crop takes
    draw.rectangle([0, BAND_TOP, WIDTH, HEIGHT], fill="#000000")
    draw.text(
        (60, BAND_TOP + 40),
        CAPTION,
        font=caption_font,
        fill="#ffffff",
    )

    frame.save(f"{out_dir}/frame-1080p.png")

    band = frame.crop((0, BAND_TOP, WIDTH, HEIGHT))
    band.save(f"{out_dir}/subtitle-band.png")

    print(f"frame: {WIDTH}x{HEIGHT}")
    print(f"band: {band.width}x{band.height} at (0, {BAND_TOP})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
