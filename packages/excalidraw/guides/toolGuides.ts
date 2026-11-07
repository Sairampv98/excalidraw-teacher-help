/**
 * The guide of a tool: what it is for, how to use it in three moves, and one
 * thing that is easy to miss. The help icon shows the guide of the tool in use.
 */

export type ToolGuide = {
  /** what the tool is, in the words of the toolbar */
  title: string;
  /** what it does, in a sentence */
  summary: string;
  /** how to use it, one move at a time */
  steps: string[];
  /** one thing that is easy to miss */
  tip?: string;
};

export const TOOL_GUIDES: Record<string, ToolGuide> = {
  selection: {
    title: "Select",
    summary: "Pick things on the board to move, resize, copy or change them.",
    steps: [
      "Click a shape to pick it, or drag a box around several.",
      "Drag it to move it, drag a corner to resize it.",
      "Press Delete to remove it, or Ctrl+D to copy it.",
    ],
    tip: "Hold Shift to add to what is picked.",
  },
  lasso: {
    title: "Lasso",
    summary: "Pick things by drawing around them freely.",
    steps: [
      "Drag a loop around the things you want.",
      "Let go: everything inside the loop is picked.",
      "Move or change them together.",
    ],
  },
  rectangle: {
    title: "Rectangle",
    summary: "Draw boxes: a node, a card, a frame around an idea.",
    steps: [
      "Drag on the board to draw the box.",
      "Double-click inside it to type a label.",
      "Pick it and use the panel on the left to change colour and edges.",
    ],
    tip: "Hold Shift to draw a square.",
  },
  diamond: {
    title: "Diamond",
    summary: "Draw a diamond, the shape of a decision in a flowchart.",
    steps: [
      "Drag on the board to draw it.",
      "Double-click inside to write the question.",
      "Join it to other shapes with arrows.",
    ],
  },
  ellipse: {
    title: "Ellipse",
    summary: "Draw circles and ovals: states, sets, a pointer.",
    steps: [
      "Drag on the board to draw it.",
      "Double-click inside to type a label.",
      "Hold Shift for a perfect circle.",
    ],
  },
  arrow: {
    title: "Arrow",
    summary: "Join things and show which way something goes.",
    steps: [
      "Drag from one shape to another.",
      "The arrow sticks to the shapes and follows them when they move.",
      "Double-click the arrow to write on it.",
    ],
    tip: "Click once for a corner, to bend the arrow.",
  },
  line: {
    title: "Line",
    summary: "Draw a straight line, or a line with corners.",
    steps: [
      "Drag on the board to draw it.",
      "Click again to add a corner, press Enter to finish.",
      "Pick it to move the corners.",
    ],
  },
  freedraw: {
    title: "Pen",
    summary: "Write and draw freely, as on a whiteboard.",
    steps: [
      "Draw with the mouse, the pen or your finger.",
      "Press E to rub out what you did not mean.",
      "Pick what you drew to move it as one piece.",
    ],
    tip: "With a drawing tablet the pen's pressure is used.",
  },
  text: {
    title: "Text",
    summary: "Put words anywhere on the board.",
    steps: [
      "Click where you want the words, and type.",
      "Click outside to finish.",
      "Double-click the text to change it later.",
    ],
  },
  image: {
    title: "Image",
    summary: "Put a picture on the board.",
    steps: [
      "Choose a picture from this computer.",
      "Click on the board to put it down.",
      "Drag a corner to resize it.",
    ],
    tip: "You can also paste a picture, or drop one onto the board.",
  },
  eraser: {
    title: "Eraser",
    summary: "Rub out whole shapes by touching them.",
    steps: [
      "Drag across what you want to remove.",
      "Things you touch fade, and go when you let go.",
      "Press Ctrl+Z if you took too much.",
    ],
  },
  hand: {
    title: "Hand",
    summary: "Move the view around the board without touching anything.",
    steps: [
      "Drag the board to move around.",
      "Scroll to zoom in and out.",
      "Hold Space with any tool to use the hand for a moment.",
    ],
  },
  frame: {
    title: "Frame",
    summary: "Group things in a frame: a slide, a section, a page of notes.",
    steps: [
      "Drag a frame around the things you want to group.",
      "Name it by clicking its title.",
      "Move the frame and everything inside it moves too.",
    ],
  },
  laser: {
    title: "Laser pointer",
    summary: "Point at things while you teach, without leaving marks.",
    steps: [
      "Drag over what you are talking about.",
      "The trail glows, then fades by itself.",
      "Nothing is added to the board.",
    ],
    tip: "It shows in the presenter window too.",
  },
};

export const guideForTool = (tool: string | null | undefined) =>
  (tool && TOOL_GUIDES[tool]) || null;
