const PANEL_PATH = "sidepanel.html";
const LINEAR_HOST = "linear.app";
const LINEAR_CONTEXT_KEY = "linearTicketSidepanel.liveContext";
const RESEARCH_CONTEXT_KEY = "linearTicketSidepanel.researchContext";
const ISSUE_IDENTIFIER_RE = /\b[A-Z]{2,10}-\d+\b/;

const MAX_CAPTURES = 80;
const MAX_SCREENSHOTS = 6;
const MAX_SCREENSHOT_BYTES = 2_200_000;
const MENU_ADD_SELECTION = "linear-sidepanel-add-selection";
const MENU_ADD_PAGE = "linear-sidepanel-add-page";

function errorMessage(error) {
  return String(error?.message || error || "");
}

function isNoTabError(error) {
  return errorMessage(error).includes("No tab with id");
}

function isSidePanelGestureError(error) {
  return errorMessage(error).includes(
    "may only be called in response to a user gesture",
  );
}

function isExpectedRuntimeError(error) {
  return isNoTabError(error) || isSidePanelGestureError(error);
}

function newCaptureId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `cap-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isLinearUrl(rawUrl) {
  if (!rawUrl) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    return url.hostname === LINEAR_HOST || url.hostname.endsWith(`.${LINEAR_HOST}`);
  } catch {
    return false;
  }
}

function isSupportedWebUrl(rawUrl) {
  if (!rawUrl) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function inferIssueIdentifier(...values) {
  const merged = values.join(" ");
  const match = String(merged).toUpperCase().match(ISSUE_IDENTIFIER_RE);
  return match ? match[0] : "";
}

function normalizeCaptureText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 3500);
}

function estimateBytes(dataUrl) {
  if (!dataUrl) {
    return 0;
  }
  return Math.ceil((String(dataUrl).length * 3) / 4);
}

function trimCaptures(captures) {
  const recent = captures.slice(-MAX_CAPTURES);

  let screenshotCount = 0;
  let screenshotBytes = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const capture = recent[index];
    if (!capture.screenshotDataUrl) {
      continue;
    }

    const bytes = estimateBytes(capture.screenshotDataUrl);
    const shouldKeep =
      screenshotCount < MAX_SCREENSHOTS && screenshotBytes + bytes <= MAX_SCREENSHOT_BYTES;

    if (!shouldKeep) {
      delete capture.screenshotDataUrl;
      continue;
    }

    screenshotCount += 1;
    screenshotBytes += bytes;
  }

  return recent;
}

function emptyResearchState() {
  return {
    captures: [],
    activeIssueIdentifier: "",
    activeIssueTitle: "",
    lastUpdated: "",
  };
}

async function readResearchState() {
  const stored = await chrome.storage.local.get(RESEARCH_CONTEXT_KEY);
  const current = stored[RESEARCH_CONTEXT_KEY];
  if (!current || typeof current !== "object") {
    return emptyResearchState();
  }

  return {
    captures: Array.isArray(current.captures) ? current.captures : [],
    activeIssueIdentifier: String(current.activeIssueIdentifier || ""),
    activeIssueTitle: String(current.activeIssueTitle || ""),
    lastUpdated: String(current.lastUpdated || ""),
  };
}

async function writeResearchState(nextState) {
  await chrome.storage.local.set({
    [RESEARCH_CONTEXT_KEY]: {
      captures: trimCaptures(nextState.captures || []),
      activeIssueIdentifier: nextState.activeIssueIdentifier || "",
      activeIssueTitle: nextState.activeIssueTitle || "",
      lastUpdated: nowIso(),
    },
  });
}

async function captureScreenshot(windowId) {
  if (typeof windowId !== "number") {
    return "";
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 55,
    });
    return String(dataUrl || "");
  } catch {
    return "";
  }
}

async function appendCapture(rawCapture, senderTab) {
  const research = await readResearchState();
  const capture = {
    id: newCaptureId(),
    kind: String(rawCapture.kind || "capture"),
    title: String(rawCapture.title || senderTab?.title || "Untitled"),
    url: String(rawCapture.url || senderTab?.url || ""),
    text: normalizeCaptureText(rawCapture.text || rawCapture.pageSnippet || ""),
    issueIdentifierHint: inferIssueIdentifier(
      rawCapture.issueIdentifierHint || "",
      rawCapture.url || senderTab?.url || "",
      rawCapture.title || senderTab?.title || "",
      rawCapture.text || "",
    ),
    capturedAt: nowIso(),
  };

  const previous = research.captures[research.captures.length - 1];
  if (
    previous &&
    previous.url === capture.url &&
    previous.kind === capture.kind &&
    previous.text === capture.text
  ) {
    return research;
  }

  if (rawCapture.withScreenshot) {
    capture.screenshotDataUrl = await captureScreenshot(senderTab?.windowId);
  }

  research.captures.push(capture);

  if (capture.issueIdentifierHint) {
    research.activeIssueIdentifier = capture.issueIdentifierHint;
    if (rawCapture.issueTitle) {
      research.activeIssueTitle = String(rawCapture.issueTitle).slice(0, 160);
    }
  }

  await writeResearchState(research);
  return research;
}

async function bindIssue(issue) {
  const identifier = inferIssueIdentifier(issue?.identifier || "");
  if (!identifier) {
    return;
  }

  const research = await readResearchState();
  research.activeIssueIdentifier = identifier;
  research.activeIssueTitle = String(issue?.title || "").slice(0, 160);
  await writeResearchState(research);
}

async function syncTab(tabId, url) {
  try {
    const enabled = isSupportedWebUrl(url);
    await chrome.sidePanel.setOptions({
      tabId,
      path: PANEL_PATH,
      enabled,
    });

    if (enabled) {
      await chrome.action.enable(tabId);
      return;
    }

    await chrome.action.disable(tabId);
  } catch (error) {
    console.warn("failed to sync tab sidepanel state", { tabId, url, error });
  }
}

async function syncCurrentTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) => syncTab(tab.id, tab.url)),
  );
}

async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    });
    await syncCurrentTabs();
  } catch (error) {
    console.warn("failed to configure sidepanel behavior", error);
  }
}

async function setupContextMenus() {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: MENU_ADD_SELECTION,
      title: "Add Selection to Linear Context",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_ADD_PAGE,
      title: "Add Page to Linear Context",
      contexts: ["page", "link", "image"],
    });
  } catch (error) {
    console.warn("failed to setup context menus", error);
  }
}

async function openForSupportedTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isSupportedWebUrl(tab.url)) {
      return;
    }

    await syncTab(tabId, tab.url);
    await chrome.sidePanel.open({ tabId });
  } catch (error) {
    if (!isExpectedRuntimeError(error)) {
      console.warn("failed to open sidepanel for tab", { tabId, error });
    }
  }
}

async function saveLinearContext(tabId, url, context) {
  await chrome.storage.local.set({
    [LINEAR_CONTEXT_KEY]: {
      ...context,
      tabId,
      url: context?.url || url || "",
      capturedAt: nowIso(),
    },
  });

  if (context?.identifier) {
    await bindIssue({
      identifier: context.identifier,
      title: context.title || "",
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
  void setupContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel();
  void setupContextMenus();
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && info.status !== "complete") {
    return;
  }
  void syncTab(tabId, info.url || tab.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await syncTab(tabId, tab.url);
  } catch (error) {
    if (!isNoTabError(error)) {
      console.warn("failed to sync activated tab", error);
    }
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const isSupportedItem =
    info.menuItemId === MENU_ADD_SELECTION || info.menuItemId === MENU_ADD_PAGE;
  if (!isSupportedItem) {
    return;
  }

  const captureText =
    String(info.selectionText || "").trim() ||
    String(info.linkUrl || "").trim() ||
    String(info.srcUrl || "").trim() ||
    String(info.pageUrl || "").trim();

  if (!captureText && !tab?.url) {
    return;
  }

  void appendCapture(
    {
      kind: "context-menu",
      title: tab?.title || "Captured via context menu",
      url: tab?.url || info.pageUrl || "",
      text: captureText,
      withScreenshot: true,
      issueIdentifierHint: inferIssueIdentifier(
        captureText,
        tab?.title || "",
        tab?.url || "",
      ),
    },
    tab,
  )
    .then(async () => {
      if (typeof tab?.id === "number") {
        await openForSupportedTab(tab.id);
      }
    })
    .catch((error) => {
      console.warn("failed to capture context menu selection", error);
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message?.type === "linear-open-sidepanel") {
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "Missing sender tab context." });
      return;
    }

    void Promise.resolve()
      .then(async () => {
        if (message.context) {
          await saveLinearContext(tabId, sender.tab?.url, message.context);
        }
        await openForSupportedTab(tabId);
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        if (isExpectedRuntimeError(error)) {
          sendResponse({ ok: true, skippedOpen: true, error: String(error) });
          return;
        }
        console.error("failed to open sidepanel", error);
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  if (message?.type === "linear-clear-context") {
    void chrome.storage.local.remove(LINEAR_CONTEXT_KEY).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "research-page-visit") {
    void appendCapture(
      {
        ...(message.capture || {}),
        kind: "visit",
        withScreenshot: false,
      },
      sender.tab,
    )
      .then((research) => sendResponse({ ok: true, research }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "research-capture") {
    void appendCapture(message.capture || {}, sender.tab)
      .then((research) => sendResponse({ ok: true, research }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "research-get-context") {
    void readResearchState()
      .then((research) => sendResponse({ ok: true, research }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "research-clear-context") {
    void chrome.storage.local.remove(RESEARCH_CONTEXT_KEY).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "research-bind-issue") {
    void bindIssue(message.issue || {})
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "research-open-panel") {
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "Missing tab context." });
      return;
    }

    void openForSupportedTab(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        if (isExpectedRuntimeError(error)) {
          sendResponse({ ok: true, skippedOpen: true, error: String(error) });
          return;
        }
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }
});
