import { useEffect } from "react"

import "./sidepanel.css"

export default function SidePanel() {
  useEffect(() => {
    // Side-effect module initializes the existing imperative panel logic.
    // @ts-expect-error Legacy module has no exports.
    void import("./sidepanel-main.js")
  }, [])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div id="recording-pill" className="recording-pill" aria-live="polite">
          <span className="pulse-dot" aria-hidden="true" />
          <span id="recording-label">Recording session</span>
        </div>
        <div className="topbar-actions">
          <button id="capture-now" className="ghost-button" type="button">
            Capture Page
          </button>
          <button id="refresh-all" className="ghost-button" type="button">
            Refresh
          </button>
        </div>
      </header>

      <p id="status-message" className="status-message">
        Open linear.app to load issue and draft context.
      </p>

      <section className="panel prompt-panel">
        <div className="section-header">
          <h1>Prompt</h1>
          <span className="badge">Prompt-to-ticket</span>
        </div>
        <label className="sr-only" htmlFor="prompt-box">
          Prompt text
        </label>
        <textarea
          id="prompt-box"
          rows={8}
          placeholder="Describe what you researched, the intended outcome, and what issue this should update. Paste images directly here."
        />
        <p className="field-help">
          Pasted images are uploaded to Linear and inserted as markdown links.
        </p>
        <div id="upload-status" className="inline-result hidden" />
        <div className="actions">
          <button id="populate-ticket" className="primary-button" type="button">
            Populate Ticket
          </button>
          <button id="share-context" className="ghost-button" type="button">
            Share Context
          </button>
          <button id="send-proxy" className="ghost-button" type="button">
            Ask Proxy
          </button>
        </div>
        <div id="proxy-response" className="inline-result hidden" />
      </section>

      <section className="panel draft-panel">
        <div className="section-header">
          <h2>Ticket Draft</h2>
          <span id="selected-issue-pill" className="badge">
            No issue selected
          </span>
        </div>
        <form id="issue-form" className="stack">
          <label className="field">
            <span>Title</span>
            <input
              id="issue-title"
              name="title"
              type="text"
              required
              placeholder="Summarize the concrete ticket outcome"
            />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              id="issue-description"
              name="description"
              rows={8}
              placeholder="The mapped ticket body from your prompt will appear here."
            />
          </label>
          <div className="actions">
            <button className="primary-button" type="submit">
              Create Issue
            </button>
            <a
              id="linear-new-link"
              className="ghost-button link-button"
              href="https://linear.new"
              target="_blank"
              rel="noreferrer"
            >
              Open in Linear
            </a>
          </div>
        </form>
        <div id="created-issue" className="inline-result hidden" />
      </section>

      <details className="panel meta-panel">
        <summary>Connections and Session</summary>
        <form id="settings-form" className="stack settings-grid">
          <label className="field">
            <span>Personal API key (optional)</span>
            <input
              id="api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              placeholder="lin_api_..."
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Default team</span>
            <select id="team-select" name="defaultTeamId">
              <option value="">Choose a team after loading Linear data</option>
            </select>
          </label>
          <label className="field">
            <span>Proxy URL</span>
            <input
              id="proxy-url"
              name="proxyUrl"
              type="url"
              autoComplete="off"
              placeholder="http://localhost:8787/chat"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Proxy token</span>
            <input
              id="proxy-token"
              name="proxyToken"
              type="password"
              autoComplete="off"
              placeholder="Optional"
              spellCheck={false}
            />
          </label>
          <div className="actions">
            <button className="primary-button" type="submit">
              Save
            </button>
            <button id="clear-settings" className="ghost-button" type="button">
              Clear
            </button>
          </div>
        </form>

        <section className="stack session-stack">
          <div className="section-header compact">
            <h3>Research Context</h3>
            <button id="clear-research" className="ghost-button small" type="button">
              Clear
            </button>
          </div>
          <div id="research-summary" className="context-card empty">
            No captures yet.
          </div>
          <div id="research-list" className="issues-list empty">
            No captured research context yet.
          </div>

          <div id="tab-context" className="context-card empty">
            Waiting for browser context.
          </div>
          <div id="selected-issue" className="context-card empty">
            No issue selected.
          </div>
          <div className="section-header compact">
            <h3>Assigned Issues</h3>
            <span id="issue-count" className="badge">
              0
            </span>
          </div>
          <div id="issues-list" className="issues-list empty">
            No Linear data loaded yet.
          </div>
        </section>
      </details>
    </main>
  )
}
