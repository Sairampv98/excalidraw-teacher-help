#!/usr/bin/env python3
"""The OCR sidecar: the Python OCR engines, over stdio.

The engines that are Python cannot be npm dependencies, so the extension
spawns THIS and talks to it over stdio - one JSON object per line, the same
shape the capture helper uses (D-90).

Two rules shape the code:

- the sidecar reports which engines it can reach with
  ``importlib.util.find_spec``, which does NOT execute the package - asking
  "is paddleocr there?" must not pay for paddleocr's ten-second import;
- the engine that was asked for is imported LAZILY, on the first request, and
  the model is kept for every later request - the model load is the expensive
  part (D-90).

The lines come back in the WHOLE image's pixels, exactly like tesseract's,
even when only a rectangle of it was read (D-59).

The protocol
------------

The first line the sidecar writes is its report::

    {"type": "ready", "python": "3.14.7", "engines": {"indra": {...}}}

Then every request is one line on stdin::

    {"id": "1", "engine": "indra", "imageBase64": "...", "region": {...}}

and every answer is one line on stdout, with the request's id on it::

    {"id": "1", "text": "...", "lines": [...], "durationMs": 228}
    {"id": "1", "error": "ModuleNotFoundError: no module named 'paddleocr'"}
"""

import base64
import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import time

# What each Python engine is, and how it is installed.
#
# "modules" are the packages that have to be there; "install" is the command
# that puts them there. The command goes into the reason, so a teacher who
# cannot read the reason cannot fix it (D-91).
ENGINE_SPECS = {
    "indra": {
        "modules": ("indra_ocr",),
        "install": "pip install indra-ocr",
        "package": "indra-ocr",
    },
    "paddle": {
        "modules": ("paddleocr", "paddle"),
        "install": "pip install paddleocr paddlepaddle",
        "package": "paddleocr",
    },
}

# PaddlePaddle's wheels go up to cp313. There is no cp314 wheel on any
# version, so PaddleOCR cannot be installed on Python 3.14 at all - and the
# sidecar says so, because it knows its own sys.version_info (D-91).
PADDLE_LAST_SUPPORTED_PYTHON = (3, 13)

# The models, loaded on the first request and kept for every later one.
_MODELS = {}


def python_version():
    """This interpreter's version, as a string."""
    return "%d.%d.%d" % sys.version_info[:3]


def has_module(name):
    """Whether a package is there - WITHOUT importing it.

    ``find_spec`` looks for the package and stops there: it does not execute
    it. Importing paddleocr to see whether it is installed would cost ten
    seconds of the teacher's machine for an answer the file system already
    has (D-90).
    """
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def paddle_python_problem():
    """The truth about PaddlePaddle on this interpreter, or None."""
    if sys.version_info[:2] <= PADDLE_LAST_SUPPORTED_PYTHON:
        return None
    return (
        "PaddlePaddle has no build for Python %d.%d; it needs Python 3.12 or 3.13"
        % (sys.version_info[0], sys.version_info[1])
    )


def engine_reason(name):
    """Why an engine cannot be used here, or None when it can."""
    spec = ENGINE_SPECS[name]
    missing = [module for module in spec["modules"] if not has_module(module)]

    if not missing:
        return None

    if name == "paddle":
        if "paddleocr" in missing:
            reason = "%s is not installed - %s" % (spec["package"], spec["install"])
        else:
            reason = "paddlepaddle is not installed - pip install paddlepaddle"
        problem = paddle_python_problem()
        if problem:
            reason = "%s. %s" % (reason, problem)
        return reason

    return "%s is not installed - %s" % (spec["package"], spec["install"])


def engine_report():
    """What the sidecar can reach, without importing any of it."""
    report = {}
    for name in sorted(ENGINE_SPECS):
        reason = engine_reason(name)
        if reason is None:
            report[name] = {"available": True}
        else:
            report[name] = {"available": False, "reason": reason}
    return report


def write(payload):
    """One JSON object per line, on stdout."""
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def decode_gray(image_bytes):
    """The image as a grayscale array."""
    import numpy as np

    try:
        import cv2

        buffer = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(buffer, cv2.IMREAD_GRAYSCALE)
        if image is not None:
            return image
    except ImportError:
        pass

    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as handle:
        return np.array(handle.convert("L"))


def decode_color(image_bytes):
    """The image as an RGB array."""
    import numpy as np

    try:
        import cv2

        buffer = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
        if image is not None:
            return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    except ImportError:
        pass

    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as handle:
        return np.array(handle.convert("RGB"))


def crop(image, region):
    """The rectangle of the image, and the offset it was taken from.

    The offset is what puts the boxes back in the WHOLE image's pixels: the
    engine reads the rectangle, so its boxes are the rectangle's own, and the
    app places the text where it was (D-59).
    """
    if not region:
        return image, 0, 0

    x = max(0, int(region.get("x", 0)))
    y = max(0, int(region.get("y", 0)))
    width = max(1, int(region.get("width", image.shape[1])))
    height = max(1, int(region.get("height", image.shape[0])))

    cropped = image[y : y + height, x : x + width]
    if cropped.size == 0:
        return image, 0, 0

    return cropped, x, y


def load_model(name):
    """The engine's model - loaded ONCE, on the first request (D-90)."""
    if name in _MODELS:
        return _MODELS[name]

    if name == "indra":
        import indra_ocr

        model = indra_ocr.load()
    elif name == "paddle":
        from paddleocr import PaddleOCR

        model = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            lang="en",
        )
    else:
        raise ValueError("unknown engine: %s" % name)

    _MODELS[name] = model
    return model


def read_indra(image_bytes, region):
    """The text and the lines, with IndraOCR."""
    from pathlib import Path

    from indra_ocr.pipeline import read_images

    converter = load_model("indra")

    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "page.png")
        with open(path, "wb") as handle:
            handle.write(image_bytes)
        gray = read_images(Path(path))[0]

    gray, offset_x, offset_y = crop(gray, region)
    page = converter.ocr(gray)

    lines = []
    confidences = []
    for line in page.lines:
        x0, y0, x1, y1 = line.box
        text = (line.text or "").strip()
        if not text:
            continue
        lines.append(
            {
                "text": text,
                "x": x0 + offset_x,
                "y": y0 + offset_y,
                "width": x1 - x0,
                "height": y1 - y0,
            }
        )
        confidences.append(float(line.conf))

    confidence = sum(confidences) / len(confidences) if confidences else None
    return page.text, lines, confidence


def read_paddle(image_bytes, region):
    """The text and the lines, with PaddleOCR."""
    import numpy as np

    ocr = load_model("paddle")
    image = decode_color(image_bytes)
    image, offset_x, offset_y = crop(image, region)

    texts = []
    confidences = []
    polygons = []

    results = []
    predict = getattr(ocr, "predict", None)
    if predict is not None:
        results = list(predict(image))
    else:
        results = list(ocr.ocr(image, cls=True))

    for result in results:
        if isinstance(result, dict):
            texts.extend(result.get("rec_texts") or [])
            confidences.extend(
                float(score) for score in (result.get("rec_scores") or [])
            )
            boxes = result.get("rec_polys")
            if boxes is None:
                boxes = result.get("dt_polys") or []
            polygons.extend(boxes)
            continue

        # the older shape: [[box, (text, score)], ...]
        for entry in result or []:
            try:
                box, (text, score) = entry[0], entry[1]
            except (IndexError, TypeError, ValueError):
                continue
            texts.append(text)
            confidences.append(float(score))
            polygons.append(np.array(box))

    lines = []
    for index, text in enumerate(texts):
        text = (text or "").strip()
        if not text:
            continue
        if index < len(polygons) and polygons[index] is not None:
            points = np.array(polygons[index], dtype=float)
            x0 = float(points[:, 0].min())
            y0 = float(points[:, 1].min())
            x1 = float(points[:, 0].max())
            y1 = float(points[:, 1].max())
        else:
            x0 = y0 = 0.0
            x1 = y1 = 0.0
        lines.append(
            {
                "text": text,
                "x": x0 + offset_x,
                "y": y0 + offset_y,
                "width": x1 - x0,
                "height": y1 - y0,
            }
        )

    confidence = sum(confidences) / len(confidences) if confidences else None
    return "\n".join(texts), lines, confidence


def read(name, image_bytes, region):
    """The engine's answer: the text, the lines, the confidence."""
    if name == "indra":
        return read_indra(image_bytes, region)
    if name == "paddle":
        return read_paddle(image_bytes, region)
    raise ValueError("unknown engine: %s" % name)


def handle(request):
    """One request, one answer."""
    request_id = request.get("id", "")
    name = request.get("engine", "")

    if name not in ENGINE_SPECS:
        return {
            "id": request_id,
            "error": "unknown engine: %s" % (name or "(none)"),
        }

    reason = engine_reason(name)
    if reason is not None:
        return {"id": request_id, "error": reason}

    started = time.perf_counter()
    try:
        image_bytes = base64.b64decode(request.get("imageBase64", ""))
        # the libraries print things; the protocol owns stdout
        with contextlib.redirect_stdout(sys.stderr):
            text, lines, confidence = read(name, image_bytes, request.get("region"))
    except Exception as error:  # noqa: BLE001 - one bad read must not end the sidecar
        return {
            "id": request_id,
            "error": "%s: %s" % (type(error).__name__, error),
        }

    answer = {
        "id": request_id,
        "text": text,
        "lines": lines,
        "durationMs": int(round((time.perf_counter() - started) * 1000)),
    }
    if confidence is not None:
        answer["confidence"] = confidence
    return answer


def main():
    write(
        {
            "type": "ready",
            "python": python_version(),
            "engines": engine_report(),
        }
    )

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        if not isinstance(request, dict):
            continue
        write(handle(request))


if __name__ == "__main__":
    main()
