import React, { useMemo, useState } from "react";

import {
  getContainingFrame,
  getCornerRadius,
  getRenderOpacity,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawImageElement,
} from "@excalidraw/element/types";

import {
  animatedImageClipPath,
  animatedImageTransform,
  OUTSIDE_FRAME,
} from "../scene/animatedImageOverlay";

import type {
  BinaryFiles,
  ElementsPendingErasure,
  NormalizedZoomValue,
  PendingExcalidrawElements,
} from "../types";

type AnimatedImageCamera = {
  zoom: { value: NormalizedZoomValue };
  scrollX: number;
  scrollY: number;
};

type NaturalSize = { width: number; height: number };

const HOST_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  pointerEvents: "none",
};

type AnimatedImageProps = {
  image: ExcalidrawImageElement;
  dataURL: string;
  elementsMap: ElementsMap;
  camera: AnimatedImageCamera;
  viewport: { width: number; height: number };
  opacity: number;
  croppingElementId: string | null;
};

/**
 * One animated image, as a real `<img>` sitting on top of the canvas.
 *
 * The transform, the crop and the frame clip all reproduce what `renderElement`
 * would have drawn, so the picture lands on exactly the pixels the canvas would
 * have used — it is simply allowed to keep moving.
 */
const AnimatedImage = ({
  image,
  dataURL,
  elementsMap,
  camera,
  viewport,
  opacity,
  croppingElementId,
}: AnimatedImageProps) => {
  const { zoom, scrollX, scrollY } = camera;

  const transform = useMemo(
    () => animatedImageTransform(image, elementsMap, camera),
    // `camera` is rebuilt on every app state change; only its fields can change
    // what the transform comes out as
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [image, elementsMap, zoom.value, scrollX, scrollY],
  );

  const clipPath = useMemo(
    () => animatedImageClipPath(image, elementsMap, camera, viewport),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [image, elementsMap, zoom.value, scrollX, scrollY, viewport],
  );

  // the natural size is only needed to reproduce a crop, and only the browser
  // can tell us what it is
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null);

  if (clipPath === OUTSIDE_FRAME) {
    return null;
  }

  const { crop } = image;

  // `drawImage(img, cropX, cropY, cropW, cropH, 0, 0, width, height)` in CSS:
  // scale the whole source by the ratio between the cropped region and the
  // element, then offset it back so the crop's origin lands at the element's.
  let imageStyle: React.CSSProperties = {
    position: "absolute",
    width: "100%",
    height: "100%",
  };

  if (crop && naturalSize && naturalSize.width > 0 && naturalSize.height > 0) {
    const scaleX = image.width / crop.width;
    const scaleY = image.height / crop.height;

    imageStyle = {
      position: "absolute",
      width: naturalSize.width * scaleX,
      height: naturalSize.height * scaleY,
      left: -crop.x * scaleX,
      top: -crop.y * scaleY,
    };
  }

  return (
    <div
      className="excalidraw__animated-image-clip"
      style={clipPath ? { clipPath } : undefined}
    >
      <div
        className="excalidraw__animated-image"
        style={{
          width: image.width,
          height: image.height,
          transform,
          opacity,
          // the canvas clips rounded images with `roundRect`; `overflow: hidden`
          // on this wrapper is the same cut, in the rotated local space
          borderRadius: image.roundness
            ? getCornerRadius(Math.min(image.width, image.height), image)
            : undefined,
          // the crop modal draws its own handles over the image; hide this copy
          // so it cannot sit on top of them
          visibility: croppingElementId === image.id ? "hidden" : undefined,
        }}
      >
        <img
          src={dataURL}
          alt=""
          draggable={false}
          style={imageStyle}
          onLoad={(event) =>
            setNaturalSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
      </div>
    </div>
  );
};

type AnimatedImageOverlayProps = {
  images: readonly ExcalidrawImageElement[];
  files: BinaryFiles;
  elementsMap: ElementsMap;
  camera: AnimatedImageCamera;
  viewport: { width: number; height: number };
  elementsPendingErasure: ElementsPendingErasure;
  pendingFlowchartNodes: Readonly<PendingExcalidrawElements> | null;
  croppingElementId: string | null;
};

/**
 * A layer of visible `<img>`s over the canvas, one per animated image.
 *
 * ## Known limitation
 *
 * Everything on the canvas is a single raster, so a GIF drawn here always sits
 * above the elements painted after it, whatever their z-order. Interleaving them
 * properly would need one canvas layer per animated image. In exchange the GIF
 * actually moves.
 */
const AnimatedImageOverlayImpl = ({
  images,
  files,
  elementsMap,
  camera,
  viewport,
  elementsPendingErasure,
  pendingFlowchartNodes,
  croppingElementId,
}: AnimatedImageOverlayProps) => {
  if (images.length === 0) {
    return null;
  }

  return (
    // inline, not just in the stylesheet: if the CSS ever fails to load, an
    // overlay that took clicks would break selecting, dragging and the eraser
    <div
      className="excalidraw__animated-images"
      style={HOST_STYLE}
      aria-hidden="true"
    >
      {images.map((image) => {
        const file = image.fileId ? files[image.fileId] : undefined;

        if (!file) {
          return null;
        }

        return (
          <AnimatedImage
            key={image.id}
            image={image}
            dataURL={file.dataURL}
            elementsMap={elementsMap}
            camera={camera}
            viewport={viewport}
            opacity={getRenderOpacity(
              image,
              getContainingFrame(image, elementsMap),
              elementsPendingErasure,
              pendingFlowchartNodes,
            )}
            croppingElementId={croppingElementId}
          />
        );
      })}
    </div>
  );
};

/**
 * The overlay re-renders its whole `<img>` tree whenever it is rendered, so
 * it must not be rendered when nothing it shows has changed. The camera and
 * the viewport are rebuilt on every app state change, so they are compared by
 * value rather than by reference.
 */
const areEqual = (
  prev: AnimatedImageOverlayProps,
  next: AnimatedImageOverlayProps,
) =>
  prev.images === next.images &&
  prev.files === next.files &&
  prev.elementsMap === next.elementsMap &&
  prev.camera.zoom.value === next.camera.zoom.value &&
  prev.camera.scrollX === next.camera.scrollX &&
  prev.camera.scrollY === next.camera.scrollY &&
  prev.viewport.width === next.viewport.width &&
  prev.viewport.height === next.viewport.height &&
  prev.elementsPendingErasure.size === next.elementsPendingErasure.size &&
  [...prev.elementsPendingErasure].every((id) =>
    next.elementsPendingErasure.has(id),
  ) &&
  prev.pendingFlowchartNodes === next.pendingFlowchartNodes &&
  prev.croppingElementId === next.croppingElementId;

export const AnimatedImageOverlay = React.memo(
  AnimatedImageOverlayImpl,
  areEqual,
);
