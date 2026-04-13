const PANEL_PATH = "sidepanel.html";
const LINEAR_HOST = "linear.app";
const LINEAR_CONTEXT_KEY = "linearTicketSidepanel.liveContext";

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

async function syncTab(tabId, url) {
  const enabled = isLinearUrl(url);
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
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });
  await syncCurrentTabs();
}

async function openForLinearTab(tabId, windowId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isLinearUrl(tab.url)) {
    return;
  }

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

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel();
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
    console.error("failed to sync activated tab", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;

  if (message?.type === "linear-open-sidepanel") {
    if (typeof tabId !== "number" || typeof windowId !== "number") {
      sendResponse({ ok: false, error: "Missing sender tab context." });
      return;
    }

    void Promise.resolve()
      .then(async () => {
        if (message.context) {
          await saveLinearContext(tabId, sender.tab?.url, message.context);
        }
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
});
