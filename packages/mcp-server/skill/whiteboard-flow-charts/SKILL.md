---
name: whiteboard-flow-charts
description: How to make a flow chart that teaches: choosing the kind, writing the script, keeping it small, checking it before it is drawn. Load it before create_flow_chart.
---

# Flow charts that teach

A flow chart is also the animation: it is walked step by step in the order its script is written. Write the script in the order the teacher will say it.

## Steps

1. Call `flow_kinds` once. It lists every kind with an example script and says how a script is written. Copy the shape of the example for the kind you pick.
2. Pick the kind by the story: `process` for steps one after another, `decision` for yes and no, `cycle` for something that repeats, `hierarchy` for a tree, `network` for things joined in any way, `timeline` for time, `matrix` for two by two, `pyramid` and `funnel` for levels that narrow, `list` and `grid` for sets.
3. Write the script. Call `check_flow_script` with the same kind and script before you make it: it says how many nodes and pages there would be and what is wrong with each line.
4. Call `create_flow_chart`. Then `list_flow_charts` for the chartId you need to play or export it, and `check_page`.

## Keep it small

- 4 to 9 nodes. With `fit` set to `larger` up to about 15. More than that: make two charts.
- A label of at most 4 words, 24 characters. The detail goes in the words beside the chart, not in the node.
- One idea per node, and one verb where it is a step: 'Add to back', 'Remove from front'.

## A tree (the `hierarchy` kind)

One node a line, and the indent says how deep it is: a tab or two spaces for each level. The first line is the root. A line is one level under the line above it at most. The layout puts a single child in the middle, so when a node has only a right child, add a leaf called 'null' on the left on purpose: the students see that the slot is empty.

## When it goes wrong

If `check_flow_script` finds a problem, change the script and check again. Do not draw the chart by hand to get round it.
