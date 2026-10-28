/**
 * The one place the drops that can go into a node are asked (D-246).
 *
 * A picture, a GIF or a video can reach the canvas by several roads: a file
 * dragged in from the computer, a file dragged from the sidebar, an emoji or a
 * GIF dragged from the emoji bar. Each of them ends in a point of the scene; the
 * node media registers here what it does with that point, so that every road
 * asks the same question and none of them has to know about nodes.
 */

import type { ScenePoint } from "./insertIntoScene";

export type NodeDrop = {
  /** whether a node of a chart is under this point, and will take the file */
  claims: (at: ScenePoint) => boolean;
  /** puts the file in the node under the point */
  add: (file: File, at: ScenePoint) => Promise<unknown>;
};

let registered: NodeDrop | null = null;

export const setNodeDrop = (next: NodeDrop | null) => {
  registered = next;
};

export const nodeDrop = () => registered;
