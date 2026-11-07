/**
 * The short clips of what this version adds (D-462): the list the help shows,
 * where the files are, and a way for another part of the app (the first screen)
 * to open the help on one of them.
 *
 * The clips are files the app carries in `clips/`, with a `manifest.json` that
 * says what each one is. A host that has no such folder simply has no list.
 */

export type FeatureClip = {
  id: string;
  title: string;
  line: string;
  group: string;
  seconds: number;
  bytes: number;
  /** the video, from the folder the app is served from */
  video: string;
  /** a picture of it, shown before it is played */
  poster: string;
};

/** the folder the app is served from, as a whole address */
const root = (): string => {
  const path =
    typeof window.EXCALIDRAW_ASSET_PATH === "string"
      ? window.EXCALIDRAW_ASSET_PATH
      : "/";

  return new URL(path, window.location.href).href;
};

export const clipUrl = (file: string): string => new URL(file, root()).href;

/** the list, in the order the manifest gives; a missing or damaged manifest is no list */
export const loadClips = async (
  fetchJson: (url: string) => Promise<unknown> = async (url) => {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`${url} answered ${response.status}`);
    }

    return response.json();
  },
): Promise<FeatureClip[]> => {
  try {
    const manifest = (await fetchJson(clipUrl("clips/manifest.json"))) as {
      clips?: FeatureClip[];
    };

    return (manifest.clips ?? []).filter(
      (clip) => clip && clip.id && clip.video && clip.title,
    );
  } catch {
    return [];
  }
};

/** the clips by group, the groups in the order each first appears */
export const groupClips = (clips: readonly FeatureClip[]) => {
  const groups = new Map<string, FeatureClip[]>();

  for (const clip of clips) {
    groups.set(clip.group, [...(groups.get(clip.group) ?? []), clip]);
  }

  return [...groups.entries()].map(([group, items]) => ({ group, items }));
};

/** how long a clip is, in words: "27 s" */
export const clipLength = (seconds: number) => `${Math.round(seconds)} s`;

let pending: string | null = null;

/** asks that the help, when it opens, plays this clip first */
export const requestClip = (id: string) => {
  pending = id;
};

/** the clip that was asked for, once: the help takes it when it opens */
export const takePendingClip = (): string | null => {
  const id = pending;

  pending = null;

  return id;
};
