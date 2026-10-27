import { LaserPointer } from "@excalidraw/laser-pointer";
import {
  SVG_NS,
  getSvgPathFromStroke,
  sceneCoordsToViewportCoords,
} from "@excalidraw/common";

import type { LaserPointerOptions } from "@excalidraw/laser-pointer";

import { AnimationController } from "./renderer/animation";

import type App from "./components/App";
import type { AppState } from "./types";

export interface Trail {
  start(container: SVGSVGElement): void;
  stop(): void;

  startPath(x: number, y: number): void;
  addPointToPath(x: number, y: number): void;
  endPath(): void;
}

export interface AnimatedTrailOptions {
  fill: (trail: AnimatedTrail) => string;
  stroke?: (trail: AnimatedTrail) => string;
  animateTrail?: boolean;
  /** drawn as a neon tube: a bright core inside a coloured halo (D-215) */
  neon?: boolean;
}

/** how far the core of a neon tube is lightened toward white (D-208, D-215) */
const NEON_CORE_PERCENT_OF_COLOR = 25;
/** the halo: soft shadows of growing reach, so the tube blooms */
const NEON_HALO = [2, 6, 14, 28];

export class AnimatedTrail implements Trail {
  private currentTrail?: LaserPointer;
  private pastTrails: LaserPointer[] = [];

  private container?: SVGSVGElement;
  private trailElement: SVGPathElement;
  /** the bright core on top of the halo, only for a neon trail (D-215) */
  private coreElement?: SVGPathElement;
  private trailAnimation?: SVGAnimateElement;
  private key: string;

  private static counter = 0;

  constructor(
    protected app: App,
    private options: Partial<LaserPointerOptions> &
      Partial<AnimatedTrailOptions>,
  ) {
    this.key = `animated-trail-${AnimatedTrail.counter++}`;
    this.trailElement = document.createElementNS(SVG_NS, "path");

    if (this.options.neon) {
      this.trailElement.setAttribute("data-neon-halo", "");
      this.coreElement = document.createElementNS(SVG_NS, "path");
      this.coreElement.setAttribute("data-neon-core", "");
      this.coreElement.setAttribute("stroke", "none");
    }
    if (this.options.animateTrail) {
      this.trailAnimation = document.createElementNS(SVG_NS, "animate");
      // TODO: make this configurable
      this.trailAnimation.setAttribute("attributeName", "stroke-dashoffset");
      this.trailElement.setAttribute("stroke-dasharray", "7 7");
      this.trailElement.setAttribute("stroke-dashoffset", "10");
      this.trailAnimation.setAttribute("from", "0");
      this.trailAnimation.setAttribute("to", `-14`);
      this.trailAnimation.setAttribute("dur", "0.3s");
      this.trailElement.appendChild(this.trailAnimation);
    }
  }

  get hasCurrentTrail() {
    return !!this.currentTrail;
  }

  hasLastPoint(x: number, y: number) {
    if (this.currentTrail) {
      const len = this.currentTrail.originalPoints.length;
      return (
        this.currentTrail.originalPoints[len - 1][0] === x &&
        this.currentTrail.originalPoints[len - 1][1] === y
      );
    }

    return false;
  }

  private cleanup() {
    this.pastTrails = [];
    this.currentTrail = undefined;

    if (this.trailElement.parentNode === this.container) {
      this.container?.removeChild(this.trailElement);
    }

    if (this.coreElement && this.coreElement.parentNode === this.container) {
      this.container?.removeChild(this.coreElement);
    }
  }

  start(container?: SVGSVGElement) {
    if (container) {
      this.container = container;
    }

    if (this.trailElement.parentNode !== this.container && this.container) {
      this.container.appendChild(this.trailElement);
    }

    if (
      this.coreElement &&
      this.coreElement.parentNode !== this.container &&
      this.container
    ) {
      // above the halo
      this.container.appendChild(this.coreElement);
    }

    if (!AnimationController.running(this.key)) {
      AnimationController.start(this.key, () => {
        const needsNext = this.onFrame();
        if (needsNext) {
          return { keep: true };
        }

        this.cleanup();

        return null;
      });
    }
  }

  stop() {
    AnimationController.cancel(this.key);
    this.cleanup();
  }

  startPath(x: number, y: number) {
    this.currentTrail = new LaserPointer(this.options);

    this.currentTrail.addPoint([x, y, performance.now()]);

    this.update();
  }

  addPointToPath(x: number, y: number) {
    if (this.currentTrail) {
      this.currentTrail.addPoint([x, y, performance.now()]);
      this.update();
    }
  }

  endPath() {
    if (this.currentTrail) {
      this.currentTrail.close();
      this.currentTrail.options.keepHead = false;
      this.pastTrails.push(this.currentTrail);
      this.currentTrail = undefined;
      this.update();
    }
  }

  getCurrentTrail() {
    return this.currentTrail;
  }

  clearTrails() {
    this.pastTrails = [];
    this.currentTrail = undefined;
    this.update();
  }

  private update() {
    this.start();
    if (this.trailAnimation) {
      this.trailAnimation.setAttribute("begin", "indefinite");
      this.trailAnimation.setAttribute("repeatCount", "indefinite");
    }
  }

  private onFrame() {
    const paths: string[] = [];

    for (const trail of this.pastTrails) {
      paths.push(this.drawTrail(trail, this.app.state));
    }

    if (this.currentTrail) {
      const currentPath = this.drawTrail(this.currentTrail, this.app.state);
      paths.push(currentPath);
    }

    this.pastTrails = this.pastTrails.filter(
      (t) =>
        t.getStrokeOutline(t.options.size / this.app.state.zoom.value)
          .length !== 0,
    );

    if (paths.length === 0) {
      // Clean up the SVG path if there are no trails to render
      this.trailElement.setAttribute("d", "");
      this.coreElement?.setAttribute("d", "");

      return false;
    }

    const svgPaths = paths.join(" ").trim();
    this.trailElement.setAttribute("d", svgPaths);

    if (this.coreElement) {
      const color = (this.options.fill ?? (() => "black"))(this);
      const halo = NEON_HALO.map(
        (blur) => `drop-shadow(0 0 ${blur}px ${color})`,
      ).join(" ");

      this.coreElement.setAttribute("d", svgPaths);
      this.coreElement.setAttribute(
        "fill",
        `color-mix(in srgb, ${color} ${NEON_CORE_PERCENT_OF_COLOR}%, #fff)`,
      );
      // the rim of the tube and its bloom are the halo's: the colour itself
      this.trailElement.setAttribute("stroke", color);
      this.trailElement.setAttribute("stroke-width", "4");
      this.trailElement.setAttribute("stroke-linejoin", "round");
      this.trailElement.style.filter = halo;
    }

    if (this.trailAnimation) {
      this.trailElement.setAttribute(
        "fill",
        (this.options.fill ?? (() => "black"))(this),
      );
      this.trailElement.setAttribute(
        "stroke",
        (this.options.stroke ?? (() => "black"))(this),
      );
    } else {
      this.trailElement.setAttribute(
        "fill",
        (this.options.fill ?? (() => "black"))(this),
      );
    }

    return true;
  }

  private drawTrail(trail: LaserPointer, state: AppState): string {
    const _stroke = trail
      .getStrokeOutline(trail.options.size / state.zoom.value)
      .map(([x, y]) => {
        const result = sceneCoordsToViewportCoords(
          { sceneX: x, sceneY: y },
          state,
        );

        return [result.x, result.y];
      });

    const stroke = this.trailAnimation
      ? _stroke.slice(0, _stroke.length / 2)
      : _stroke;

    return getSvgPathFromStroke(stroke, true);
  }
}
