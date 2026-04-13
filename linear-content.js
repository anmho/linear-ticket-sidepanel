const OPEN_DEBOUNCE_MS = 1200;
const ISSUE_IDENTIFIER_RE = /\b[A-Z]{2,10}-\d+\b/;
let lastOpenAt = 0;

function now() {
  return Date.now();
}

function shouldOpen() {
  const current = now();
  if (current - lastOpenAt < OPEN_DEBOUNCE_MS) {
    return false;
  }
  lastOpenAt = current;
  return true;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function cleanLines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectHints(node) {
  const hints = [];
  let current = node instanceof Element ? node : null;
  let depth = 0;

  while (current && depth < 5) {
    hints.push(
      current.getAttribute("aria-label"),
      current.getAttribute("title"),
      current.getAttribute("data-testid"),
      current.getAttribute("href"),
      current instanceof HTMLElement ? current.innerText : null,
    );
    current = current.parentElement;
    depth += 1;
  }

  return normalizeText(hints.filter(Boolean).join(" "));
}

function collectRawHints(node) {
  const hints = [];
  let current = node instanceof Element ? node : null;
  let depth = 0;

  while (current && depth < 5) {
    hints.push(
      current.getAttribute("aria-label"),
      current.getAttribute("title"),
      current.getAttribute("data-testid"),
      current.getAttribute("href"),
      current instanceof HTMLElement ? current.innerText : null,
    );
    current = current.parentElement;
    depth += 1;
  }

  return cleanLines(hints.filter(Boolean).join("\n"));
}

function isIssueCreationTriggerText(hints) {
  return (
    hints.includes("new issue") ||
    hints.includes("create issue") ||
    hints.includes("add issue") ||
    hints.includes("sub-issue") ||
    hints.includes("/view/new") ||
    hints.includes("/new") ||
    hints.includes("issue title")
  );
}

function isIssueEditTriggerText(hints) {
  return (
    ISSUE_IDENTIFIER_RE.test(hints.toUpperCase()) ||
    hints.includes("/issue/") ||
    hints.includes("edit issue") ||
    hints.includes("open issue") ||
    hints.includes("issue detail") ||
    hints.includes("issue details")
  );
}

function isIssueEditorField(target) {
  if (
    !target.matches('input, textarea, [contenteditable="true"], [role="textbox"]')
  ) {
    return false;
  }

  const selfHints = normalizeText(
    [
      target.getAttribute("aria-label"),
      target.getAttribute("placeholder"),
      target.getAttribute("name"),
      target.getAttribute("data-testid"),
      target.textContent,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (
    selfHints.includes("issue title") ||
    selfHints.includes("add description") ||
    selfHints.includes("description (optional)") ||
    selfHints.includes("edit issue")
  ) {
    return true;
  }

  const containerHints = collectHints(target);
  return (
    isIssueCreationTriggerText(containerHints) ||
    isIssueEditTriggerText(containerHints)
  );
}

function readFieldValue(field) {
  if (!field) {
    return "";
  }
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return field.value.trim();
  }
  return field.textContent?.trim() || "";
}

function findField(predicate) {
  const fields = document.querySelectorAll(
    'input, textarea, [contenteditable="true"], [role="textbox"]',
  );
  for (const field of fields) {
    if (!(field instanceof HTMLElement)) {
      continue;
    }
    if (predicate(field)) {
      return field;
    }
  }
  return null;
}

function findIssueTitleField() {
  return findField((field) =>
    normalizeText(
      [
        field.getAttribute("aria-label"),
        field.getAttribute("placeholder"),
        field.getAttribute("name"),
        field.getAttribute("data-testid"),
      ]
        .filter(Boolean)
        .join(" "),
    ).includes("issue title"),
  );
}

function findIssueDescriptionField() {
  return findField((field) => {
    const hints = normalizeText(
      [
        field.getAttribute("aria-label"),
        field.getAttribute("placeholder"),
        field.getAttribute("name"),
        field.getAttribute("data-testid"),
      ]
        .filter(Boolean)
        .join(" "),
    );
    return (
      hints.includes("description") ||
      hints.includes("add description") ||
      hints.includes("description (optional)")
    );
  });
}

function extractIdentifier(text) {
  const match = String(text || "").toUpperCase().match(ISSUE_IDENTIFIER_RE);
  return match ? match[0] : "";
}

function deriveTitleFromRawLines(lines, identifier) {
  for (const line of lines) {
    const lower = normalizeText(line);
    if (!lower) {
      continue;
    }
    if (identifier && lower === identifier.toLowerCase()) {
      continue;
    }
    if (
      lower === "new issue" ||
      lower === "create issue" ||
      lower === "issue title" ||
      lower === "add description..." ||
      lower === "description (optional)"
    ) {
      continue;
    }
    if (extractIdentifier(line) && line.trim().length <= 20) {
      continue;
    }
    return line.trim();
  }
  return "";
}

function extractTeamKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts[0] || "";
  } catch {
    return "";
  }
}

function buildContextSnapshot(target, source) {
  const normalizedHints = target ? collectHints(target) : "";
  const rawLines = target ? collectRawHints(target) : [];
  const issueTitleField = findIssueTitleField();
  const issueDescriptionField = findIssueDescriptionField();
  const titleValue = readFieldValue(issueTitleField);
  const descriptionValue = readFieldValue(issueDescriptionField);
  const identifier =
    extractIdentifier(rawLines.join("\n")) ||
    extractIdentifier(location.href) ||
    extractIdentifier(document.title);

  let mode = "browse";
  if (
    isIssueCreationTriggerText(normalizedHints) ||
    location.pathname.includes("/view/new")
  ) {
    mode = "create";
  } else if (
    isIssueEditTriggerText(normalizedHints) ||
    identifier ||
    titleValue ||
    descriptionValue
  ) {
    mode = "edit";
  }

  const title =
    titleValue ||
    deriveTitleFromRawLines(rawLines, identifier) ||
    document.title.replace(/\s+[·|-]\s+Linear.*$/i, "").trim();

  return {
    mode,
    identifier,
    title,
    description: descriptionValue,
    url: location.href,
    teamKey: extractTeamKeyFromUrl(location.href),
    source,
  };
}

function requestOpen(target, source) {
  if (!shouldOpen()) {
    return;
  }
  void chrome.runtime.sendMessage({
    type: "linear-open-sidepanel",
    context: buildContextSnapshot(target, source),
  });
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const hints = collectHints(target);
    if (isIssueCreationTriggerText(hints) || isIssueEditTriggerText(hints)) {
      requestOpen(target, "click");
    }
  },
  true,
);

document.addEventListener(
  "focusin",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (isIssueEditorField(target)) {
      requestOpen(target, "focus");
    }
  },
  true,
);

async function linearSessionFetch(query, variables) {
  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json();
    if (!response.ok) {
      return { ok: false, error: payload?.errors?.[0]?.message || "Request failed" };
    }
    if (payload.errors?.length) {
      return { ok: false, error: payload.errors[0].message };
    }
    return { ok: true, data: payload.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "linear-context-request") {
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sendResponse({
      ok: true,
      context: buildContextSnapshot(activeElement, "request"),
    });
    return;
  }

  if (message?.type === "linear-api-request") {
    linearSessionFetch(message.query, message.variables || {}).then(sendResponse);
    return true; // async response
  }
});
