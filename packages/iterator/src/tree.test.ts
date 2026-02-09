import { expect, test } from "vitest";

import { traverseBfs, traverseDfs } from "./tree";

interface TreeNode {
  value: number;
  children: TreeNode[];
}

test("traverseBfs() traverses tree in breadth-first order", () => {
  const tree: TreeNode = {
    value: 1,
    children: [
      {
        value: 2,
        children: [
          { value: 4, children: [] },
          { value: 5, children: [] },
        ],
      },
      {
        value: 3,
        children: [{ value: 6, children: [] }],
      },
    ],
  };

  const nodes: TreeNode[] = Array.from(
    traverseBfs(tree, (n: TreeNode) => n.children),
  );
  const values = nodes.map((n) => n.value);
  expect(values).toEqual([1, 2, 3, 4, 5, 6]);
});

test("traverseBfs() handles single node", () => {
  const tree: TreeNode = { value: 1, children: [] };
  const nodes: TreeNode[] = Array.from(
    traverseBfs(tree, (n: TreeNode) => n.children),
  );
  const values = nodes.map((n) => n.value);
  expect(values).toEqual([1]);
});

test("traverseDfs() traverses tree in depth-first order", () => {
  const tree: TreeNode = {
    value: 1,
    children: [
      {
        value: 2,
        children: [
          { value: 4, children: [] },
          { value: 5, children: [] },
        ],
      },
      {
        value: 3,
        children: [{ value: 6, children: [] }],
      },
    ],
  };

  const nodes: TreeNode[] = Array.from(
    traverseDfs(tree, (n: TreeNode) => n.children),
  );
  const values = nodes.map((n) => n.value);
  expect(values).toEqual([1, 2, 4, 5, 3, 6]);
});

test("traverseDfs() handles single node", () => {
  const tree: TreeNode = { value: 1, children: [] };
  const nodes: TreeNode[] = Array.from(
    traverseDfs(tree, (n: TreeNode) => n.children),
  );
  const values = nodes.map((n) => n.value);
  expect(values).toEqual([1]);
});

test("traverseDfs() handles linear tree", () => {
  const tree: TreeNode = {
    value: 1,
    children: [
      {
        value: 2,
        children: [
          {
            value: 3,
            children: [],
          },
        ],
      },
    ],
  };
  const nodes: TreeNode[] = Array.from(
    traverseDfs(tree, (n: TreeNode) => n.children),
  );
  const values = nodes.map((n) => n.value);
  expect(values).toEqual([1, 2, 3]);
});
