import { useAtomValue } from "../app-jotai";
import { ocrProgressAtom } from "../app-jotai";

/**
 * What an OCR read is doing, on the screen (D-288): the step and a bar that
 * fills, with a way to stop it. A read that downloads its engine for the first
 * time takes a while, and a button that seems to do nothing is worse than a bar.
 */
export const OcrProgressBar = ({ onCancel }: { onCancel?: () => void }) => {
  const progress = useAtomValue(ocrProgressAtom);

  if (!progress) {
    return null;
  }

  const percent =
    progress.fraction === null ? null : Math.round(progress.fraction * 100);

  return (
    <div
      className="app-ocr-progress"
      data-testid="ocr-progress"
      role="status"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 80,
        transform: "translateX(-50%)",
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 12,
        minWidth: 320,
        padding: "10px 14px",
        borderRadius: 10,
        background: "var(--island-bg-color, #fff)",
        boxShadow: "0 2px 14px rgba(0,0,0,0.3)",
      }}
    >
      <div style={{ flex: 1 }}>
        <div data-testid="ocr-progress-label">
          {progress.label}
          {percent === null ? "..." : ` ${percent}%`}
        </div>
        <progress
          data-testid="ocr-progress-bar"
          style={{ width: "100%" }}
          {...(percent === null ? {} : { value: percent, max: 100 })}
        />
      </div>
      {onCancel ? (
        <button type="button" onClick={onCancel}>
          Stop
        </button>
      ) : null}
    </div>
  );
};
