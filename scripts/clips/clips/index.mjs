import assistantMcp from "./assistant-mcp.mjs";
import codeEditor from "./code-editor.mjs";
import flowStudio from "./flow-studio.mjs";
import pages from "./pages.mjs";
import pictureCrop from "./picture-crop.mjs";
import presenterSplit from "./presenter-split.mjs";
import stickers from "./stickers.mjs";
import undoPageDelete from "./undo-page-delete.mjs";
import videoSidebar from "./video-sidebar.mjs";
import youtube from "./youtube.mjs";

/** every clip, in the order the help lists them */
export const CLIPS = [
  pages,
  undoPageDelete,
  presenterSplit,
  videoSidebar,
  youtube,
  stickers,
  pictureCrop,
  codeEditor,
  flowStudio,
  assistantMcp,
];
