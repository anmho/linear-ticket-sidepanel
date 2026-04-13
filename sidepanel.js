const LINEAR_API_URL = "https://api.linear.app/graphql";
const SETTINGS_KEY = "linearTicketSidepanel.settings";
const LINEAR_CONTEXT_KEY = "linearTicketSidepanel.liveContext";
const DEFAULT_STATUS =
  "Open linear.app to load issues automatically — no API key needed.";
const DEFAULT_DESCRIPTION = `## Summary

Describe the bug, opportunity, or task.

## Page Context

- Title: {{title}}
- URL: {{url}}

## Notes

- Why this page matters:
- Desired outcome:
`;
const DEFAULT_VIBE_PROMPT = `Use the active page context${"{issue_clause}"} to propose the next implementation step, missing context to gather, and a concise execution plan.`;

const state = {
  settings: {
    apiKey: "",
    defaultTeamId: "",
    proxyUrl: "",
    proxyToken: "",
  },
  teams: [],
  issues: [],
  currentTab: null,
  selectedIssueId: "",
  sessionContext: null,
};

const elements = {
  apiKey: document.querySelector("#api-key"),
  teamSelect: document.querySelector("#team-select"),
  proxyUrl: document.querySelector("#proxy-url"),
  proxyToken: document.querySelector("#proxy-token"),
  settingsForm: document.querySelector("#settings-form"),
  clearSettings: document.querySelector("#clear-settings"),
  statusMessage: document.querySelector("#status-message"),
  refreshAll: document.querySelector("#refresh-all"),
  refreshTab: document.querySelector("#refresh-tab"),
  tabContext: document.querySelector("#tab-context"),
  selectedIssue: document.querySelector("#selected-issue"),
  vibeForm: document.querySelector("#vibe-form"),
  vibePrompt: document.querySelector("#vibe-prompt"),
  copyContext: document.querySelector("#copy-context"),
  sendProxy: document.querySelector("#send-proxy"),
  proxyResponse: document.querySelector("#proxy-response"),
  issueForm: document.querySelector("#issue-form"),
  issueTitle: document.querySelector("#issue-title"),
  issueDescription: document.querySelector("#issue-description"),
  linearNewLink: document.querySelector("#linear-new-link"),
  createdIssue: document.querySelector("#created-issue"),
  issuesList: document.querySelector("#issues-list"),
  issueCount: document.querySelector("#issue-count"),
};

function setStatus(message, tone = "neutral") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.tone = tone;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getTabTitle(tab) {
  return tab?.title?.trim() || "Untitled page";
}

function getTabUrl(tab) {
  return tab?.url?.trim() || "Unavailable";
}

function getSelectedIssue() {
  return state.issues.find((issue) => issue.id === state.selectedIssueId) || null;
}

function getSessionIssue() {
  if (!state.sessionContext) {
    return null;
  }

  return {
    id: `session:${state.sessionContext.tabId || "current"}`,
    identifier:
      state.sessionContext.identifier ||
      (state.sessionContext.mode === "create" ? "Draft" : "Linear"),
    title:
      state.sessionContext.title ||
      (state.sessionContext.mode === "create"
        ? "New issue draft"
        : "Active Linear issue"),
    url: state.sessionContext.url || getTabUrl(state.currentTab),
    state: {
      name: state.sessionContext.mode === "create" ? "Draft" : "Live page",
    },
    team: {
      name: state.sessionContext.teamKey || "Linear session",
    },
  };
}

function getTeamName(teamId) {
  return state.teams.find((team) => team.id === teamId)?.name || "No team selected";
}

function getTeamKey(teamId) {
  return state.teams.find((team) => team.id === teamId)?.key || "";
}

function hydrateDescriptionTemplate(title, url) {
  return DEFAULT_DESCRIPTION.replace("{{title}}", title).replace("{{url}}", url);
}

function buildDefaultVibePrompt() {
  const issue = getSelectedIssue() || getSessionIssue();
  const issueClause = issue
    ? ` and the selected Linear issue ${issue.identifier} (${issue.title})`
    : "";
  return DEFAULT_VIBE_PROMPT.replace("{issue_clause}", issueClause);
}

function renderInlineResult(element, message, href = "") {
  if (!message) {
    element.className = "inline-result hidden";
    element.innerHTML = "";
    return;
  }

  element.className = "inline-result";
  element.innerHTML = href
    ? `${escapeHtml(message)} <a class="issue-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Open link</a>`
    : escapeHtml(message);
}

function updateLinearNewLink() {
  const teamKey = getTeamKey(state.settings.defaultTeamId);
  const title = elements.issueTitle.value.trim() || getTabTitle(state.currentTab);
  const description =
    elements.issueDescription.value.trim() ||
    hydrateDescriptionTemplate(getTabTitle(state.currentTab), getTabUrl(state.currentTab));

  const baseUrl = teamKey
    ? `https://linear.app/team/${encodeURIComponent(teamKey)}/new`
    : "https://linear.new";
  const params = new URLSearchParams();
  params.set("title", title);
  params.set("description", description);

  if (state.currentTab?.url) {
    params.set("links", `${state.currentTab.url}|${getTabTitle(state.currentTab)}`);
  }

  elements.linearNewLink.href = `${baseUrl}?${params.toString()}`;
}

function buildContextPayload() {
  const selectedIssue = getSelectedIssue() || getSessionIssue();
  return {
    prompt: elements.vibePrompt.value.trim() || buildDefaultVibePrompt(),
    context: {
      page: state.currentTab
        ? {
            title: getTabTitle(state.currentTab),
            url: getTabUrl(state.currentTab),
          }
        : null,
      linearIssue: selectedIssue
        ? {
            id: selectedIssue.id,
            identifier: selectedIssue.identifier,
            title: selectedIssue.title,
            url: selectedIssue.url,
            state: selectedIssue.state?.name || "",
            team: selectedIssue.team?.name || "",
          }
        : null,
      linearSession: state.sessionContext
        ? {
            mode: state.sessionContext.mode || "",
            identifier: state.sessionContext.identifier || "",
            title: state.sessionContext.title || "",
            description: state.sessionContext.description || "",
            url: state.sessionContext.url || "",
            source: state.sessionContext.source || "",
          }
        : null,
    },
    capabilities: {
      toolsEnabled: false,
      futureIntegrations: ["mcp-proxy", "web-search", "gsuite"],
    },
    createdAt: new Date().toISOString(),
  };
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY];
  if (settings) {
    state.settings.apiKey = settings.apiKey || "";
    state.settings.defaultTeamId = settings.defaultTeamId || "";
    state.settings.proxyUrl = settings.proxyUrl || "";
    state.settings.proxyToken = settings.proxyToken || "";
  }

  renderSettings();
}

async function loadStoredSessionContext() {
  const stored = await chrome.storage.local.get(LINEAR_CONTEXT_KEY);
  const context = stored[LINEAR_CONTEXT_KEY];
  if (
    context &&
    typeof state.currentTab?.id === "number" &&
    context.tabId === state.currentTab.id
  ) {
    state.sessionContext = context;
    return;
  }
  state.sessionContext = null;
}

async function saveSettings() {
  state.settings.apiKey = elements.apiKey.value.trim();
  state.settings.defaultTeamId = elements.teamSelect.value.trim();
  state.settings.proxyUrl = elements.proxyUrl.value.trim();
  state.settings.proxyToken = elements.proxyToken.value.trim();

  await chrome.storage.local.set({
    [SETTINGS_KEY]: state.settings,
  });

  renderSettings();
}

async function clearSettings() {
  state.settings = {
    apiKey: "",
    defaultTeamId: "",
    proxyUrl: "",
    proxyToken: "",
  };
  state.teams = [];
  state.issues = [];
  state.selectedIssueId = "";
  state.sessionContext = null;

  await chrome.storage.local.remove(SETTINGS_KEY);
  await chrome.storage.local.remove(LINEAR_CONTEXT_KEY);

  renderSettings();
  renderIssues();
  renderSelectedIssue();
  renderInlineResult(elements.createdIssue, "");
  renderInlineResult(elements.proxyResponse, "");
  setStatus(DEFAULT_STATUS);
}

function renderSettings() {
  elements.apiKey.value = state.settings.apiKey;
  elements.proxyUrl.value = state.settings.proxyUrl;
  elements.proxyToken.value = state.settings.proxyToken;

  const options = [
    '<option value="">Choose a team after loading Linear data</option>',
    ...state.teams.map((team) => {
      const selected = team.id === state.settings.defaultTeamId ? " selected" : "";
      return `<option value="${escapeHtml(team.id)}"${selected}>${escapeHtml(team.name)} (${escapeHtml(team.key)})</option>`;
    }),
  ];

  elements.teamSelect.innerHTML = options.join("");
  if (state.settings.defaultTeamId) {
    elements.teamSelect.value = state.settings.defaultTeamId;
  }
  elements.sendProxy.disabled = !state.settings.proxyUrl;
  updateLinearNewLink();
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  state.currentTab = tab || null;
  renderCurrentTab();
}

function renderCurrentTab() {
  if (!state.currentTab) {
    elements.tabContext.className = "context-card empty";
    elements.tabContext.textContent = "No active tab available.";
    return;
  }

  const title = getTabTitle(state.currentTab);
  const url = getTabUrl(state.currentTab);

  elements.tabContext.className = "context-card";
  elements.tabContext.innerHTML = `
    <p class="context-label">Active page</p>
    <p class="context-title">${escapeHtml(title)}</p>
    <a class="context-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>
  `;

  if (!elements.issueTitle.value.trim()) {
    elements.issueTitle.value = state.sessionContext?.title || title;
  }

  if (
    !elements.issueDescription.value.trim() ||
    elements.issueDescription.value === DEFAULT_DESCRIPTION
  ) {
    elements.issueDescription.value =
      state.sessionContext?.description || hydrateDescriptionTemplate(title, url);
  }

  if (!elements.vibePrompt.value.trim()) {
    elements.vibePrompt.value = buildDefaultVibePrompt();
  }

  updateLinearNewLink();
}

function renderSelectedIssue() {
  const issue = getSelectedIssue() || getSessionIssue();
  if (!issue) {
    elements.selectedIssue.className = "context-card empty";
    elements.selectedIssue.textContent =
      "No Linear issue selected for vibe context.";
    if (!elements.vibePrompt.value.trim()) {
      elements.vibePrompt.value = buildDefaultVibePrompt();
    }
    return;
  }

  elements.selectedIssue.className = "context-card";
  elements.selectedIssue.innerHTML = `
    <p class="context-label">Selected issue</p>
    <p class="context-title">${escapeHtml(issue.identifier)} · ${escapeHtml(issue.title)}</p>
    <p class="issue-meta">
      <span>${escapeHtml(issue.state?.name || "Unknown state")}</span>
      <span>${escapeHtml(issue.team?.name || "Unknown team")}</span>
    </p>
    <a class="issue-link" href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">Open in Linear</a>
  `;

  if (!elements.vibePrompt.value.trim() || elements.vibePrompt.value === buildDefaultVibePrompt()) {
    elements.vibePrompt.value = buildDefaultVibePrompt();
  }
}

function isOnLinear() {
  return (
    typeof state.currentTab?.id === "number" &&
    String(state.currentTab?.url || "").includes("linear.app")
  );
}

async function linearRequestViaSession(query, variables = {}) {
  const result = await chrome.tabs.sendMessage(state.currentTab.id, {
    type: "linear-api-request",
    query,
    variables,
  });
  if (!result?.ok) {
    throw new Error(result?.error || "Linear session request failed.");
  }
  return result.data;
}

async function linearRequest(query, variables = {}) {
  // Prefer session-based auth (no key needed) when on linear.app
  if (isOnLinear()) {
    try {
      return await linearRequestViaSession(query, variables);
    } catch (err) {
      // Fall through to API key if session auth fails
      if (!state.settings.apiKey) throw err;
    }
  }

  if (!state.settings.apiKey) {
    throw new Error("Open linear.app in the active tab, or add a personal API key.");
  }

  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: state.settings.apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message || "Linear request failed.");
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message || "Linear request returned an error.");
  }

  return payload.data;
}

async function refreshLinearData() {
  const usingSession = isOnLinear();

  if (!state.settings.apiKey && !usingSession) {
    state.teams = [];
    state.issues = [];
    state.selectedIssueId = "";
    renderSettings();
    renderIssues();
    renderSelectedIssue();
    setStatus(DEFAULT_STATUS);
    return;
  }

  setStatus(
    usingSession && !state.settings.apiKey
      ? "Loading via Linear session..."
      : "Loading teams and assigned issues..."
  );

  const bootstrapData = await linearRequest(`
    query BootstrapLinearSidepanel {
      teams {
        nodes {
          id
          key
          name
        }
      }
      viewer {
        id
        name
      }
    }
  `);

  const assignedIssuesData = await linearRequest(
    `
      query AssignedIssues($userId: String!) {
        user(id: $userId) {
          assignedIssues(first: 20) {
            nodes {
              id
              identifier
              title
              url
              state {
                name
                type
              }
              team {
                id
                key
                name
              }
            }
          }
        }
      }
    `,
    { userId: bootstrapData.viewer.id },
  );

  state.teams = bootstrapData.teams.nodes;
  state.issues = assignedIssuesData.user.assignedIssues.nodes.filter((issue) => {
    const type = issue.state?.type || "";
    return type !== "completed" && type !== "canceled";
  });

  if (!state.settings.defaultTeamId && state.teams.length > 0) {
    state.settings.defaultTeamId = state.teams[0].id;
    await saveSettings();
  }

  if (!getSelectedIssue() && state.issues.length > 0) {
    state.selectedIssueId = state.issues[0].id;
  }

  renderSettings();
  renderIssues();
  renderSelectedIssue();
  const authLabel = state.settings.apiKey ? "API key" : "Linear session";
  setStatus(
    `Loaded ${state.issues.length} assigned issue${state.issues.length === 1 ? "" : "s"} across ${state.teams.length} team${state.teams.length === 1 ? "" : "s"} via ${authLabel}.`,
    "success",
  );
}

function renderIssues() {
  elements.issueCount.textContent = String(state.issues.length);

  if (state.issues.length === 0) {
    elements.issuesList.className = "issues-list empty";
    if (state.settings.apiKey) {
      elements.issuesList.textContent = "No assigned issues found.";
      return;
    }
    elements.issuesList.textContent =
      isOnLinear()
        ? "Connecting via Linear session..."
        : state.sessionContext
          ? "Using live Linear session context from the current page."
          : "No Linear data loaded yet.";
    return;
  }

  elements.issuesList.className = "issues-list";
  elements.issuesList.innerHTML = state.issues
    .map((issue) => {
      const selected = issue.id === state.selectedIssueId ? " selected" : "";
      return `
        <article class="issue-card${selected}">
          <p class="issue-meta">
            <span>${escapeHtml(issue.identifier || "Issue")}</span>
            <span>${escapeHtml(issue.state?.name || "Unknown state")}</span>
            <span>${escapeHtml(issue.team?.name || "Unknown team")}</span>
          </p>
          <p class="issue-title">${escapeHtml(issue.title)}</p>
          <div class="issue-actions">
            <button class="ghost-button use-issue" data-issue-id="${escapeHtml(issue.id)}" type="button">
              Use for vibe
            </button>
            <a class="issue-link" href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">Open in Linear</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function selectIssue(issueId) {
  state.selectedIssueId = issueId;
  renderIssues();
  renderSelectedIssue();
}

async function copyContextPack() {
  const payload = JSON.stringify(buildContextPayload(), null, 2);
  await navigator.clipboard.writeText(payload);
  renderInlineResult(elements.proxyResponse, "Context pack copied to clipboard.");
  setStatus("Copied vibe context pack.", "success");
}

async function sendToProxy(event) {
  event.preventDefault();

  if (!state.settings.proxyUrl) {
    setStatus("Add a proxy URL before sending a vibe request.", "error");
    return;
  }

  setStatus("Sending text-only vibe request to proxy...");
  renderInlineResult(elements.proxyResponse, "");

  const headers = {
    "Content-Type": "application/json",
    "X-Linear-Sidepanel-Client": "linear-ticket-sidepanel",
  };
  if (state.settings.proxyToken) {
    headers.Authorization = state.settings.proxyToken;
  }

  const response = await fetch(state.settings.proxyUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(buildContextPayload()),
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const errorMessage =
      typeof body === "string"
        ? body
        : body?.error || body?.message || JSON.stringify(body, null, 2);
    throw new Error(errorMessage || "Proxy request failed.");
  }

  const text =
    typeof body === "string"
      ? body
      : body?.output || body?.message || body?.text || JSON.stringify(body, null, 2);
  renderInlineResult(elements.proxyResponse, text);
  setStatus("Proxy response received.", "success");
}

async function createIssue(event) {
  event.preventDefault();

  if (!state.settings.defaultTeamId) {
    setStatus("Choose a default team before creating an issue.", "error");
    return;
  }

  const title = elements.issueTitle.value.trim();
  if (!title) {
    setStatus("Issue title is required.", "error");
    return;
  }

  setStatus(`Creating issue in ${getTeamName(state.settings.defaultTeamId)}...`);
  renderInlineResult(elements.createdIssue, "");

  const mutation = `
    mutation CreateLinearIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          url
        }
      }
    }
  `;

  const description = elements.issueDescription.value.trim();
  const data = await linearRequest(mutation, {
    input: {
      title,
      description,
      teamId: state.settings.defaultTeamId,
    },
  });

  const createdIssue = data.issueCreate.issue;
  renderInlineResult(elements.createdIssue, `${createdIssue.identifier} created.`, createdIssue.url);
  setStatus(`Created ${createdIssue.identifier}.`, "success");
  await refreshLinearData();
}

async function refreshAll() {
  await getCurrentTab();
  await refreshSessionContext();
  await refreshLinearData();
}

async function refreshSessionContext() {
  if (
    typeof state.currentTab?.id !== "number" ||
    !String(state.currentTab?.url || "").includes("linear.app")
  ) {
    state.sessionContext = null;
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(state.currentTab.id, {
      type: "linear-context-request",
    });
    if (response?.ok && response.context) {
      state.sessionContext = {
        ...response.context,
        tabId: state.currentTab.id,
      };
      await chrome.storage.local.set({
        [LINEAR_CONTEXT_KEY]: state.sessionContext,
      });
      return;
    }
  } catch {
    // Fallback to the latest captured context if the content script is not yet ready.
  }

  await loadStoredSessionContext();
}

function bindEvents() {
  elements.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveSettings();
      setStatus("Settings saved locally.", "success");
      await refreshLinearData();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.clearSettings.addEventListener("click", async () => {
    try {
      await clearSettings();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.refreshAll.addEventListener("click", () => {
    void refreshAll().catch((error) => setStatus(error.message, "error"));
  });

  elements.refreshTab.addEventListener("click", () => {
    void getCurrentTab().catch((error) => setStatus(error.message, "error"));
  });

  elements.copyContext.addEventListener("click", () => {
    void copyContextPack().catch((error) => setStatus(error.message, "error"));
  });

  elements.vibeForm.addEventListener("submit", async (event) => {
    try {
      await sendToProxy(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.issueForm.addEventListener("submit", async (event) => {
    try {
      await createIssue(event);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.teamSelect.addEventListener("change", () => {
    updateLinearNewLink();
  });

  elements.issueTitle.addEventListener("input", () => {
    updateLinearNewLink();
  });

  elements.issueDescription.addEventListener("input", () => {
    updateLinearNewLink();
  });

  elements.issuesList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const issueId = target.dataset.issueId;
    if (target.classList.contains("use-issue") && issueId) {
      selectIssue(issueId);
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    void refreshAll();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url && changeInfo.status !== "complete") {
      return;
    }
    if (state.currentTab?.id === tabId) {
      void refreshAll();
    }
  });
}

async function main() {
  bindEvents();
  await getCurrentTab();
  await loadSettings();
  await loadStoredSessionContext();
  await refreshSessionContext();
  renderSelectedIssue();
  renderIssues();
  try {
    await refreshLinearData();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

void main();
