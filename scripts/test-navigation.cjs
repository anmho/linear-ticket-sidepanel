const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ts = require("typescript");

const source = readFileSync(path.join(__dirname, "../sidepanel-navigation.ts"), "utf8");
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

const {
  claimIssueNavigationKeydown,
  getIssueNavigationDelta,
  getNextIssueSelectionId,
  isIssueNavigationEditableTarget,
} = context.module.exports;

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
assert.equal(
  getNextIssueSelectionId(issues, "ANM-2", 0),
  "ANM-2",
  "Zero delta should preserve the current selection",
);

assert.equal(getIssueNavigationDelta("ArrowDown"), 1, "ArrowDown should select the next issue");
assert.equal(getIssueNavigationDelta("ArrowUp"), -1, "ArrowUp should select the previous issue");
assert.equal(getIssueNavigationDelta("Enter"), 0, "Non-arrow keys should not navigate issues");

function targetWithClosest(matches) {
  return {
    closest(selector) {
      return matches[selector] || null;
    },
  };
}

function contentEditable(value) {
  return {
    getAttribute(name) {
      return name === "contenteditable" ? value : null;
    },
  };
}

assert.equal(
  isIssueNavigationEditableTarget(targetWithClosest({ "input, textarea, select": {} })),
  true,
  "Arrow keys inside inputs, textareas, and selects should not navigate issues",
);
assert.equal(
  isIssueNavigationEditableTarget(targetWithClosest({ "[contenteditable]": contentEditable("true") })),
  true,
  "Arrow keys inside editable content should not navigate issues",
);
assert.equal(
  isIssueNavigationEditableTarget(targetWithClosest({ "[contenteditable]": contentEditable("false") })),
  false,
  "contenteditable=false targets should not block issue navigation",
);
assert.equal(
  isIssueNavigationEditableTarget(targetWithClosest({})),
  false,
  "Non-editable targets should allow issue navigation",
);
assert.equal(
  isIssueNavigationEditableTarget(null),
  false,
  "Missing targets should allow issue navigation",
);

const keydown = {};
assert.equal(
  claimIssueNavigationKeydown(keydown),
  true,
  "First handler should claim a delivered navigation keydown",
);
assert.equal(
  claimIssueNavigationKeydown(keydown),
  false,
  "A delivered navigation keydown should not be handled twice",
);

console.log("sidepanel navigation checks passed");
