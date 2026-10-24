import {
  isSameBridgeMirrorRegion,
  normalizeBridgeMirrorRegion,
} from "../../bridge/src/protocol";

import type { BridgeMirrorRegion } from "../../bridge/src/protocol";

/**
 * What is **mirrored** of the editor's window (D-143).
 *
 * What is mirrored is a **choice**, and a choice can be changed as often as
 * the teacher changes their mind - so this is a **state** and not a one-shot
 * setting: the teacher can set it again and again, and the last choice is the
 * one that stands.
 *
 * The **whole window** is the default: a region of `null` means the whole
 * window, and that is what the panel mirrors until the teacher chooses
 * something else.
 */
export interface MirrorState {
  /**
   * The region that is mirrored, or `null` for the **whole** window.
   *
   * It is measured in fractions of the whole window, so it is the same region
   * whatever size the window is.
   */
  region: BridgeMirrorRegion | null;
  /**
   * Whether the region **follows the pointer** inside the panel.
   *
   * It is a **mode**, and it is **off** until the teacher turns it on.
   */
  follow: boolean;
}

/** The mirror as it stands before anybody has chosen anything. */
export const INITIAL_MIRROR_STATE: MirrorState = {
  region: null,
  follow: false,
};

export interface MirrorStore {
  /** the mirror as it stands */
  readonly state: MirrorState;
  /**
   * The teacher chose what is mirrored.
   *
   * The choice is **normalized** first: a region that reaches outside the
   * window is pulled back inside it, and a region with no area is no region at
   * all - the whole window, which is the default.
   *
   * It answers whether anything **changed**, so a caller that publishes the
   * state does not publish it for nothing.
   */
  set: (region: unknown, follow: boolean) => boolean;
}

/**
 * The mirror's own store.
 *
 * The extension holds it for the whole session: the teacher's choice is the
 * editor's business - the capture descriptor says what is mirrored, so every
 * panel that shows the live view says the same thing (D-143).
 */
export const createMirrorStore = (): MirrorStore => {
  let state: MirrorState = INITIAL_MIRROR_STATE;

  return {
    get state(): MirrorState {
      return state;
    },

    set: (region: unknown, follow: boolean): boolean => {
      const next: MirrorState = {
        region: normalizeBridgeMirrorRegion(region),
        follow: follow === true,
      };

      if (
        isSameBridgeMirrorRegion(state.region, next.region) &&
        state.follow === next.follow
      ) {
        // the same choice again is not a change: the teacher may pick the
        // same crop twice, and the second pick changes nothing (D-143)
        return false;
      }

      state = next;

      return true;
    },
  };
};

/**
 * The editor's answer to the teacher's **choice** (D-143).
 *
 * The choice is stored, and the capture descriptor is published again so it
 * says what is mirrored now - and so a panel that connects later learns the
 * choice.
 *
 * It answers whether the choice **changed** anything: the same choice again
 * publishes nothing, because the descriptor already says it.
 */
export const applyMirrorMessage = (
  mirror: MirrorStore,
  publish: (state: MirrorState) => void,
  message: { region?: unknown; follow: boolean },
): boolean => {
  const changed = mirror.set(message.region, message.follow);

  if (changed) {
    publish(mirror.state);
  }

  return changed;
};
