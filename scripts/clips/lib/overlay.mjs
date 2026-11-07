// What a viewer needs to follow a recording of the real app: a caption bar and a visible pointer.
// Both are drawn inside the page, so they are in the film.

/** the script that is run in the page before the app starts */
export const overlayScript = () => {
  const DOT = "__clip_pointer";
  const BAR = "__clip_caption";

  const ready = () => {
    if (document.getElementById(DOT)) {
      return;
    }

    const style = document.createElement("style");

    style.textContent = `
      #${DOT} { position: fixed; z-index: 2147483646; width: 22px; height: 22px; margin: -4px 0 0 -4px;
        border-radius: 50%; background: rgba(105, 101, 219, 0.35); border: 2px solid #6965db;
        pointer-events: none; transition: transform .08s ease, background .08s ease; left: -40px; top: -40px; }
      #${DOT}.down { transform: scale(0.6); background: rgba(105, 101, 219, 0.8); }
      #${BAR} { position: fixed; z-index: 2147483647; left: 50%; bottom: 74px; transform: translateX(-50%);
        max-width: min(80vw, 900px); padding: 10px 20px; border-radius: 12px; background: rgba(20, 20, 30, 0.88);
        color: #fff; font: 600 20px/1.35 system-ui, "Segoe UI", sans-serif; text-align: center; pointer-events: none;
        opacity: 0; transition: opacity .25s ease; }
      #${BAR}.on { opacity: 1; }
    `;
    document.head.appendChild(style);

    const dot = document.createElement("div");

    dot.id = DOT;
    document.body.appendChild(dot);

    const bar = document.createElement("div");

    bar.id = BAR;
    document.body.appendChild(bar);

    window.addEventListener(
      "mousemove",
      (event) => {
        dot.style.left = `${event.clientX}px`;
        dot.style.top = `${event.clientY}px`;
      },
      true,
    );
    window.addEventListener("mousedown", () => dot.classList.add("down"), true);
    window.addEventListener(
      "mouseup",
      () => dot.classList.remove("down"),
      true,
    );

    window.__clipCaption = (text) => {
      if (text) {
        bar.textContent = text;
        bar.classList.add("on");
      } else {
        bar.classList.remove("on");
      }
    };
  };

  if (document.body) {
    ready();
  } else {
    document.addEventListener("DOMContentLoaded", ready);
  }
};
