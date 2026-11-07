import React, { useEffect, useState } from "react";

import {
  clipLength,
  clipUrl,
  groupClips,
  loadClips,
  takePendingClip,
} from "../guides/featureClips";

import "./FeatureClips.scss";

import type { FeatureClip } from "../guides/featureClips";

/**
 * "What this version adds" (D-462): every addition of this version over plain
 * Excalidraw, each with a short clip to watch. A clip plays right here, with
 * the picture it starts from, and the next one is a press away.
 */
export const FeatureClips = (props: {
  /** where the list comes from; the help gives nothing, a test gives its own */
  load?: () => Promise<FeatureClip[]>;
}) => {
  const [clips, setClips] = useState<FeatureClip[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (props.load ?? loadClips)().then((list) => {
      if (alive) {
        setClips(list);
        // the first screen can ask for one clip: it plays at once
        const asked = takePendingClip();

        if (asked && list.some((clip) => clip.id === asked)) {
          setPlaying(asked);
        }
      }
    });

    return () => {
      alive = false;
    };
  }, [props.load]);

  if (!clips || !clips.length) {
    return null;
  }

  const current = clips.find((clip) => clip.id === playing) ?? null;
  const next = current
    ? clips[(clips.indexOf(current) + 1) % clips.length]
    : null;

  return (
    <div className="FeatureClips" data-testid="feature-clips">
      <div className="FeatureClips__title">What this version adds</div>
      {current ? (
        <div className="FeatureClips__player" data-testid="feature-player">
          <div className="FeatureClips__player-head">
            <button
              type="button"
              className="FeatureClips__button"
              data-testid="feature-back"
              onClick={() => setPlaying(null)}
            >
              ← All features
            </button>
            {next && next.id !== current.id && (
              <button
                type="button"
                className="FeatureClips__button"
                data-testid="feature-next"
                onClick={() => setPlaying(next.id)}
              >
                Next: {next.title} →
              </button>
            )}
          </div>
          <video
            key={current.id}
            className="FeatureClips__video"
            data-testid="feature-video"
            src={clipUrl(current.video)}
            poster={clipUrl(current.poster)}
            controls
            autoPlay
            muted
            playsInline
          />
          <div className="FeatureClips__name">{current.title}</div>
          <div className="FeatureClips__line">{current.line}</div>
        </div>
      ) : (
        groupClips(clips).map(({ group, items }) => (
          <div className="FeatureClips__group" key={group}>
            <div className="FeatureClips__group-name">{group}</div>
            {items.map((clip) => (
              <div className="FeatureClips__row" key={clip.id}>
                <img
                  className="FeatureClips__poster"
                  src={clipUrl(clip.poster)}
                  alt=""
                  loading="lazy"
                />
                <div className="FeatureClips__text">
                  <div className="FeatureClips__name">{clip.title}</div>
                  <div className="FeatureClips__line">{clip.line}</div>
                </div>
                <button
                  type="button"
                  className="FeatureClips__button FeatureClips__button--watch"
                  data-testid={`feature-watch-${clip.id}`}
                  onClick={() => setPlaying(clip.id)}
                >
                  Watch · {clipLength(clip.seconds)}
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
};
