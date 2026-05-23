import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import ts from "typescript";

const source = await readFile(new URL("../sidepanel-navigation.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const context = {
  exports: {},
  module: { exports: {} },
};
context.exports = context.module.exports;
vm.runInNewContext(outputText, context, { filename: "sidepanel-navigation.js" });

const { getNextIssueSelectionId } = context.module.exports;

const issues = [{ id: "ANM-1" }, { id: "ANM-2" }, { id: "ANM-3" }];

assert.equal(
  getNextIssueSelectionId(issues, "ANM-1", 1),
  "ANM-2",
  "ArrowDown should move exactly one issue down",
);
assert.equal(
  getNextIssueSelectionId(issues, "ANM-1", 10),
  "ANM-2",
  "Any positive delta should still move exactly one issue down",
);
assert.equal(
  getNextIssueSelectionId(issues, "ANM-3", -1),
  "ANM-2",
  "ArrowUp should move exactly one issue up",
);
assert.equal(
  getNextIssueSelectionId(issues, "ANM-3", -10),
  "ANM-2",
  "Any negative delta should still move exactly one issue up",
);
assert.equal(
  getNextIssueSelectionId(issues, "ANM-3", 1),
  "ANM-3",
  "ArrowDown should clamp at the last issue",
);
assert.equal(
  getNextIssueSelectionId(issues, "ANM-1", -1),
  "ANM-1",
  "ArrowUp should clamp at the first issue",
);
assert.equal(
  getNextIssueSelectionId(issues, "", 1),
  "ANM-1",
  "ArrowDown with no current selection should choose the first issue",
);
assert.equal(
  getNextIssueSelectionId(issues, "", -1),
  "ANM-1",
  "ArrowUp with no current selection should choose the first issue",
);
assert.equal(
  getNextIssueSelectionId([], "ANM-1", 1),
  "",
  "Empty issue lists should have no next selection",
);

console.log("sidepanel navigation checks passed");
