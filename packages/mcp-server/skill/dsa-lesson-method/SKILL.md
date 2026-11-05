---
name: dsa-lesson-method
description: The teacher's method for teaching a data structure to beginners in C, C++, Python and Java, with the order of topics, the minutes, the code rules and a list of problems. Load it before you make any data structure lesson.
---

# The method for a data structure lesson

This is how this teacher teaches, and how every lesson you make should run. Each topic is a run of the steps below; each step is a page or two. Load the voice the audience wants (`voice-fast-and-funny`, `voice-rigorous` or `voice-balanced`) and the page layout (`lesson-page-format`) as well.

## The steps

1. **The pain.** A problem that is slow or ugly without the structure. A short brute-force solution first, so the class feels the cost. (This is the hook: they should want the structure before they meet it.)
2. **What it is.** The structure, named, in one sentence. A real-world use.
3. **Build it from the ground.** With the primitive types of the language: an array and two integers, or nodes that point to each other. If a second version is built from a type that was itself built from primitives, show that too.
4. **Two versions, side by side.** The advantages and the disadvantages of each, in a table.
5. **Live code.** The operations one by one, with a trace. The teacher types the code in one language; the same code is on the page in the other three.
6. **The problem again.** The same problem, now with the structure. What it buys: say the cost before and after.
7. **How it connects.** To the structures the students already have, and to the ones they will meet.
8. **Variations and what depends on it.** The special versions and the algorithms that use it.
9. **The next problem.** A new one, and begin again at step 1.

## Order and time (six hours, four topics)

| Order | Topic | Minutes | Why here |
| --- | --- | --- | --- |
| 1 | Queue | 60 | Simple, and breadth-first search needs it. |
| 2 | Tree | 90 | Introduces nodes that point, recursion and the breadth-first walk. |
| 3 | Trie | 60 | A tree whose nodes hold letters. |
| 4 | Graph | 100 | The last: trees with loops, using the queue again. |
|  | Breaks and recap | 50 | Ten minutes of break in each hour, ten of recap at the end. |

## Real-world uses to open with

- Queue: a printer's jobs, a ticket counter, the order requests reach a server.
- Tree: folders on a disk, the structure of a web page, a family tree.
- Trie: autocomplete, spell check, a phone's contacts.
- Graph: a map and its roads, friends on a network, courses and what must come first.

## Problems (number and name; write the explanation yourself)

- Queue: 232 Implement Queue using Stacks, 933 Number of Recent Calls, 622 Design Circular Queue, 239 Sliding Window Maximum (the deque, as an extension).
- Tree: 104 Maximum Depth of Binary Tree, 102 Binary Tree Level Order Traversal, 98 Validate Binary Search Tree, 235 Lowest Common Ancestor of a BST.
- Trie: 208 Implement Trie, 14 Longest Common Prefix, 1268 Search Suggestions System, 212 Word Search II (as an extension).
- Graph: 733 Flood Fill, 200 Number of Islands, 207 Course Schedule, 785 Is Graph Bipartite, 1091 Shortest Path in Binary Matrix.

## The code

- **Run it before you show it.** Every program is compiled or run, and the output is what the page says. A page with code that was not run is a page with a bug in it.
- **The same program in four languages:** the same names (enqueue, dequeue, peek, isEmpty), the same order of operations, the same example data, the same output.
- **Plain and old-fashioned,** so that it runs on an old computer. C: C99 with `gcc -Wall`. C++: C++11 with `g++ -std=c++11 -Wall`. Python: runs on Python 3.4, so no f-strings and no type hints. Java: runs on Java 8, so no `var` and no records.
- **Primitive first.** No library queue, stack or tree in the build-it step. The library version comes after, as 'what you would use at work'.
- **Short.** A function fits on a slide. Comments say why, not what.
- **Show the failure.** One run that dequeues from an empty queue, and what the code does about it.
