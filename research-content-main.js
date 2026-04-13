const ISSUE_IDENTIFIER_RE = /\b[A-Z]{2,10}-\d+\b/;
const SHARE_BUTTON_ID = "linear-sidepanel-share-context";
const SHARE_TOAST_ID = "linear-sidepanel-share-toast";

let selectedTextCache = "";
let shareButton = null;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function inferIssueIdentifier(text) {
  const match = String(text || "").toUpperCase().match(ISSUE_IDENTIFIER_RE);
  return match ? match[0] : "";
}

function extractMainText(maxLength = 900) {
  const candidates = [
    document.querySelector("main"),
    document.querySelector("article"),
    document.querySelector("[role='main']"),
    document.body,
  ];

  for (const node of candidates) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const text = normalizeText(node.innerText || "");
    if (text.length > 120) {
      return text.slice(0, maxLength);
    }
  }

  return "";
}

function metaDescription() {
  const tag = document.querySelector('meta[name="description"]');
  if (!(tag instanceof HTMLMetaElement)) {
    return "";
  }
  return normalizeText(tag.content || "");
}

function showToast(message) {
  let toast = document.getElementById(SHARE_TOAST_ID);
  if (!(toast instanceof HTMLDivElement)) {
    toast = document.createElement("div");
    toast.id = SHARE_TOAST_ID;
    toast.style.position = "fixed";
    toast.style.bottom = "22px";
    toast.style.right = "22px";
    toast.style.zIndex = "2147483647";
    toast.style.padding = "9px 11px";
    toast.style.borderRadius = "10px";
    toast.style.fontSize = "12px";
    toast.style.fontFamily = "Inter, SF Pro Text, Segoe UI, sans-serif";
    toast.style.background = "rgba(31, 36, 57, 0.94)";
    toast.style.color = "#f8f9ff";
    toast.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.28)";
    document.documentElement.append(toast);
  }

  toast.textContent = message;
  toast.hidden = false;

  window.setTimeout(() => {
    const current = document.getElementById(SHARE_TOAST_ID);
    if (current instanceof HTMLElement) {
      current.hidden = true;
    }
  }, 1800);
}

function ensureShareButton() {
  if (shareButton instanceof HTMLButtonElement) {
    return shareButton;
  }

  const existing = document.getElementById(SHARE_BUTTON_ID);
  if (existing instanceof HTMLButtonElement) {
    shareButton = existing;
    return shareButton;
  }

  shareButton = document.createElement("button");
  shareButton.id = SHARE_BUTTON_ID;
  shareButton.type = "button";
  shareButton.textContent = "Add to Linear Context";
  shareButton.style.position = "fixed";
  shareButton.style.zIndex = "2147483647";
  shareButton.style.padding = "7px 10px";
  shareButton.style.borderRadius = "999px";
  shareButton.style.border = "1px solid rgba(141, 149, 219, 0.78)";
  shareButton.style.background = "rgba(65, 78, 205, 0.96)";
  shareButton.style.color = "#f8f9ff";
  shareButton.style.fontSize = "12px";
  shareButton.style.fontWeight = "600";
  shareButton.style.fontFamily = "Inter, SF Pro Text, Segoe UI, sans-serif";
  shareButton.style.cursor = "pointer";
  shareButton.style.boxShadow = "0 8px 20px rgba(0, 0, 0, 0.25)";
  shareButton.style.display = "none";

  shareButton.addEventListener("click", () => {
    const text = normalizeText(selectedTextCache).slice(0, 1800);
    if (!text) {
      hideShareButton();
      return;
    }

    void captureAndShare({
      kind: "selection",
      text,
      withScreenshot: true,
    }).then(() => {
      showToast("Added selection to Linear context.");
      hideShareButton();
      selectedTextCache = "";
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
    });
  });

  document.documentElement.append(shareButton);
  return shareButton;
}

function hideShareButton() {
  const button = ensureShareButton();
  button.style.display = "none";
}

function showShareButtonNear(rect, text) {
  const button = ensureShareButton();
  selectedTextCache = text;

  const top = Math.max(8, Math.min(window.innerHeight - 44, rect.bottom + 8));
  const left = Math.max(8, Math.min(window.innerWidth - 190, rect.left));

  button.style.top = `${top}px`;
  button.style.left = `${left}px`;
  button.style.display = "inline-flex";
}

async function captureAndShare({ kind, text, withScreenshot, issueIdentifier, issueTitle }) {
  const normalizedText = normalizeText(text).slice(0, 2200);
  const issueIdentifierHint =
    issueIdentifier || inferIssueIdentifier(`${location.href} ${document.title} ${normalizedText}`);

  const response = await chrome.runtime.sendMessage({
    type: "research-capture",
    capture: {
      kind,
      title: document.title || "Untitled",
      url: location.href,
      text: normalizedText || extractMainText(),
      pageSnippet: extractMainText(),
      issueIdentifierHint,
      issueTitle: issueTitle || "",
      withScreenshot: Boolean(withScreenshot),
    },
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to capture context.");
  }

  return response;
}

function captureFromAltClick(target) {
  if (!(target instanceof Element)) {
    return;
  }

  const lines = [];
  let current = target;
  let depth = 0;
  while (current && depth < 4) {
    lines.push(normalizeText(current.textContent || ""));
    current = current.parentElement;
    depth += 1;
  }

  const text = lines.filter(Boolean).join(" ").slice(0, 1800);
  if (!text) {
    return;
  }

  void captureAndShare({
    kind: "alt-click",
    text,
    withScreenshot: true,
  })
    .then(() => showToast("Added clicked context to Linear session."))
    .catch(() => {
      // no-op
    });
}

function reportPageVisit() {
  const markerKey = `linear-sidepanel-visit:${location.href}`;
  if (sessionStorage.getItem(markerKey)) {
    return;
  }

  sessionStorage.setItem(markerKey, String(Date.now()));

  const snippet =
    normalizeText(metaDescription()) ||
    normalizeText(extractMainText(600)) ||
    normalizeText(document.title);

  void chrome.runtime
    .sendMessage({
      type: "research-page-visit",
      capture: {
        kind: "visit",
        title: document.title || "Untitled",
        url: location.href,
        text: snippet,
        issueIdentifierHint: inferIssueIdentifier(`${location.href} ${document.title}`),
      },
    })
    .catch(() => {
      // no-op
    });
}

function bindIssueHintFromPage() {
  const identifier = inferIssueIdentifier(`${location.href} ${document.title}`);
  if (!identifier) {
    return;
  }

  void chrome.runtime.sendMessage({
    type: "research-bind-issue",
    issue: {
      identifier,
      title: normalizeText(document.title).slice(0, 160),
    },
  });
}

function wireSelectionCapture() {
  document.addEventListener("selectionchange", () => {
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = normalizeText(selection?.toString() || "");
      if (!text || text.length < 12) {
        hideShareButton();
        return;
      }

      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range) {
        hideShareButton();
        return;
      }

      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        hideShareButton();
        return;
      }

      showShareButtonNear(rect, text);
    }, 0);
  });

  document.addEventListener("scroll", () => hideShareButton(), true);

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      !target.closest(`#${SHARE_BUTTON_ID}`) &&
      !(event.altKey && target instanceof HTMLElement)
    ) {
      hideShareButton();
    }

    if (event.altKey) {
      captureFromAltClick(target);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "research-capture-now") {
    const selection = normalizeText(window.getSelection()?.toString() || "");
    const payloadText = selection || extractMainText();

    captureAndShare({
      kind: "manual",
      text: payloadText,
      withScreenshot: Boolean(message.withScreenshot),
      issueIdentifier: message.issueIdentifier || "",
      issueTitle: message.issueTitle || "",
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }
});

reportPageVisit();
bindIssueHintFromPage();
wireSelectionCapture();
