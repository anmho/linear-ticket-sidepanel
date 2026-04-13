const PANEL_PATH = "sidepanel.html";
const LINEAR_HOST = "linear.app";
const LINEAR_CONTEXT_KEY = "linearTicketSidepanel.liveContext";
const SESSION_KEY = "linearTicketSidepanel.researchSession";

// --- URL helpers ---

function isLinearUrl(rawUrl) {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return url.hostname === LINEAR_HOST || url.hostname.endsWith(`.${LINEAR_HOST}`);
  } catch {
    return false;
  }
}

function isCapturable(rawUrl) {
  if (!rawUrl) return false;
  if (rawUrl.startsWith("chrome://") || rawUrl.startsWith("chrome-extension://")) return false;
  if (rawUrl.startsWith("about:") || rawUrl.startsWith("data:")) return false;
  if (isLinearUrl(rawUrl)) return false;
  return true;
}

// --- Side panel tab gating (Linear only) ---

async function syncTab(tabId, url) {
  const enabled = isLinearUrl(url);
  await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled });
  if (enabled) {
    await chrome.action.enable(tabId);
    return;
  }
  await chrome.action.disable(tabId);
}

async function syncCurrentTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) => syncTab(tab.id, tab.url)),
  );
}

async function configureSidePanel() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await syncCurrentTabs();
}

async function openForLinearTab(tabId, windowId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isLinearUrl(tab.url)) return;
  await syncTab(tabId, tab.url);
  await chrome.sidePanel.open({ tabId });
}

async function saveLinearContext(tabId, url, context) {
  await chrome.storage.local.set({
    [LINEAR_CONTEXT_KEY]: {
      ...context,
      tabId,
      url: context?.url || url || "",
      capturedAt: new Date().toISOString(),
    },
  });
}

// --- Research session ---

async function getSession() {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  return stored[SESSION_KEY] || null;
}

async function saveSession(session) {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  // Notify sidepanel if it is open
  chrome.runtime.sendMessage({ type: "session-updated", session }).catch(() => {});
}

// Injects a self-contained function into the tab to extract structured page content.
async function captureTabContent(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isCapturable(tab.url)) return null;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const title = document.title.trim();
        const url = location.href;
        const metaDesc =
          document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ||
          document.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() ||
          "";
        const selectedText = window.getSelection()?.toString().trim() || "";
        const mainEl =
          document.querySelector("article") ||
          document.querySelector("main") ||
          document.querySelector('[role="main"]') ||
          document.body;
        const bodyText = (mainEl?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 800);
        const headings = Array.from(document.querySelectorAll("h1, h2"))
          .map((h) => h.textContent.trim())
          .filter(Boolean)
          .slice(0, 5);
        return { title, url, metaDesc, selectedText, bodyText, headings };
      },
    });

    const data = results?.[0]?.result;
    if (!data?.url) return null;

    return {
      id: `${tabId}-${Date.now()}`,
      tabId,
      capturedAt: new Date().toISOString(),
      included: true,
      title: data.title || tab.title || "Untitled",
      url: data.url,
      metaDesc: data.metaDesc || "",
      selectedText: data.selectedText || "",
      bodyText: data.bodyText || "",
      headings: data.headings || [],
    };
  } catch {
    return null;
  }
}

async function addCaptureToSession(tabId) {
  const session = await getSession();
  if (!session?.active) return;

  const capture = await captureTabContent(tabId);
  if (!capture) return;

  // Skip if the same URL was captured in the last 30 seconds
  const now = Date.now();
  const isDuplicate = session.captures.some(
    (c) => c.url === capture.url && now - new Date(c.capturedAt).getTime() < 30_000,
  );
  if (isDuplicate) return;

  session.captures.push(capture);
  await saveSession(session);
}

async function snapshotOpenTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => isCapturable(tab.url))
    .map((tab) => ({ tabId: tab.id, title: tab.title || "Untitled", url: tab.url }));
}

// --- Listeners ---

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel();
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && info.status !== "complete") return;
  void syncTab(tabId, info.url || tab.url);
  if (info.status === "complete") {
    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
      if (activeTabs[0]?.id === tabId) {
        setTimeout(() => void addCaptureToSession(tabId), 1500);
      }
    });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await syncTab(tabId, tab.url);
    setTimeout(() => void addCaptureToSession(tabId), 1500);
  } catch (error) {
    console.error("failed to sync activated tab", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;

  // --- Linear side panel messages ---

  if (message?.type === "linear-open-sidepanel") {
    if (typeof tabId !== "number" || typeof windowId !== "number") {
      sendResponse({ ok: false, error: "Missing sender tab context." });
      return;
    }
    void Promise.resolve()
      .then(async () => {
        if (message.context) await saveLinearContext(tabId, sender.tab?.url, message.context);
        await openForLinearTab(tabId, windowId);
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
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

  // --- Research session messages ---

  if (message?.type === "session-start") {
    void (async () => {
      const openTabs = await snapshotOpenTabs();
      const session = {
        active: true,
        startedAt: new Date().toISOString(),
        linkedIssue: message.issueContext || null,
        openTabs,
        captures: [],
      };
      await saveSession(session);
      sendResponse({ ok: true, session });
    })();
    return true;
  }

  if (message?.type === "session-stop") {
    void (async () => {
      const session = await getSession();
      if (session) {
        session.active = false;
        await saveSession(session);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === "session-get") {
    void getSession().then((session) => sendResponse({ ok: true, session }));
    return true;
  }

  if (message?.type === "session-clear") {
    void chrome.storage.local.remove(SESSION_KEY).then(() => {
      chrome.runtime.sendMessage({ type: "session-updated", session: null }).catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "session-capture-now") {
    void (async () => {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) await addCaptureToSession(activeTab.id);
      const session = await getSession();
      sendResponse({ ok: true, session });
    })();
    return true;
  }

  if (message?.type === "session-toggle-capture") {
    void (async () => {
      const session = await getSession();
      if (session) {
        const capture = session.captures.find((c) => c.id === message.captureId);
        if (capture) capture.included = !capture.included;
        await saveSession(session);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === "session-remove-capture") {
    void (async () => {
      const session = await getSession();
      if (session) {
        session.captures = session.captures.filter((c) => c.id !== message.captureId);
        await saveSession(session);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});
