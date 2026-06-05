// @ts-nocheck
import {
  claimIssueNavigationKeydown,
  getIssueNavigationDelta,
  getNextIssueSelectionId,
  isIssueNavigationEditableTarget,
} from "./sidepanel-navigation";

export {};

const LINEAR_API_URL = "https://api.linear.app/graphql";
const SETTINGS_KEY = "linearTicketSidepanel.settings";
const LINEAR_CONTEXT_KEY = "linearTicketSidepanel.liveContext";
const RESEARCH_CONTEXT_KEY = "linearTicketSidepanel.researchContext";
const ISSUE_NAVIGATION_LISTENER_KEY = Symbol.for(
  "linearTicketSidepanel.issueNavigationKeydownListener",
);

const DEFAULT_STATUS =
  "Open linear.app to load issue context. Research captures continue in the background.";
const DEFAULT_DESCRIPTION_TEMPLATE = `## Summary

Describe the bug, opportunity, or task.

## Research Context

- Prompt:
- Key findings:
- Supporting evidence:

## Page Context

- Title: {{title}}
- URL: {{url}}
`;
const DEFAULT_PROMPT_TEMPLATE =
  "Use the captured research context to draft a Linear issue update with clear problem framing, implementation steps, and acceptance criteria.";
const ISSUE_IDENTIFIER_RE = /\b[A-Z]{2,10}-\d+\b/;

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
  research: {
    captures: [],
    activeIssueIdentifier: "",
    activeIssueTitle: "",
    lastUpdated: "",
  },
};

const elements = {
  recordingPill: document.querySelector("#recording-pill"),
  recordingLabel: document.querySelector("#recording-label"),
  statusMessage: document.querySelector("#status-message"),

  refreshAll: document.querySelector("#refresh-all"),
  captureNow: document.querySelector("#capture-now"),

  promptBox: document.querySelector("#prompt-box"),
  populateTicket: document.querySelector("#populate-ticket"),
  shareContext: document.querySelector("#share-context"),
  sendProxy: document.querySelector("#send-proxy"),
  uploadStatus: document.querySelector("#upload-status"),
  proxyResponse: document.querySelector("#proxy-response"),

  issueForm: document.querySelector("#issue-form"),
  issueTitle: document.querySelector("#issue-title"),
  issueDescription: document.querySelector("#issue-description"),
  selectedIssuePill: document.querySelector("#selected-issue-pill"),
  linearNewLink: document.querySelector("#linear-new-link"),
  createdIssue: document.querySelector("#created-issue"),

  settingsForm: document.querySelector("#settings-form"),
  clearSettings: document.querySelector("#clear-settings"),
  apiKey: document.querySelector("#api-key"),
  teamSelect: document.querySelector("#team-select"),
  proxyUrl: document.querySelector("#proxy-url"),
  proxyToken: document.querySelector("#proxy-token"),

  researchSummary: document.querySelector("#research-summary"),
  researchList: document.querySelector("#research-list"),
  clearResearch: document.querySelector("#clear-research"),

  tabContext: document.querySelector("#tab-context"),
  selectedIssue: document.querySelector("#selected-issue"),
  issuesList: document.querySelector("#issues-list"),
  issueCount: document.querySelector("#issue-count"),
};

function setStatus(message, tone = "neutral") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.tone = tone;
}

function renderInlineResult(element, message, href = "") {
  if (!element) {
    return;
  }
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

function normalizeThemeName(rawName) {
  const value = String(rawName || "").toLowerCase();
  if (value.includes("dark") || value.includes("night")) {
    return "dark";
  }
  return "light";
}

function isColorValue(value) {
  const candidate = String(value || "").trim();
  if (!candidate) {
    return false;
  }
  return /^(lch|oklch|rgb|rgba|hsl|hsla|#)/i.test(candidate);
}

function applyLinearTheme(theme) {
  const root = document.documentElement;
  const themeName = normalizeThemeName(theme?.name);
  root.dataset.linearTheme = themeName;

  const baseColor = isColorValue(theme?.baseColor)
    ? theme.baseColor
    : "lch(98.94% 0.5 282)";
  const sidebarColor = isColorValue(theme?.sidebarColor)
    ? theme.sidebarColor
    : "lch(95.94% 0.5 282 / 1)";
  const borderColor = isColorValue(theme?.borderColor)
    ? theme.borderColor
    : "lch(89.49% 0 282 / 1)";

  root.style.setProperty("--linear-base", baseColor);
  root.style.setProperty("--linear-sidebar", sidebarColor);
  root.style.setProperty("--linear-border", borderColor);
}

function resizeTextarea(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }
  textarea.style.height = "auto";
  const minHeight = textarea.id === "prompt-box" ? 190 : 130;
  textarea.style.height = `${Math.max(textarea.scrollHeight, minHeight)}px`;
}

function getSelectedIssue() {
  return state.issues.find((issue) => issue.id === state.selectedIssueId) || null;
}

function findIssueByIdentifier(identifier) {
  const wanted = String(identifier || "").toUpperCase();
  if (!wanted) {
    return null;
  }
  return (
    state.issues.find(
      (issue) => String(issue.identifier || "").toUpperCase() === wanted,
    ) || null
  );
}

function getSessionIssue() {
  if (!state.sessionContext) {
    return null;
  }

  const matchedIssue = findIssueByIdentifier(state.sessionContext.identifier);
  if (matchedIssue) {
    return matchedIssue;
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
      key: state.sessionContext.teamKey || "",
    },
  };
}

function getWorkingIssue() {
  return (
    getSelectedIssue() ||
    getSessionIssue() ||
    findIssueByIdentifier(state.research.activeIssueIdentifier)
  );
}

function getTeamName(teamId) {
  return state.teams.find((team) => team.id === teamId)?.name || "No team selected";
}

function getTeamKey(teamId) {
  return state.teams.find((team) => team.id === teamId)?.key || "";
}

function hydrateDescriptionTemplate(title, url) {
  return DEFAULT_DESCRIPTION_TEMPLATE.replace("{{title}}", title).replace("{{url}}", url);
}

function buildDefaultPrompt() {
  const issue = getWorkingIssue();
  const issueClause = issue
    ? ` Focus on ${issue.identifier} (${issue.title}).`
    : "";
  return `${DEFAULT_PROMPT_TEMPLATE}${issueClause}`;
}

function inferIssueIdentifier(value) {
  const match = String(value || "").toUpperCase().match(ISSUE_IDENTIFIER_RE);
  return match ? match[0] : "";
}

function buildResearchSummaryLine() {
  const count = state.research.captures.length;
  if (!count) {
    return "No captures yet.";
  }

  const activeIssue = state.research.activeIssueIdentifier
    ? `Active issue: ${state.research.activeIssueIdentifier}.`
    : "No active issue inferred yet.";
  return `${count} capture${count === 1 ? "" : "s"} saved. ${activeIssue}`;
}

function renderRecordingPill() {
  const issue = getWorkingIssue();
  if (issue?.identifier) {
    elements.recordingLabel.textContent = `Recording for ${issue.identifier}`;
    return;
  }

  if (state.currentTab && String(state.currentTab.url || "").includes("linear.app")) {
    elements.recordingLabel.textContent = "Recording Linear session";
    return;
  }

  elements.recordingLabel.textContent = "Recording research";
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

  updateLinearNewLink();
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

  if (!elements.issueDescription.value.trim()) {
    elements.issueDescription.value =
      state.sessionContext?.description || hydrateDescriptionTemplate(title, url);
    resizeTextarea(elements.issueDescription);
  }

  if (!elements.promptBox.value.trim()) {
    elements.promptBox.value = buildDefaultPrompt();
    resizeTextarea(elements.promptBox);
  }

  updateLinearNewLink();
}

function renderSelectedIssue() {
  const issue = getWorkingIssue();
  if (!issue) {
    elements.selectedIssue.className = "context-card empty";
    elements.selectedIssue.textContent = "No issue selected.";
    elements.selectedIssuePill.textContent = "No issue selected";
    return;
  }

  elements.selectedIssue.className = "context-card";
  elements.selectedIssue.innerHTML = `
    <p class="context-label">Working issue</p>
    <p class="context-title">${escapeHtml(issue.identifier)} · ${escapeHtml(issue.title)}</p>
    <p class="issue-meta">
      <span>${escapeHtml(issue.state?.name || "Unknown state")}</span>
      <span>${escapeHtml(issue.team?.name || "Unknown team")}</span>
    </p>
    <a class="issue-link" href="${escapeHtml(issue.url || "https://linear.app")}" target="_blank" rel="noreferrer">Open in Linear</a>
  `;

  elements.selectedIssuePill.textContent = issue.identifier
    ? `Working on ${issue.identifier}`
    : "Working issue";
}

function renderIssues() {
  elements.issueCount.textContent = String(state.issues.length);

  if (state.issues.length === 0) {
    elements.issuesList.className = "issues-list empty";
    elements.issuesList.textContent = "No assigned issues loaded yet.";
    return;
  }

  elements.issuesList.className = "issues-list";
  elements.issuesList.innerHTML = state.issues
    .map((issue) => {
      const selected = issue.id === state.selectedIssueId ? " selected" : "";
      const ariaSelected = issue.id === state.selectedIssueId ? "true" : "false";
      return `
        <article class="issue-card${selected}" data-issue-id="${escapeHtml(issue.id)}" aria-selected="${ariaSelected}">
          <p class="issue-meta">
            <span>${escapeHtml(issue.identifier || "Issue")}</span>
            <span>${escapeHtml(issue.state?.name || "Unknown")}</span>
            <span>${escapeHtml(issue.team?.name || "Unknown team")}</span>
          </p>
          <p class="issue-title">${escapeHtml(issue.title)}</p>
          <div class="issue-actions">
            <button class="ghost-button small use-issue" data-issue-id="${escapeHtml(issue.id)}" type="button">Use</button>
            <a class="issue-link" href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">Open</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderResearch() {
  const captures = state.research.captures || [];

  if (!captures.length) {
    elements.researchSummary.className = "context-card empty";
    elements.researchSummary.textContent = "No captures yet.";
    elements.researchList.className = "issues-list empty";
    elements.researchList.textContent = "No captured research context yet.";
    return;
  }

  elements.researchSummary.className = "context-card";
  elements.researchSummary.innerHTML = `
    <p class="context-label">Session</p>
    <p class="context-title">${escapeHtml(buildResearchSummaryLine())}</p>
  `;

  const recent = [...captures].reverse().slice(0, 12);
  elements.researchList.className = "issues-list";
  elements.researchList.innerHTML = recent
    .map((capture) => {
      const screenshotLink = capture.screenshotDataUrl
        ? `<a class="issue-link" href="${escapeHtml(capture.screenshotDataUrl)}" target="_blank" rel="noreferrer">Screenshot</a>`
        : "";
      return `
        <article class="issue-card">
          <p class="issue-meta">
            <span>${escapeHtml(capture.kind || "capture")}</span>
            <span>${escapeHtml(capture.issueIdentifierHint || "no issue")}</span>
            <span>${escapeHtml(new Date(capture.capturedAt || Date.now()).toLocaleTimeString())}</span>
          </p>
          <p class="issue-title">${escapeHtml(capture.title || "Untitled")}</p>
          <p>${escapeHtml(String(capture.text || "").slice(0, 240))}</p>
          <div class="issue-actions">
            <a class="issue-link" href="${escapeHtml(capture.url || "#")}" target="_blank" rel="noreferrer">Open source</a>
            ${screenshotLink}
          </div>
        </article>
      `;
    })
    .join("");
}

function serializeResearchForPayload() {
  const captures = [...(state.research.captures || [])].slice(-20);
  const recentScreenshots = captures
    .filter((capture) => capture.screenshotDataUrl)
    .slice(-2)
    .map((capture) => ({
      id: capture.id,
      title: capture.title,
      issueIdentifierHint: capture.issueIdentifierHint,
      screenshotDataUrl: capture.screenshotDataUrl,
      capturedAt: capture.capturedAt,
    }));

  return {
    activeIssueIdentifier: state.research.activeIssueIdentifier || "",
    activeIssueTitle: state.research.activeIssueTitle || "",
    captures: captures.map((capture) => ({
      id: capture.id,
      kind: capture.kind,
      url: capture.url,
      title: capture.title,
      text: String(capture.text || "").slice(0, 1800),
      issueIdentifierHint: capture.issueIdentifierHint || "",
      capturedAt: capture.capturedAt,
      hasScreenshot: Boolean(capture.screenshotDataUrl),
    })),
    screenshots: recentScreenshots,
  };
}

function buildContextPayload(intent = "proxy") {
  const workingIssue = getWorkingIssue();
  return {
    intent,
    prompt: elements.promptBox.value.trim() || buildDefaultPrompt(),
    draft: {
      title: elements.issueTitle.value.trim(),
      description: elements.issueDescription.value.trim(),
    },
    context: {
      page: state.currentTab
        ? {
            title: getTabTitle(state.currentTab),
            url: getTabUrl(state.currentTab),
          }
        : null,
      linearIssue: workingIssue
        ? {
            id: workingIssue.id,
            identifier: workingIssue.identifier,
            title: workingIssue.title,
            url: workingIssue.url,
            team: workingIssue.team?.name || "",
            state: workingIssue.state?.name || "",
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
            teamKey: state.sessionContext.teamKey || "",
            theme: state.sessionContext.theme || null,
          }
        : null,
      research: serializeResearchForPayload(),
    },
    createdAt: new Date().toISOString(),
  };
}

function parseProxyBody(body) {
  if (typeof body === "string") {
    return { text: body, json: null };
  }
  if (body && typeof body === "object") {
    return {
      text:
        body.output ||
        body.message ||
        body.text ||
        body.response ||
        JSON.stringify(body, null, 2),
      json: body,
    };
  }
  return { text: "", json: null };
}

function extractJsonFromString(text) {
  const value = String(text || "").trim();
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    // continue
  }

  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fenced) {
    return null;
  }

  try {
    return JSON.parse(fenced[1]);
  } catch {
    return null;
  }
}

function normalizeTicketDraft(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw.ticket || raw.draft || raw.issue || raw;
  const title = String(source.title || source.issueTitle || "").trim();
  const description = String(
    source.description || source.issueDescription || source.body || "",
  ).trim();
  const note = String(raw.note || raw.reasoning || "").trim();

  if (!title && !description) {
    return null;
  }

  return { title, description, note };
}

function buildFallbackDraftFromPrompt() {
  const prompt = elements.promptBox.value.trim();
  const firstSentence = prompt
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)[0];

  const suggestedTitle =
    (firstSentence || getTabTitle(state.currentTab)).replace(/[.#:*_`]/g, "").slice(0, 90) ||
    "Investigate implementation update";

  const researchBullets = (state.research.captures || [])
    .slice(-6)
    .map((capture) =>
      `- ${capture.title || "Research"}: ${String(capture.text || "").slice(0, 180)}${capture.url ? ` (${capture.url})` : ""}`,
    );

  const descriptionSections = [
    "## Prompt",
    prompt || buildDefaultPrompt(),
    "",
    "## Research Captures",
    researchBullets.length ? researchBullets.join("\n") : "- No captures yet.",
    "",
    "## Page Context",
    `- Title: ${getTabTitle(state.currentTab)}`,
    `- URL: ${getTabUrl(state.currentTab)}`,
  ];

  return {
    title: suggestedTitle,
    description: descriptionSections.join("\n"),
    note: "Used local fallback mapping because no structured proxy draft was returned.",
  };
}

function isOnLinear() {
  return (
    typeof state.currentTab?.id === "number" &&
    String(state.currentTab?.url || "").includes("linear.app")
  );
}

async function linearRequestViaSession(query, variables = {}) {
  if (typeof state.currentTab?.id !== "number") {
    throw new Error("No active tab available for session request.");
  }

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
  if (isOnLinear()) {
    try {
      return await linearRequestViaSession(query, variables);
    } catch (error) {
      if (!state.settings.apiKey) {
        throw error;
      }
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

async function callProxy(payload) {
  if (!state.settings.proxyUrl) {
    throw new Error("Set a proxy URL to use proxy-backed drafting.");
  }

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
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof body === "string"
        ? body
        : body?.error || body?.message || JSON.stringify(body, null, 2);
    throw new Error(message || "Proxy request failed.");
  }

  return parseProxyBody(body);
}

async function refreshLinearData() {
  const usingSession = isOnLinear();

  if (!state.settings.apiKey && !usingSession) {
    state.teams = [];
    state.issues = [];
    renderSettings();
    renderIssues();
    renderSelectedIssue();
    return;
  }

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
      }
    }
  `);

  const assignedIssuesData = await linearRequest(
    `
      query AssignedIssues($userId: String!) {
        user(id: $userId) {
          assignedIssues(first: 25) {
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

  if (
    state.selectedIssueId &&
    !state.issues.some((issue) => issue.id === state.selectedIssueId)
  ) {
    state.selectedIssueId = "";
  }

  if (!state.selectedIssueId) {
    const fromResearch = findIssueByIdentifier(state.research.activeIssueIdentifier);
    if (fromResearch) {
      state.selectedIssueId = fromResearch.id;
    } else if (state.issues[0]) {
      state.selectedIssueId = state.issues[0].id;
    }
  }

  renderSettings();
  renderIssues();
  renderSelectedIssue();
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

  await chrome.storage.local.remove(SETTINGS_KEY);

  renderSettings();
  renderIssues();
  renderSelectedIssue();
  renderInlineResult(elements.createdIssue, "");
  renderInlineResult(elements.proxyResponse, "");
  setStatus(DEFAULT_STATUS);
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  state.currentTab = tab || null;
  renderCurrentTab();
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
    applyLinearTheme(state.sessionContext.theme || null);
    return;
  }
  state.sessionContext = null;
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

      applyLinearTheme(state.sessionContext.theme || null);
      if (state.sessionContext.identifier) {
        await bindIssueToResearch({
          identifier: state.sessionContext.identifier,
          title: state.sessionContext.title || "",
        });
      }
      return;
    }
  } catch {
    // Content script may not be ready yet.
  }

  await loadStoredSessionContext();
}

async function loadResearchContext() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "research-get-context" });
    if (response?.ok && response.research) {
      state.research = {
        captures: Array.isArray(response.research.captures)
          ? response.research.captures
          : [],
        activeIssueIdentifier: response.research.activeIssueIdentifier || "",
        activeIssueTitle: response.research.activeIssueTitle || "",
        lastUpdated: response.research.lastUpdated || "",
      };
    }
  } catch {
    state.research = {
      captures: [],
      activeIssueIdentifier: "",
      activeIssueTitle: "",
      lastUpdated: "",
    };
  }

  renderResearch();
}

async function clearResearchContext() {
  await chrome.runtime.sendMessage({ type: "research-clear-context" });
  await loadResearchContext();
  renderSelectedIssue();
}

async function bindIssueToResearch(issue) {
  if (!issue?.identifier) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: "research-bind-issue",
      issue: {
        identifier: issue.identifier,
        title: issue.title || "",
      },
    });
    await loadResearchContext();
  } catch {
    // no-op
  }
}

function selectIssue(issueId) {
  state.selectedIssueId = issueId;
  renderIssues();
  renderSelectedIssue();
  const selected = getSelectedIssue();
  if (selected?.identifier) {
    void bindIssueToResearch(selected);
  }
}

function moveIssueSelection(delta) {
  const nextIssueId = getNextIssueSelectionId(state.issues, state.selectedIssueId, delta);
  if (!nextIssueId) {
    return false;
  }

  if (nextIssueId !== state.selectedIssueId) {
    selectIssue(nextIssueId);
  }

  elements.issuesList
    .querySelector(`[data-issue-id="${CSS.escape(nextIssueId)}"]`)
    ?.scrollIntoView({ block: "nearest" });

  return true;
}

function handleIssueNavigationKeydown(event) {
  if (event.defaultPrevented) {
    return;
  }

  if (isIssueNavigationEditableTarget(event.target)) {
    return;
  }

  const delta = getIssueNavigationDelta(event.key);
  if (delta === 0) {
    return;
  }

  if (!claimIssueNavigationKeydown(event)) {
    return;
  }

  const moved = moveIssueSelection(delta);
  if (moved) {
    event.preventDefault();
  }
}

function installIssueNavigationKeydownListener() {
  const previousListener = window[ISSUE_NAVIGATION_LISTENER_KEY];
  if (previousListener) {
    document.removeEventListener("keydown", previousListener);
  }

  document.addEventListener("keydown", handleIssueNavigationKeydown);
  window[ISSUE_NAVIGATION_LISTENER_KEY] = handleIssueNavigationKeydown;
}

async function captureCurrentPage() {
  if (typeof state.currentTab?.id !== "number") {
    throw new Error("No active tab available to capture.");
  }

  const workingIssue = getWorkingIssue();
  const response = await chrome.tabs.sendMessage(state.currentTab.id, {
    type: "research-capture-now",
    issueIdentifier: workingIssue?.identifier || "",
    issueTitle: workingIssue?.title || "",
    withScreenshot: true,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to capture page context.");
  }

  await loadResearchContext();
  setStatus("Captured page context.", "success");
}

async function populateTicketFromPrompt() {
  const prompt = elements.promptBox.value.trim();
  if (!prompt) {
    setStatus("Write a prompt before populating the ticket.", "error");
    return;
  }

  setStatus("Mapping prompt and captures into a ticket draft...");

  let draft = null;
  let proxyNote = "";

  if (state.settings.proxyUrl) {
    try {
      const proxyResult = await callProxy(buildContextPayload("populate_ticket"));
      draft = normalizeTicketDraft(proxyResult.json);

      if (!draft) {
        const fromText = extractJsonFromString(proxyResult.text);
        draft = normalizeTicketDraft(fromText);
      }

      proxyNote = proxyResult.text || "";
    } catch (error) {
      proxyNote = `Proxy draft failed: ${error.message}`;
    }
  }

  if (!draft) {
    draft = buildFallbackDraftFromPrompt();
  }

  if (draft.title) {
    elements.issueTitle.value = draft.title;
  }
  if (draft.description) {
    elements.issueDescription.value = draft.description;
  }

  resizeTextarea(elements.issueDescription);
  updateLinearNewLink();

  const note = draft.note || proxyNote || "Ticket draft populated.";
  renderInlineResult(elements.proxyResponse, note);
  setStatus("Ticket draft populated.", "success");
}

async function askProxy() {
  if (!state.settings.proxyUrl) {
    throw new Error("Set a proxy URL first.");
  }

  setStatus("Sending research context to proxy...");
  const proxyResult = await callProxy(buildContextPayload("assist"));
  renderInlineResult(elements.proxyResponse, proxyResult.text || "Proxy response received.");
  setStatus("Proxy response received.", "success");
}

async function shareContext() {
  const payload = buildContextPayload("share");
  const serialized = JSON.stringify(payload, null, 2);

  if (navigator.share) {
    try {
      await navigator.share({
        title: "Linear Research Context",
        text: serialized.slice(0, 16000),
      });
      setStatus("Context shared.", "success");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }
  }

  await navigator.clipboard.writeText(serialized);
  renderInlineResult(elements.proxyResponse, "Context copied to clipboard for sharing.");
  setStatus("Context copied for sharing.", "success");
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
  renderInlineResult(
    elements.createdIssue,
    `${createdIssue.identifier} created.`,
    createdIssue.url,
  );
  setStatus(`Created ${createdIssue.identifier}.`, "success");

  await bindIssueToResearch({
    identifier: createdIssue.identifier,
    title: createdIssue.title,
  });

  await refreshLinearData();
}

async function resolveIssueForAttachment() {
  const selected = getSelectedIssue();
  if (selected?.id && !selected.id.startsWith("session:")) {
    return selected;
  }

  const fromResearch = findIssueByIdentifier(state.research.activeIssueIdentifier);
  if (fromResearch?.id && !fromResearch.id.startsWith("session:")) {
    return fromResearch;
  }

  const sessionIdentifier = state.sessionContext?.identifier || "";
  if (!sessionIdentifier) {
    throw new Error("Select an issue before pasting an image.");
  }

  const existing = findIssueByIdentifier(sessionIdentifier);
  if (existing?.id && !existing.id.startsWith("session:")) {
    return existing;
  }

  const query = `
    query IssueByIdentifier($identifier: String!) {
      issues(first: 1, filter: { identifier: { eq: $identifier } }) {
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
  `;

  const data = await linearRequest(query, { identifier: sessionIdentifier });
  const issue = data?.issues?.nodes?.[0] || null;
  if (!issue) {
    throw new Error("Could not resolve a Linear issue for the pasted image.");
  }

  const withoutExisting = state.issues.filter((item) => item.id !== issue.id);
  state.issues = [...withoutExisting, issue];
  state.selectedIssueId = issue.id;
  renderIssues();
  renderSelectedIssue();
  return issue;
}

async function requestLinearFileUpload(file) {
  const mutation = `
    mutation RequestFileUpload($contentType: String!, $filename: String!, $size: Int!) {
      fileUpload(contentType: $contentType, filename: $filename, size: $size) {
        success
        uploadFile {
          uploadUrl
          assetUrl
          headers {
            key
            value
          }
        }
      }
    }
  `;

  const data = await linearRequest(mutation, {
    contentType: file.type || "image/png",
    filename: file.name || `pasted-${Date.now()}.png`,
    size: Number(file.size || 0),
  });

  const uploadRoot = data?.fileUpload;
  const uploadFile = uploadRoot?.uploadFile || null;
  if (!uploadRoot?.success || !uploadFile?.uploadUrl || !uploadFile?.assetUrl) {
    throw new Error("Linear did not return a usable upload URL.");
  }

  return uploadFile;
}

async function uploadBlobToSignedUrl(uploadFile, file) {
  const headers = {};
  for (const header of uploadFile.headers || []) {
    if (!header?.key) {
      continue;
    }
    headers[header.key] = header.value || "";
  }

  if (!headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = file.type || "image/png";
  }

  const response = await fetch(uploadFile.uploadUrl, {
    method: "PUT",
    headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}.`);
  }
}

async function createLinearAttachment(issueId, title, url) {
  const mutation = `
    mutation CreateAttachment($input: AttachmentCreateInput!) {
      attachmentCreate(input: $input) {
        success
        attachment {
          id
          title
          url
        }
      }
    }
  `;

  const data = await linearRequest(mutation, {
    input: {
      issueId,
      title,
      url,
    },
  });

  if (!data?.attachmentCreate?.success || !data?.attachmentCreate?.attachment) {
    throw new Error("Linear attachmentCreate failed.");
  }

  return data.attachmentCreate.attachment;
}

function insertTextAtCursor(textarea, text) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const current = textarea.value;
  textarea.value = `${current.slice(0, start)}${text}${current.slice(end)}`;
  const nextPosition = start + text.length;
  textarea.setSelectionRange(nextPosition, nextPosition);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function injectAttachmentMarkdown(assetUrl, filename) {
  const safeName = String(filename || "image").replace(/[\r\n]+/g, " ").trim() || "image";
  const markdown = `\n![${safeName}](${assetUrl})\n`;

  insertTextAtCursor(elements.promptBox, markdown);

  if (!elements.issueDescription.value.trim()) {
    elements.issueDescription.value = hydrateDescriptionTemplate(
      getTabTitle(state.currentTab),
      getTabUrl(state.currentTab),
    );
  }
  elements.issueDescription.value = `${elements.issueDescription.value.trimEnd()}\n${markdown}`;
  resizeTextarea(elements.promptBox);
  resizeTextarea(elements.issueDescription);
  updateLinearNewLink();
}

async function uploadPastedImage(file) {
  const issue = await resolveIssueForAttachment();

  const uploadFile = await requestLinearFileUpload(file);
  await uploadBlobToSignedUrl(uploadFile, file);

  const attachmentTitle = `Research capture: ${file.name || "pasted-image"}`;
  const attachment = await createLinearAttachment(
    issue.id,
    attachmentTitle,
    uploadFile.assetUrl,
  );

  injectAttachmentMarkdown(uploadFile.assetUrl, file.name || "pasted-image");
  await bindIssueToResearch({
    identifier: issue.identifier,
    title: issue.title,
  });

  return attachment;
}

async function handlePromptPaste(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const imageFiles = items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (!imageFiles.length) {
    return;
  }

  event.preventDefault();
  renderInlineResult(elements.uploadStatus, "Uploading pasted image to Linear...");

  try {
    for (const file of imageFiles) {
      await uploadPastedImage(file);
    }
    renderInlineResult(elements.uploadStatus, "Image uploaded and linked in ticket draft.");
    setStatus("Pasted image uploaded to Linear.", "success");
  } catch (error) {
    renderInlineResult(elements.uploadStatus, `Upload failed: ${error.message}`);
    setStatus(error.message, "error");
  }
}

async function refreshAll() {
  await getCurrentTab();
  await refreshSessionContext();
  await loadResearchContext();
  renderCurrentTab();
  renderSelectedIssue();
  renderRecordingPill();

  try {
    await refreshLinearData();
    setStatus("Context refreshed.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function bindEvents() {
  elements.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveSettings();
      await refreshLinearData();
      setStatus("Settings saved.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.clearSettings.addEventListener("click", () => {
    void clearSettings().catch((error) => setStatus(error.message, "error"));
  });

  elements.clearResearch.addEventListener("click", () => {
    void clearResearchContext().catch((error) => setStatus(error.message, "error"));
  });

  elements.refreshAll.addEventListener("click", () => {
    void refreshAll();
  });

  elements.captureNow.addEventListener("click", () => {
    void captureCurrentPage().catch((error) => setStatus(error.message, "error"));
  });

  elements.populateTicket.addEventListener("click", () => {
    void populateTicketFromPrompt().catch((error) => setStatus(error.message, "error"));
  });

  elements.sendProxy.addEventListener("click", () => {
    void askProxy().catch((error) => setStatus(error.message, "error"));
  });

  if (elements.shareContext) {
    elements.shareContext.addEventListener("click", () => {
      void shareContext().catch((error) => setStatus(error.message, "error"));
    });
  }

  elements.issueForm.addEventListener("submit", (event) => {
    void createIssue(event).catch((error) => setStatus(error.message, "error"));
  });

  elements.teamSelect.addEventListener("change", () => {
    updateLinearNewLink();
  });

  elements.issueTitle.addEventListener("input", () => {
    updateLinearNewLink();
  });

  elements.issueDescription.addEventListener("input", () => {
    resizeTextarea(elements.issueDescription);
    updateLinearNewLink();
  });

  elements.promptBox.addEventListener("input", () => {
    resizeTextarea(elements.promptBox);
  });

  elements.promptBox.addEventListener("paste", (event) => {
    void handlePromptPaste(event);
  });

  installIssueNavigationKeydownListener();

  elements.issuesList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.classList.contains("use-issue") && target.dataset.issueId) {
      selectIssue(target.dataset.issueId);
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    void refreshAll();
  });

  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (!info.url && info.status !== "complete") {
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
  await loadResearchContext();

  renderCurrentTab();
  renderSelectedIssue();
  renderIssues();
  renderResearch();
  renderRecordingPill();

  if (!elements.promptBox.value.trim()) {
    elements.promptBox.value = buildDefaultPrompt();
  }

  if (!elements.issueDescription.value.trim()) {
    elements.issueDescription.value = hydrateDescriptionTemplate(
      getTabTitle(state.currentTab),
      getTabUrl(state.currentTab),
    );
  }

  resizeTextarea(elements.promptBox);
  resizeTextarea(elements.issueDescription);
  updateLinearNewLink();

  try {
    await refreshLinearData();
    setStatus(
      isOnLinear() ? "Linear session ready." : "Research capture is active.",
      "success",
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

if (!globalThis.__linearTicketSidepanelInitialized) {
  globalThis.__linearTicketSidepanelInitialized = true;
  void main();
}
