
/**
 * Sentinel CDM UI (vanilla JS)
 * All screens render from APP_* constants loaded via data.js.
 */

// ========== STATE ==========
const APP_STATE = {
  lockMode: false,
  currentScreen: "live-ops",
  approvedIssues: new Set(),
  completedDecisions: new Set(),
  feedIndex: 0,
  feedInterval: null,
  feedStarted: false,
  feedHistory: [],
  sharingIndex: 0,
  sharingInterval: null,
  agentIntervals: [],
  agentLoop: null,
  globalAutomationLoop: null,
  simulationCycle: 0,
  currentSubjectId: null,
  dataTab: "EDC",
  sort: { column: null, dir: "asc" },
  issueFilters: {
    severity: "ALL",
    custodian: "ALL",
    subject: "ALL",
    action: "ALL",
    lockImpact: "ALL",
  },
  auditTab: "audit",
};

const SCREENS = [
  "live-ops",
  "screen-agent-network",
  "data-explorer",
  "issue-inbox",
  "subject-timeline",
  "approvals",
  "user-inputs",
  "lock-readiness",
  "audit-reports",
];

const SEVERITY_ORDER = {
  LOCK_CRITICAL: 4,
  SAFETY_CRITICAL: 3,
  ENDPOINT_CRITICAL: 2,
  OPERATIONAL: 1,
};

// ========== HELPERS ==========
/** @param {string} sel */
const qs = (sel) => document.querySelector(sel);
/** @param {string} sel */
const qsa = (sel) => Array.from(document.querySelectorAll(sel));

/** @param {string} sev */
function severityLabel(sev) {
  return {
    LOCK_CRITICAL: "Lock Critical",
    SAFETY_CRITICAL: "Safety Critical",
    ENDPOINT_CRITICAL: "Endpoint Critical",
    OPERATIONAL: "Operational",
  }[sev] || sev;
}

/** @param {string} sev */
function severityClass(sev) {
  return {
    LOCK_CRITICAL: "sev-lock",
    SAFETY_CRITICAL: "sev-safety",
    ENDPOINT_CRITICAL: "sev-endpoint",
    OPERATIONAL: "sev-operational",
  }[sev] || "sev-operational";
}

/** @param {string} sev */
function severityBadge(sev) {
  const cls = {
    LOCK_CRITICAL: "lock",
    SAFETY_CRITICAL: "safety",
    ENDPOINT_CRITICAL: "endpoint",
    OPERATIONAL: "",
  }[sev] || "";
  return `<span class="badge-pill ${cls}">${severityLabel(sev)}</span>`;
}

const TERM_GLOSSARY = {
  "AE": "Adverse Event",
  "SAE": "Serious Adverse Event",
  "ALT": "ALT (liver enzyme)",
  "AST": "AST (liver enzyme)",
  "HbA1c": "HbA1c (3‑month blood sugar)",
  "MedDRA": "MedDRA (medical coding)",
};

/** @param {string} text */
function humanizeText(text) {
  if (!text) return "";
  let out = text;
  Object.keys(TERM_GLOSSARY).forEach((key) => {
    const re = new RegExp(`\\b${key}\\b`, "g");
    out = out.replace(re, TERM_GLOSSARY[key]);
  });
  return out;
}

/** @param {object} issue */
function friendlyIssueSummary(issue) {
  const title = (issue.short_title || "").toLowerCase();
  const desc = (issue.description || "").toLowerCase();
  if (title.includes("pregnan")) return "Gender and pregnancy status do not align. Needs confirmation.";
  if (title.includes("visit date") && title.includes("consent")) return "Visit appears before consent date. Verify dates with site.";
  if (title.includes("hba1c") || desc.includes("hba1c")) return "Blood sugar value looks off; likely a decimal entry error.";
  if (title.includes("glucose") && title.includes("unit")) return "Glucose units may be mislabeled. Conversion can fix.";
  if (title.includes("alt") || title.includes("ast")) return "Liver enzymes are rising over time. Medical review advised.";
  if (title.includes("specimen") || desc.includes("specimen")) return "Specimen ID appears in multiple subjects. Data integrity check needed.";
  if (title.includes("heart rate") || desc.includes("heart rate")) return "Heart rate value is implausible. Likely device glitch.";
  if (title.includes("randomization") && title.includes("missing")) return "Randomization date missing for a post‑screening visit.";
  if (title.includes("onset") && title.includes("end date")) return "Event dates are inconsistent. Confirm chronology.";
  if (title.includes("duplicate")) return "Possible duplicate record. Merge may be required.";
  if (title.includes("missing")) return "Required field is missing. Site confirmation needed.";
  return "Data inconsistency flagged for review in plain language.";
}

/** @param {string} action */
function actionChip(action) {
  const cls = {
    SELF_HEAL: "self",
    NEEDS_QUERY: "query",
    NEEDS_HUMAN_DECISION: "human",
    INFO: "info",
  }[action] || "info";
  return `<span class="chip ${cls}">${action.replace(/_/g, " ")}</span>`;
}

/** @param {string} iso */
function formatDate(iso) {
  if (!iso) return "";
  return iso.toString().slice(0, 10);
}

/** @param {string} msg @param {string} type */
function showToast(msg, type = "info") {
  const container = qs("#toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

/** @param {string} screenId @param {object} context */
function navigateTo(screenId, context = {}) {
  SCREENS.forEach((id) => {
    const el = qs(`#${id}`);
    if (el) el.classList.remove("active");
  });
  const target = qs(`#${screenId}`);
  if (target) target.classList.add("active");
  APP_STATE.currentScreen = screenId;

  qsa(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === screenId);
  });

  if (screenId === "live-ops") renderLiveOps();
  if (screenId === "screen-agent-network") renderAgentNetwork();
  if (screenId === "data-explorer") renderDataExplorer(APP_STATE.dataTab);
  if (screenId === "issue-inbox") renderIssueInbox();
  if (screenId === "subject-timeline") renderSubjectTimeline(context.subjectId);
  if (screenId === "approvals") renderApprovals();
  if (screenId === "user-inputs") renderUserInputs();
  if (screenId === "lock-readiness") renderLockReadiness();
  if (screenId === "audit-reports") renderAuditReports(APP_STATE.auditTab);
}

/** @param {string} issueId */
function openIssueModal(issueId) {
  renderIssueDetail(issueId);
  qs("#issue-detail-modal").classList.remove("hidden");
}

function closeIssueModal() {
  qs("#issue-detail-modal").classList.add("hidden");
}

// ========== RENDERERS ==========
function renderLiveOps() {
  const container = qs("#live-ops-content");
  const byCustodian = APP_ISSUES.reduce((acc, issue) => {
    acc[issue.custodian] = (acc[issue.custodian] || 0) + 1;
    return acc;
  }, {});

  const stewards = [
    { key: "edc_form_custodian", name: "EDC Steward", icon: "📋" },
    { key: "lab_signal_custodian", name: "Lab Steward", icon: "🔬" },
    { key: "safety_event_custodian", name: "Safety Steward", icon: "🛡️" },
    { key: "meds_history_custodian", name: "Meds Steward", icon: "💊" },
    { key: "device_epro_custodian", name: "Device Steward", icon: "⌚" },
  ];

  const stewardCards = stewards
    .map(
      (s) => `
      <div class="card steward-card" data-custodian="${s.key}">
        <div>
          <div class="flex-row"><span>${s.icon}</span><strong>${s.name}</strong></div>
          <div class="text-muted"><span class="live-steward-count">${byCustodian[s.key] || 0}</span> issues</div>
        </div>
        <div style="text-align:right;">
          <span class="pulse-dot ${APP_STATE.lockMode ? "readonly" : ""}"></span>
          <div class="text-muted">${APP_STATE.lockMode ? "Read-only" : "Last scan: 09:01"}</div>
        </div>
      </div>`
    )
    .join("");

  const topIssues = [...APP_ISSUES]
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])
    .slice(0, 5)
    .map(
      (issue) => `
      <div class="card issue-card ${severityClass(issue.severity)}">
        ${severityBadge(issue.severity)}
        <div><strong>${issue.short_title}</strong></div>
        <div class="text-muted">
          <a href="#" data-subject="${issue.entity_keys.subject_id || ""}" class="subject-link">${issue.entity_keys.subject_id || ""}</a>
        </div>
      </div>`
    )
    .join("");

  const totalIssues = APP_ISSUES.length;
  const counts = APP_ISSUES.reduce(
    (acc, i) => {
      acc[i.severity] = (acc[i.severity] || 0) + 1;
      return acc;
    },
    {}
  );

  const readiness = parseReadiness(APP_REPORTS.lock_readiness_pack || "");

  container.innerHTML = `
    <div class="steward-row">${stewardCards}</div>
    <div class="grid-2">
      <div class="card">
        <div class="flex-row" style="justify-content: space-between; margin-bottom: 8px;">
          <strong>Activity Feed</strong>
          <span class="text-muted">Live playback</span>
        </div>
        <div class="feed" id="activity-feed"></div>
      </div>
      <div class="card">
        <div class="flex-row" style="justify-content: space-between; margin-bottom: 8px;">
          <strong>Attention Now</strong>
          <span class="text-muted">Top 5 by severity</span>
        </div>
        <div id="attention-now-list" style="display: grid; gap: 8px;">${topIssues}</div>
      </div>
    </div>
    <div class="metrics-bar">
      <div class="metric">
        <div class="text-muted">Total Issues</div>
        <strong id="metric-total-issues">${totalIssues}</strong>
      </div>
      <div class="metric">
        <div class="text-muted">Lock Blockers</div>
        <strong id="metric-lock-blockers">${APP_LOCK_BLOCKERS.length}</strong>
      </div>
      <div class="metric">
        <div class="text-muted">Readiness</div>
        <strong id="metric-readiness">${readiness}%</strong>
      </div>
      <div class="metric">
        <div class="text-muted">Active Subjects</div>
        <strong id="metric-active-subjects">${Object.keys(APP_SUBJECT_TIMELINES).length}</strong>
      </div>
      <div class="metric">
        <div class="text-muted">Severity Mix</div>
        <div id="metric-severity-mix" class="text-muted">Lock ${counts.LOCK_CRITICAL || 0} · Safety ${counts.SAFETY_CRITICAL || 0} · Endpoint ${counts.ENDPOINT_CRITICAL || 0} · Operational ${counts.OPERATIONAL || 0}</div>
      </div>
    </div>
  `;

  initActivityFeed();
  qsa(".subject-link").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo("subject-timeline", { subjectId: el.dataset.subject });
    });
  });
}

/** Render the Agent Network screen. */
function renderAgentNetwork() {
  const container = qs("#agent-network-content");
  const agentData = typeof APP_AGENT_TREE !== "undefined" ? APP_AGENT_TREE : null;
  if (!container) return;
  if (!agentData) {
    container.innerHTML = "<div class='text-muted'>No agent network data available</div>";
    return;
  }

  const locked = APP_STATE.lockMode;
  const ingestionCards = agentData.ingestion.feeds
    .map(
      (f) => `
      <div class="ingestion-card">
        <strong>${f.name}</strong>
        <div class="text-muted"><span class="data-number" data-base="${f.records}" data-target="${f.records}">0</span> records</div>
        <div class="status ingestion-status" data-status="pending">Syncing…</div>
        <div class="text-muted">Last sync: <span class="sync-time" data-base="${f.last_sync}">${f.last_sync}</span></div>
      </div>`
    )
    .join("");

  const ingestionLines = agentData.ingestion.feeds.map(() => `<div class="flow-line"></div>`).join("");

  const stewardCustodianMap = {
    edc: "edc_form_custodian",
    lab: "lab_signal_custodian",
    safety: "safety_event_custodian",
    meds: "meds_history_custodian",
    device: "device_epro_custodian",
  };

  const stewardCards = agentData.stewards
    .map((s) => {
      const custodian = stewardCustodianMap[s.id];
      const issues = APP_ISSUES.filter((i) => i.custodian === custodian);
      const miniIssues = issues
        .slice(0, 3)
        .map((i) => `<div>${severityBadge(i.severity)} ${i.short_title}</div>`)
        .join("");
      const severity = s.by_severity
        ? `Lock ${s.by_severity.LOCK_CRITICAL || 0} · Safety ${s.by_severity.SAFETY_CRITICAL || 0} · Endpoint ${s.by_severity.ENDPOINT_CRITICAL || 0} · Operational ${s.by_severity.OPERATIONAL || 0}`
        : "";
      return `
        <div class="agent-steward" data-steward="${s.id}">
          <div class="agent-steward-header">
            <div class="flex-row"><span>${s.icon}</span><strong>${s.name}</strong></div>
            <span class="status-dot ${locked ? "readonly" : ""}"></span>
          </div>
          <div class="text-muted">${locked ? "Read-only" : "● Active"} · Checked today: <span class="data-number" data-base="${s.records_checked}" data-target="${s.records_checked}">0</span></div>
          <div class="text-muted">Issues found: <span class="data-number" data-base="${s.issues_found}" data-target="${s.issues_found}">0</span></div>
          <div class="text-muted">${severity}</div>
          <div class="text-muted">Self-healable: <span class="data-number" data-base="${s.self_healable}" data-target="${s.self_healable}">0</span></div>
          <button class="link-button steward-nav" data-nav="issue-inbox" data-custodian="${custodian}">Escalated: <span class="data-number" data-base="${s.escalated}" data-target="${s.escalated}">0</span></button>
          <div class="agent-steward-details">
            <div class="text-muted">Recent: ${s.recent_finding}</div>
            ${miniIssues || "<div class='text-muted'>No issues</div>"}
            <button class="ghost steward-nav" data-nav="issue-inbox" data-custodian="${custodian}">View all</button>
          </div>
        </div>
      `;
    })
    .join("");

  const totalEscalated = agentData.stewards.reduce((sum, s) => sum + (s.escalated || 0), 0);

  const linker = agentData.linker;
  const conductor = agentData.conductor;

  const bucketCards = Object.entries(conductor.buckets)
    .map(([key, b]) => {
      const frozen = locked ? "<div class='text-muted'>Frozen</div>" : "";
      return `
        <div class="bucket-card" data-nav="${b.nav}" data-filter="${key === "site_queries" ? "NEEDS_QUERY" : ""}">
          <div class="count data-number" data-base="${b.count}" data-target="${b.count}">0</div>
          <strong>${b.label}</strong>
          <div class="text-muted">${b.description}</div>
          ${frozen}
        </div>
      `;
    })
    .join("");

  const humanCards = [
    { label: "Approve Self-Heals", count: conductor.buckets.self_heal.count, nav: "approvals" },
    { label: "Decide Conflicts", count: conductor.buckets.human_decisions.count, nav: "user-inputs" },
    { label: "Resolve Blockers", count: conductor.buckets.lock_blockers.count, nav: "lock-readiness" },
  ]
    .map(
      (h) => `
        <div class="human-card">
          <strong>${h.label}</strong>
          <div class="text-muted"><span class="data-number" data-base="${h.count}" data-target="${h.count}">0</span> items</div>
          <button class="link-button human-link" data-nav="${h.nav}">Go →</button>
          <div class="text-muted">${locked ? "Review locked items in read-only mode" : "Pending your review"}</div>
        </div>
      `
    )
    .join("");

  const reasons = agentData.escalation_reasons
    .map((r) => `<div>• ${r}</div>`)
    .join("");

  container.innerHTML = `
    <div class="agent-network ${locked ? "locked" : ""}">
      <div>
        <div class="agent-section-title">Today's Data Ingestion Status</div>
        <div class="automation-strip">
          <div class="automation-label">Automation cycle (updates every 5s)</div>
          <div class="automation-bar"><span></span></div>
        </div>
        <div class="ingestion-grid">${ingestionCards}</div>
        <div class="flow-row">${ingestionLines}</div>
      </div>

      <div>
        <div class="agent-section-title">Layer 1: Data Stewards</div>
        <div class="steward-grid">${stewardCards}</div>
      </div>

      <div class="sharing-lane">
        <div class="sharing-line"></div>
        <div id="sharing-message" class="sharing-message"></div>
        <div class="text-muted" id="sharing-subtitle">Stewards share cross-checks before escalation</div>
      </div>

      <div class="flow-row single"><div class="flow-line"></div></div>
      <div class="flow-label">Escalated: ${totalEscalated} to Timeline Linker</div>

      <div class="linker-card">
        <div class="flex-row"><span>${linker.icon}</span><strong>${linker.name}</strong></div>
        <div class="text-muted">Correlating findings across stewards · Building subject timelines</div>
        <div class="text-muted"><span class="data-number" data-base="${linker.case_packets_created}" data-target="${linker.case_packets_created}">0</span> case packets · <span class="data-number" data-base="${linker.cross_links}" data-target="${linker.cross_links}">0</span> cross-links</div>
        <div class="text-muted">Recent: ${linker.recent}</div>
      </div>

      <div class="flow-row single"><div class="flow-line"></div></div>
      <div class="flow-label">Classified: ${conductor.total_classified} issues routed to governance</div>

      <div class="conductor-card">
        <div class="flex-row"><span>${conductor.icon}</span><strong>${conductor.name}</strong></div>
        <div class="text-muted">Classifying issues · Enforcing governance · Routing decisions</div>
        <div class="conductor-buckets">${bucketCards}</div>
      </div>

      <div class="flow-row triple">
        <div class="flow-line"></div>
        <div class="flow-line"></div>
        <div class="flow-line"></div>
      </div>

      <div>
        <div class="agent-section-title">Layer 4: Human Review</div>
        <div class="human-grid">${humanCards}</div>
      </div>

      <div class="escalation-reasons">
        <strong>Why escalation happens</strong>
        <div class="text-muted" style="margin-top:6px;">${reasons}</div>
      </div>
    </div>
  `;

  qsa(".agent-steward").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".steward-nav")) return;
      card.classList.toggle("expanded");
    });
  });

  qsa(".steward-nav").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const custodian = btn.dataset.custodian || "ALL";
      APP_STATE.issueFilters = { ...APP_STATE.issueFilters, custodian, action: "ALL", severity: "ALL", subject: "ALL", lockImpact: "ALL" };
      navigateTo("issue-inbox");
    });
  });

  qsa(".bucket-card").forEach((card) => {
    card.addEventListener("click", () => {
      const nav = card.dataset.nav;
      if (card.dataset.filter === "NEEDS_QUERY") {
        APP_STATE.issueFilters = { ...APP_STATE.issueFilters, action: "NEEDS_QUERY" };
      }
      if (nav) navigateTo(nav);
    });
  });

  qsa(".human-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo(link.dataset.nav);
    });
  });

  initSharingLane(agentData.sharing_messages, locked);
  simulateAgentNetwork(locked);
  startAgentLoop();
}

function initActivityFeed() {
  const feed = qs("#activity-feed");
  if (!feed) return;
  feed.innerHTML = APP_STATE.feedHistory.join("");
  if (APP_STATE.feedInterval) clearInterval(APP_STATE.feedInterval);

  if (!APP_STATE.feedStarted) {
    APP_STATE.feedIndex = 0;
    APP_STATE.feedStarted = true;
  }

  const renderItem = () => {
    const item = APP_ACTIVITY_FEED[APP_STATE.feedIndex % APP_ACTIVITY_FEED.length];
    const html = renderFeedItemHTML(item);
    APP_STATE.feedHistory.push(html);
    if (APP_STATE.feedHistory.length > 120) {
      APP_STATE.feedHistory = APP_STATE.feedHistory.slice(-120);
    }
    feed.insertAdjacentHTML("beforeend", html);
    feed.scrollTop = feed.scrollHeight;
    qsa(".subject-link").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        navigateTo("subject-timeline", { subjectId: el.dataset.subject });
      });
    });
    APP_STATE.feedIndex += 1;
  };
  if (!feed.children.length) renderItem();
  qsa(".subject-link").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo("subject-timeline", { subjectId: el.dataset.subject });
    });
  });
  APP_STATE.feedInterval = setInterval(renderItem, 2000);
}

/** @param {object} item */
function renderFeedItemHTML(item) {
  const timeNow = new Date().toTimeString().slice(0, 8);
  const subjectLink = item.subject ? `<a href="#" class="subject-link" data-subject="${item.subject}">${item.subject}</a>` : "";
  return `
    <div class="feed-item ${item.severity || "info"}">
      <div>${timeNow}</div>
      <div>${item.icon || "•"}</div>
      <div>
        <strong>${item.agent || "System"}</strong> — ${item.message || "Update received."} ${subjectLink}
      </div>
    </div>
  `;
}
/** @param {string} tab */
function renderDataExplorer(tab = "EDC") {
  APP_STATE.dataTab = tab;
  const container = qs("#data-explorer-content");
  const tabMap = {
    EDC: { data: APP_SAMPLE_EDC, label: "EDC" },
    Labs: { data: APP_SAMPLE_LABS, label: "Labs" },
    Safety: { data: APP_SAMPLE_SAFETY, label: "Safety" },
    Meds: { data: APP_SAMPLE_MEDS, label: "Meds" },
    Device: { data: APP_SAMPLE_DEVICE, label: "Device" },
  };
  const current = tabMap[tab] || tabMap.EDC;

  const tabs = Object.keys(tabMap)
    .map(
      (key) => `<button class="${key === tab ? "active" : ""}" data-tab="${key}">${tabMap[key].label}</button>`
    )
    .join("");

  container.innerHTML = `
    <div class="card">
      <div class="table-controls">
        <div class="table-tabs">${tabs}</div>
        <input id="table-search" type="text" placeholder="Search" />
        <div id="row-count" class="text-muted"></div>
      </div>
      <div id="data-table"></div>
    </div>
  `;

  qsa(".table-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => renderDataExplorer(btn.dataset.tab));
  });

  const search = qs("#table-search");
  const renderTable = () => {
    const filtered = filterTable(current.data, search.value);
    const sorted = sortTable(filtered);
    qs("#row-count").textContent = `Showing ${sorted.length} of ${current.data.length} rows`;
    qs("#data-table").innerHTML = buildTable(sorted, tabToSourceFile(tab));
    qsa(".data-table th").forEach((th) => {
      th.addEventListener("click", () => {
        APP_STATE.sort.column = th.dataset.col;
        APP_STATE.sort.dir = APP_STATE.sort.dir === "asc" ? "desc" : "asc";
        renderTable();
      });
    });
    qsa(".flagged-row").forEach((row) => {
      row.addEventListener("click", () => {
        const issueId = row.dataset.issue;
        if (issueId) openIssueModal(issueId);
      });
    });
  };
  search.addEventListener("keyup", renderTable);
  renderTable();
}

/** @param {Array} messages @param {boolean} locked */
function initSharingLane(messages, locked) {
  const messageEl = qs("#sharing-message");
  if (!messageEl) return;
  if (APP_STATE.sharingInterval) clearInterval(APP_STATE.sharingInterval);
  APP_STATE.sharingInterval = null;
  APP_STATE.sharingIndex = 0;

  if (!messages || !messages.length) {
    messageEl.textContent = "No sharing messages available";
    messageEl.style.animation = "none";
    messageEl.style.left = "12px";
    return;
  }

  if (locked) {
    messageEl.textContent = "Monitoring only — no new proposals";
    messageEl.style.animation = "none";
    messageEl.style.left = "12px";
    return;
  }

  const showMessage = () => {
    const item = messages[APP_STATE.sharingIndex % messages.length];
    messageEl.textContent = `${item.from} → ${item.to}: ${item.msg}`;
    messageEl.style.animation = "none";
    void messageEl.offsetHeight;
    messageEl.style.animation = "";
    APP_STATE.sharingIndex += 1;
  };

  showMessage();
  APP_STATE.sharingInterval = setInterval(showMessage, 3000);
}

/** @param {HTMLElement} el @param {number} target */
function animateNumber(el, target) {
  const duration = 900;
  const start = 0;
  const startTime = performance.now();
  const step = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const value = Math.round(start + (target - start) * progress);
    el.textContent = value.toString();
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

/** @param {boolean} locked */
function simulateAgentNetwork(locked) {
  APP_STATE.agentIntervals.forEach((id) => clearTimeout(id));
  APP_STATE.agentIntervals = [];

  const numbers = qsa("#agent-network-content .data-number");
  numbers.forEach((el) => {
    if (locked) {
      el.textContent = el.dataset.target || "0";
    } else {
      el.textContent = "0";
    }
  });

  const statuses = qsa("#agent-network-content .ingestion-status");
  const syncTimes = qsa("#agent-network-content .sync-time");
  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 8);
  if (locked) {
    statuses.forEach((s) => {
      s.textContent = "✓ ingested";
      s.classList.remove("syncing");
    });
    syncTimes.forEach((s) => {
      s.textContent = s.dataset.base || timeStr;
    });
    return;
  }

  statuses.forEach((s, i) => {
    s.textContent = "Syncing…";
    s.classList.add("syncing");
    const t = setTimeout(() => {
      s.textContent = "✓ ingested";
      s.classList.remove("syncing");
    }, 400 + i * 250);
    APP_STATE.agentIntervals.push(t);
  });

  const jitterValue = (base) => {
    if (base >= 500) return Math.max(0, Math.round(base + (Math.random() * 40 - 20)));
    if (base >= 50) return Math.max(0, Math.round(base + (Math.random() * 6 - 3)));
    return Math.max(0, Math.round(base + (Math.random() * 2 - 1)));
  };

  const animateAll = () => {
    numbers.forEach((el) => {
      const base = Number(el.dataset.base || el.dataset.target || 0);
      const target = jitterValue(base);
      el.dataset.target = String(target);
      animateNumber(el, target);
    });
    syncTimes.forEach((s) => {
      s.textContent = timeStr;
    });
  };

  const t = setTimeout(animateAll, 1200);
  APP_STATE.agentIntervals.push(t);
}

function startAgentLoop() {
  if (APP_STATE.agentLoop) clearInterval(APP_STATE.agentLoop);
  APP_STATE.agentLoop = setInterval(() => {
    if (APP_STATE.currentScreen !== "screen-agent-network") return;
    simulateAgentNetwork(APP_STATE.lockMode);
  }, 5000);
}

const CUSTODIAN_RUNTIME = {
  edc_form_custodian: { actor: "EDC_CUSTODIAN", source_file: "edc_visits.csv", entity_type: "VISIT", agent: "EDC Steward", icon: "📋", steward_id: "edc" },
  lab_signal_custodian: { actor: "LAB_CUSTODIAN", source_file: "labs.csv", entity_type: "LAB", agent: "Lab Steward", icon: "🔬", steward_id: "lab" },
  safety_event_custodian: { actor: "SAFETY_CUSTODIAN", source_file: "safety_ae.csv", entity_type: "AE", agent: "Safety Steward", icon: "🛡️", steward_id: "safety" },
  meds_history_custodian: { actor: "MEDS_CUSTODIAN", source_file: "meds.csv", entity_type: "MED", agent: "Meds Steward", icon: "💊", steward_id: "meds" },
  device_epro_custodian: { actor: "DEVICE_CUSTODIAN", source_file: "device_epro.csv", entity_type: "DEVICE", agent: "Device Steward", icon: "⌚", steward_id: "device" },
};

const RUNTIME_TEMPLATES = [
  { custodian: "edc_form_custodian", severity: "OPERATIONAL", action: "NEEDS_QUERY", short_title: "Visit date requires confirmation", description: "System detected a visit chronology mismatch that needs site confirmation." },
  { custodian: "edc_form_custodian", severity: "ENDPOINT_CRITICAL", action: "NEEDS_HUMAN_DECISION", short_title: "HbA1c value seems inconsistent", description: "System detected a possible decimal placement issue in endpoint data." },
  { custodian: "lab_signal_custodian", severity: "OPERATIONAL", action: "SELF_HEAL", short_title: "Glucose unit mismatch detected", description: "System detected a likely unit labeling issue and proposed a conversion." },
  { custodian: "lab_signal_custodian", severity: "SAFETY_CRITICAL", action: "INFO", short_title: "Liver trend needs clinical review", description: "System detected a rising liver enzyme pattern that should be reviewed." },
  { custodian: "safety_event_custodian", severity: "LOCK_CRITICAL", action: "NEEDS_QUERY", short_title: "AE chronology needs correction", description: "System detected onset and end dates that are out of sequence." },
  { custodian: "safety_event_custodian", severity: "SAFETY_CRITICAL", action: "NEEDS_HUMAN_DECISION", short_title: "Serious event missing attribution", description: "System detected missing seriousness details in a serious event record." },
  { custodian: "meds_history_custodian", severity: "OPERATIONAL", action: "SELF_HEAL", short_title: "Medication standardization proposed", description: "System detected medication naming variation and proposed standardization." },
  { custodian: "meds_history_custodian", severity: "OPERATIONAL", action: "NEEDS_HUMAN_DECISION", short_title: "Medication history contradiction", description: "System detected a conflict between medication history and investigator notes." },
  { custodian: "device_epro_custodian", severity: "SAFETY_CRITICAL", action: "INFO", short_title: "Device spike flagged for review", description: "System detected an implausible device measurement spike." },
  { custodian: "device_epro_custodian", severity: "OPERATIONAL", action: "NEEDS_QUERY", short_title: "Device compliance gap detected", description: "System detected a multi-day gap in device submissions." },
];

/** @param {Array} list */
function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function nowIso() {
  return new Date().toISOString();
}

function subjectIdsFromData() {
  const fromTimeline = Object.keys(APP_SUBJECT_TIMELINES || {});
  if (fromTimeline.length) return fromTimeline;
  const fromIssues = APP_ISSUES.map((i) => i.entity_keys?.subject_id).filter(Boolean);
  return Array.from(new Set(fromIssues));
}

/** @param {string} subjectId */
function siteForSubject(subjectId) {
  const timeline = APP_SUBJECT_TIMELINES[subjectId];
  if (timeline?.site_id) return timeline.site_id;
  const issue = APP_ISSUES.find((i) => i.entity_keys?.subject_id === subjectId);
  return issue?.entity_keys?.site_id || "SITE-A";
}

function nextIssueId() {
  APP_STATE.simulationCycle += 1;
  return `SIM-${Date.now()}-${APP_STATE.simulationCycle}`;
}

/** @param {object} issue */
function pushQueueForIssue(issue) {
  if (issue.suggested_action === "SELF_HEAL") APP_PENDING_APPROVALS.push(issue);
  if (issue.suggested_action === "NEEDS_HUMAN_DECISION") APP_HUMAN_DECISIONS.push(issue);
  if (issue.suggested_action === "NEEDS_QUERY") APP_SITE_QUERIES.push(issue);
  if (issue.severity === "LOCK_CRITICAL") APP_LOCK_BLOCKERS.push(issue);
}

/** @param {object} issue */
function appendAuditForIssue(issue) {
  const actor = CUSTODIAN_RUNTIME[issue.custodian]?.actor || "SYSTEM";
  APP_AUDIT_LOG.push({
    event_id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: nowIso(),
    actor,
    action: "DETECT",
    references: { issue_ids: [issue.issue_id], subject_ids: [issue.entity_keys.subject_id] },
    payload: { summary: issue.short_title },
  });
}

/** @param {object} issue */
function appendActivityForIssue(issue) {
  const meta = CUSTODIAN_RUNTIME[issue.custodian];
  const sev = issue.severity === "LOCK_CRITICAL" || issue.severity === "SAFETY_CRITICAL" ? "critical" : issue.severity === "ENDPOINT_CRITICAL" ? "warning" : "info";
  APP_ACTIVITY_FEED.push({
    time: new Date().toTimeString().slice(0, 8),
    agent: meta?.agent || "System",
    icon: meta?.icon || "•",
    message: `${issue.short_title} for ${issue.entity_keys.subject_id}. Pending your review.`,
    severity: sev,
    subject: issue.entity_keys.subject_id,
  });
  if (APP_ACTIVITY_FEED.length > 300) {
    APP_ACTIVITY_FEED.splice(0, APP_ACTIVITY_FEED.length - 300);
  }
}

/** @param {object} issue */
function updateAgentTreeFromIssue(issue) {
  if (typeof APP_AGENT_TREE === "undefined") return;
  const meta = CUSTODIAN_RUNTIME[issue.custodian];
  if (!meta) return;
  const steward = (APP_AGENT_TREE.stewards || []).find((s) => s.id === meta.steward_id);
  if (!steward) return;

  const ingestFeedMap = {
    edc: "EDC Visits",
    lab: "Labs",
    safety: "Safety AE",
    meds: "Medications",
    device: "Device/ePRO",
  };

  const feedName = ingestFeedMap[meta.steward_id];
  const feed = (APP_AGENT_TREE.ingestion?.feeds || []).find((f) => f.name === feedName);
  const checkedDelta = 5 + Math.floor(Math.random() * 16);
  if (feed) {
    feed.records += checkedDelta;
    feed.last_sync = new Date().toTimeString().slice(0, 8);
  }

  steward.records_checked += checkedDelta;
  steward.issues_found += 1;
  steward.by_severity[issue.severity] = (steward.by_severity[issue.severity] || 0) + 1;
  if (issue.suggested_action === "SELF_HEAL") steward.self_healable += 1;
  else steward.escalated += 1;
  steward.recent_finding = issue.short_title;

  if (APP_AGENT_TREE.linker) {
    APP_AGENT_TREE.linker.total_issues_received += 1;
    APP_AGENT_TREE.linker.issues_enriched += 1;
    APP_AGENT_TREE.linker.cross_links += Math.random() > 0.7 ? 1 : 0;
    APP_AGENT_TREE.linker.recent = `Linked ${issue.short_title.toLowerCase()} for ${issue.entity_keys.subject_id}`;
  }

  if (APP_AGENT_TREE.conductor) {
    APP_AGENT_TREE.conductor.total_classified += 1;
    if (issue.suggested_action === "SELF_HEAL") APP_AGENT_TREE.conductor.buckets.self_heal.count += 1;
    if (issue.suggested_action === "NEEDS_QUERY") APP_AGENT_TREE.conductor.buckets.site_queries.count += 1;
    if (issue.suggested_action === "NEEDS_HUMAN_DECISION") APP_AGENT_TREE.conductor.buckets.human_decisions.count += 1;
    if (issue.severity === "LOCK_CRITICAL") APP_AGENT_TREE.conductor.buckets.lock_blockers.count += 1;
  }
}

/** @param {object} issue */
function appendSampleRows(issue) {
  const subject = issue.entity_keys.subject_id;
  const now = nowIso();
  if (issue.custodian === "edc_form_custodian") {
    APP_SAMPLE_EDC.push({
      study_id: "CDM-OPS",
      site_id: issue.entity_keys.site_id || "SITE-A",
      subject_id: subject,
      consent_date: now.slice(0, 10),
      randomization_date: now.slice(0, 10),
      visit_name: randomItem(["SCREENING", "BASELINE", "WEEK4", "WEEK8"]),
      visit_date: now.slice(0, 10),
      sex: randomItem(["M", "F"]),
      age: 25 + Math.floor(Math.random() * 50),
      pregnancy_status: randomItem(["N", "Y"]),
      endpoint_hba1c: (6 + Math.random() * 4).toFixed(1),
      endpoint_hba1c_unit: "%",
      investigator_notes: "System detected follow-up row for automation.",
    });
  }
  if (issue.custodian === "lab_signal_custodian") {
    APP_SAMPLE_LABS.push({
      study_id: "CDM-OPS",
      site_id: issue.entity_keys.site_id || "SITE-A",
      subject_id: subject,
      lab_vendor: randomItem(["CENTRAL_A", "LOCAL"]),
      specimen_id: `SP-${Math.floor(Math.random() * 90000 + 10000)}`,
      collection_datetime: now,
      received_datetime: now,
      test_name: randomItem(["ALT", "AST", "GLUCOSE"]),
      result_value: Number((2 + Math.random() * 120).toFixed(2)),
      result_unit: randomItem(["U/L", "mg/dL", "mmol/L"]),
      ref_low: 7,
      ref_high: 110,
      abnormal_flag: randomItem(["N", "H", "L"]),
    });
  }
  if (issue.custodian === "safety_event_custodian") {
    APP_SAMPLE_SAFETY.push({
      study_id: "CDM-OPS",
      site_id: issue.entity_keys.site_id || "SITE-A",
      subject_id: subject,
      ae_term: randomItem(["Nausea", "Headache", "Fatigue", "Dizziness"]),
      meddra_code: String(1000 + Math.floor(Math.random() * 8000)),
      seriousness: randomItem(["SERIOUS", "NON-SERIOUS"]),
      onset_date: now.slice(0, 10),
      end_date: now.slice(0, 10),
      severity: randomItem(["MILD", "MODERATE", "SEVERE"]),
      relatedness: randomItem(["RELATED", "NOT RELATED", "UNKNOWN"]),
      narrative: "System detected a new safety narrative row for simulation.",
    });
  }
  if (issue.custodian === "meds_history_custodian") {
    APP_SAMPLE_MEDS.push({
      study_id: "CDM-OPS",
      site_id: issue.entity_keys.site_id || "SITE-A",
      subject_id: subject,
      med_name_raw: randomItem(["Metformin", "Lipitor", "Aspirin"]),
      med_name_std: randomItem(["Metformin", "Atorvastatin", "Aspirin"]),
      start_date: now.slice(0, 10),
      end_date: now.slice(0, 10),
      indication: randomItem(["Diabetes", "Hypertension", "Lipid control"]),
    });
  }
  if (issue.custodian === "device_epro_custodian") {
    APP_SAMPLE_DEVICE.push({
      study_id: "CDM-OPS",
      subject_id: subject,
      device_type: "WEARABLE_A",
      metric: randomItem(["steps", "heart_rate"]),
      event_datetime: now,
      value: Number((60 + Math.random() * 9000).toFixed(1)),
      timezone_offset_minutes: randomItem([-330, -300, -240]),
    });
  }
}

function buildRuntimeIssue() {
  const template = randomItem(RUNTIME_TEMPLATES);
  const subjects = subjectIdsFromData();
  const subject_id = randomItem(subjects);
  const site_id = siteForSubject(subject_id);
  const meta = CUSTODIAN_RUNTIME[template.custodian];
  const sourceArrayMap = {
    "edc_visits.csv": APP_SAMPLE_EDC,
    "labs.csv": APP_SAMPLE_LABS,
    "safety_ae.csv": APP_SAMPLE_SAFETY,
    "meds.csv": APP_SAMPLE_MEDS,
    "device_epro.csv": APP_SAMPLE_DEVICE,
  };
  const arr = sourceArrayMap[meta.source_file] || [];
  const row_id = arr.length ? Math.floor(Math.random() * arr.length) : 0;

  const issue = {
    issue_id: nextIssueId(),
    custodian: template.custodian,
    detected_at: nowIso(),
    severity: template.severity,
    confidence: Number((0.72 + Math.random() * 0.25).toFixed(2)),
    entity_type: meta.entity_type,
    entity_keys: { subject_id, site_id },
    short_title: template.short_title,
    description: template.description,
    evidence: [
      {
        source_file: meta.source_file,
        row_id,
        column: "subject_id",
        value: subject_id,
        note: "System detected this during the latest inflow cycle.",
      },
    ],
    suggested_action: template.action,
    proposed_change: null,
  };

  if (template.action === "SELF_HEAL") {
    issue.proposed_change = {
      change_type: randomItem(["UPDATE_VALUE", "CONVERT_UNIT", "MERGE_DUPLICATE"]),
      before: { value: "original" },
      after: { value: "normalized" },
      requires_approval: true,
      affects_lock: template.severity === "LOCK_CRITICAL",
    };
  }
  return issue;
}

function refreshLiveOpsDynamic() {
  const liveRoot = qs("#live-ops-content");
  if (!liveRoot) return;
  const byCustodian = APP_ISSUES.reduce((acc, issue) => {
    acc[issue.custodian] = (acc[issue.custodian] || 0) + 1;
    return acc;
  }, {});

  qsa(".steward-card[data-custodian]").forEach((card) => {
    const key = card.dataset.custodian;
    const count = card.querySelector(".live-steward-count");
    if (count) count.textContent = String(byCustodian[key] || 0);
  });

  const totalIssues = APP_ISSUES.length;
  const lockCount = APP_LOCK_BLOCKERS.length;
  const counts = APP_ISSUES.reduce((acc, i) => {
    acc[i.severity] = (acc[i.severity] || 0) + 1;
    return acc;
  }, {});

  const totalEl = qs("#metric-total-issues");
  const lockEl = qs("#metric-lock-blockers");
  const readinessEl = qs("#metric-readiness");
  const activeSubjectsEl = qs("#metric-active-subjects");
  const mixEl = qs("#metric-severity-mix");
  if (totalEl) totalEl.textContent = String(totalIssues);
  if (lockEl) lockEl.textContent = String(lockCount);
  if (readinessEl) {
    const dynamicReadiness = Math.max(45, 88 - Math.floor(totalIssues / 20) - lockCount);
    readinessEl.textContent = `${dynamicReadiness}%`;
  }
  if (activeSubjectsEl) activeSubjectsEl.textContent = String(Object.keys(APP_SUBJECT_TIMELINES).length);
  if (mixEl) {
    mixEl.textContent = `Lock ${counts.LOCK_CRITICAL || 0} · Safety ${counts.SAFETY_CRITICAL || 0} · Endpoint ${counts.ENDPOINT_CRITICAL || 0} · Operational ${counts.OPERATIONAL || 0}`;
  }

  const topIssues = [...APP_ISSUES]
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])
    .slice(0, 5)
    .map((issue) => `
      <div class="card issue-card ${severityClass(issue.severity)}">
        ${severityBadge(issue.severity)}
        <div><strong>${issue.short_title}</strong></div>
        <div class="text-muted">
          <a href="#" data-subject="${issue.entity_keys.subject_id || ""}" class="subject-link">${issue.entity_keys.subject_id || ""}</a>
        </div>
      </div>`)
    .join("");
  const attention = qs("#attention-now-list");
  if (attention) attention.innerHTML = topIssues;

  qsa(".subject-link").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo("subject-timeline", { subjectId: el.dataset.subject });
    });
  });
}

function refreshCurrentScreen() {
  if (APP_STATE.currentScreen === "live-ops") refreshLiveOpsDynamic();
  if (APP_STATE.currentScreen === "screen-agent-network") renderAgentNetwork();
  if (APP_STATE.currentScreen === "data-explorer") renderDataExplorer(APP_STATE.dataTab);
  if (APP_STATE.currentScreen === "issue-inbox") renderIssueInbox();
  if (APP_STATE.currentScreen === "subject-timeline") renderSubjectTimeline(APP_STATE.currentSubjectId);
  if (APP_STATE.currentScreen === "approvals") renderApprovals();
  if (APP_STATE.currentScreen === "user-inputs") renderUserInputs();
  if (APP_STATE.currentScreen === "lock-readiness") renderLockReadiness();
  if (APP_STATE.currentScreen === "audit-reports") renderAuditReports(APP_STATE.auditTab);
}

function runAutomationTick() {
  if (APP_STATE.lockMode) return;
  const newIssuesCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < newIssuesCount; i += 1) {
    const issue = buildRuntimeIssue();
    APP_ISSUES.push(issue);
    pushQueueForIssue(issue);
    appendAuditForIssue(issue);
    appendActivityForIssue(issue);
    appendSampleRows(issue);
    updateAgentTreeFromIssue(issue);
  }
  updateBadges();
  refreshCurrentScreen();
}

function startGlobalAutomation() {
  if (APP_STATE.globalAutomationLoop) clearInterval(APP_STATE.globalAutomationLoop);
  APP_STATE.globalAutomationLoop = setInterval(runAutomationTick, 5000);
}

/** @param {string} tab */
function tabToSourceFile(tab) {
  return {
    EDC: "edc_visits.csv",
    Labs: "labs.csv",
    Safety: "safety_ae.csv",
    Meds: "meds.csv",
    Device: "device_epro.csv",
  }[tab];
}

/** @param {Array} data @param {string} q */
function filterTable(data, q) {
  if (!q) return data;
  const needle = q.toLowerCase();
  return data.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
}

/** @param {Array} data */
function sortTable(data) {
  const { column, dir } = APP_STATE.sort;
  if (!column) return data;
  const sorted = [...data].sort((a, b) => {
    const av = (a[column] || "").toString();
    const bv = (b[column] || "").toString();
    return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  return sorted;
}

/** @param {Array} data @param {string} sourceFile */
function buildTable(data, sourceFile) {
  if (!data.length) return `<div class="text-muted">No items match your filters</div>`;
  const columns = Object.keys(data[0]);
  const flagged = flaggedRowsBySource(sourceFile);
  const rows = data
    .map((row, index) => {
      const issueId = flagged.get(index);
      const flaggedClass = issueId ? "flagged-row row-flagged" : "";
      const cells = columns.map((c) => `<td>${row[c] ?? ""}</td>`).join("");
      return `<tr class="${flaggedClass}" data-issue="${issueId || ""}">${cells}</tr>`;
    })
    .join("");
  const headers = columns.map((c) => `<th data-col="${c}">${c}</th>`).join("");
  return `<table class="data-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** @param {string} sourceFile */
function flaggedRowsBySource(sourceFile) {
  const map = new Map();
  APP_ISSUES.forEach((issue) => {
    (issue.evidence || []).forEach((ev) => {
      if (ev.source_file === sourceFile) {
        if (!map.has(ev.row_id)) {
          map.set(ev.row_id, issue.issue_id);
        }
      }
    });
  });
  return map;
}

function renderIssueInbox() {
  const container = qs("#issue-inbox-content");
  const subjects = Array.from(new Set(APP_ISSUES.map((i) => i.entity_keys.subject_id).filter(Boolean)));
  const custodians = Array.from(new Set(APP_ISSUES.map((i) => i.custodian)));

  const filterRow = `
    <div class="card">
      <div class="table-controls">
        <select id="filter-severity">
          <option value="ALL">All severities</option>
          <option value="LOCK_CRITICAL">Lock Critical</option>
          <option value="SAFETY_CRITICAL">Safety Critical</option>
          <option value="ENDPOINT_CRITICAL">Endpoint Critical</option>
          <option value="OPERATIONAL">Operational</option>
        </select>
        <select id="filter-custodian">
          <option value="ALL">All stewards</option>
          ${custodians.map((c) => `<option value="${c}">${c}</option>`).join("")}
        </select>
        <select id="filter-subject">
          <option value="ALL">All subjects</option>
          ${subjects.map((s) => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <select id="filter-action">
          <option value="ALL">All actions</option>
          <option value="SELF_HEAL">Self Heal</option>
          <option value="NEEDS_QUERY">Needs Query</option>
          <option value="NEEDS_HUMAN_DECISION">Needs Human Decision</option>
          <option value="INFO">Info</option>
        </select>
        <select id="filter-lock">
          <option value="ALL">Lock Impact: All</option>
          <option value="YES">Lock Impact: Yes</option>
          <option value="NO">Lock Impact: No</option>
        </select>
      </div>
      <div id="issue-summary" class="text-muted"></div>
    </div>
  `;

  container.innerHTML = `${filterRow}<div id="issue-cards" style="display:grid; gap:12px; margin-top:12px;"></div>`;

  qs("#filter-severity").value = APP_STATE.issueFilters.severity;
  qs("#filter-custodian").value = APP_STATE.issueFilters.custodian;
  qs("#filter-subject").value = APP_STATE.issueFilters.subject;
  qs("#filter-action").value = APP_STATE.issueFilters.action;
  qs("#filter-lock").value = APP_STATE.issueFilters.lockImpact;

  const applyFilters = () => {
    const severity = qs("#filter-severity").value;
    const custodian = qs("#filter-custodian").value;
    const subject = qs("#filter-subject").value;
    const action = qs("#filter-action").value;
    const lock = qs("#filter-lock").value;

    APP_STATE.issueFilters = { severity, custodian, subject, action, lockImpact: lock };

    let filtered = APP_ISSUES;
    if (severity !== "ALL") filtered = filtered.filter((i) => i.severity === severity);
    if (custodian !== "ALL") filtered = filtered.filter((i) => i.custodian === custodian);
    if (subject !== "ALL") filtered = filtered.filter((i) => i.entity_keys.subject_id === subject);
    if (action !== "ALL") filtered = filtered.filter((i) => i.suggested_action === action);
    if (lock !== "ALL") {
      filtered = filtered.filter((i) => {
        const lockImpact = i.severity === "LOCK_CRITICAL" || i.proposed_change?.affects_lock;
        return lock === "YES" ? lockImpact : !lockImpact;
      });
    }

    qs("#issue-summary").textContent = `${filtered.length} total · ${countBy(filtered, "LOCK_CRITICAL")} Lock Critical · ${countBy(filtered, "SAFETY_CRITICAL")} Safety Critical · ${countBy(filtered, "ENDPOINT_CRITICAL")} Endpoint Critical · ${countBy(filtered, "OPERATIONAL")} Operational`;

    qs("#issue-cards").innerHTML = filtered
      .map(
        (issue) => `
        <div class="card issue-card ${severityClass(issue.severity)}" data-issue="${issue.issue_id}">
          ${severityBadge(issue.severity)}
          <strong>${issue.short_title}</strong>
          <div class="text-muted">${issue.entity_keys.subject_id || ""} · ${issue.entity_keys.site_id || ""}</div>
          <div class="text-muted">${issue.custodian.replace(/_/g, " ")}</div>
          <div class="friendly">${friendlyIssueSummary(issue)}</div>
          <div class="confidence-bar"><span style="width:${Math.round(issue.confidence * 100)}%"></span></div>
          ${actionChip(issue.suggested_action)}
          <div class="text-muted" style="text-align:right;">${formatDate(issue.detected_at)}</div>
        </div>`
      )
      .join("");

    qsa("#issue-cards .issue-card").forEach((card) => {
      card.addEventListener("click", () => openIssueModal(card.dataset.issue));
    });
  };

  qsa("#filter-severity, #filter-custodian, #filter-subject, #filter-action, #filter-lock").forEach((el) => {
    el.addEventListener("change", applyFilters);
  });

  applyFilters();
  updateBadges();
}

/** @param {Array} issues @param {string} severity */
function countBy(issues, severity) {
  return issues.filter((i) => i.severity === severity).length;
}

/** @param {string} issueId */
function renderIssueDetail(issueId) {
  const issue = APP_ISSUES.find((i) => i.issue_id === issueId);
  if (!issue) return;

  const impactSafety = issue.severity === "SAFETY_CRITICAL" ? "Yes" : "No";
  const impactEndpoint = issue.severity === "ENDPOINT_CRITICAL" ? "Yes" : "No";
  const impactLock = issue.severity === "LOCK_CRITICAL" || issue.proposed_change?.affects_lock ? "Yes" : "No";

  const evidenceRows = (issue.evidence || [])
    .map(
      (e) => `<tr><td>${e.source_file}</td><td>${e.row_id}</td><td>${e.column}</td><td>${e.value}</td><td>${e.note}</td></tr>`
    )
    .join("");

  const proposed = issue.proposed_change
    ? `
      <div class="card" style="margin-top:12px;">
        <strong>Proposed Change</strong>
        <div class="grid-2" style="margin-top:8px;">
          <div style="background:#FEE2E2; padding:8px; border-radius:8px;">Before<br>${JSON.stringify(issue.proposed_change.before)}</div>
          <div style="background:#DCFCE7; padding:8px; border-radius:8px;">After<br>${JSON.stringify(issue.proposed_change.after)}</div>
        </div>
        <div class="text-muted" style="margin-top:6px;">Requires approval: ${issue.proposed_change.requires_approval} · Affects lock: ${issue.proposed_change.affects_lock}</div>
      </div>
    `
    : "";

  const actions = buildIssueActions(issue);
  const audit = APP_AUDIT_LOG.filter((a) => (a.references?.issue_ids || []).includes(issue.issue_id)).slice(-3);
  const auditRows = audit
    .map((a) => `<div class="text-muted">${a.timestamp} · ${a.actor} · ${a.action}</div>`)
    .join("");

  qs("#issue-detail-content").innerHTML = `
    <div>
      ${severityBadge(issue.severity)}
      <h2>${issue.short_title}</h2>
      <div class="text-muted">${issue.custodian.replace(/_/g, " ")} · Confidence ${Math.round(issue.confidence * 100)}%</div>
      <div class="text-muted">Subject ${issue.entity_keys.subject_id || ""}</div>
    </div>
    <div class="card" style="margin-top:12px;">
      <strong>Evidence</strong>
      <table class="data-table" style="margin-top:8px;">
        <thead><tr><th>Source</th><th>Row</th><th>Column</th><th>Value</th><th>Note</th></tr></thead>
        <tbody>${evidenceRows}</tbody>
      </table>
    </div>
    <div class="flex-row" style="margin-top:12px;">
      <span class="chip ${impactSafety === "Yes" ? "human" : ""}">Safety Impact: ${impactSafety}</span>
      <span class="chip ${impactEndpoint === "Yes" ? "human" : ""}">Endpoint Impact: ${impactEndpoint}</span>
      <span class="chip ${impactLock === "Yes" ? "human" : ""}">Lock Impact: ${impactLock}</span>
    </div>
    <div class="card" style="margin-top:12px;">
      <strong>Plain‑Language Summary</strong>
      <p>${friendlyIssueSummary(issue)}</p>
    </div>
    <div class="card" style="margin-top:12px;">
      <strong>Why This Matters</strong>
      <p>${humanizeText(issue.description)}</p>
    </div>
    ${proposed}
    <div class="modal-actions">${actions}</div>
    <div class="card" style="margin-top:12px;">
      <strong>Mini Audit Trail</strong>
      ${auditRows || "<div class=\"text-muted\">No audit entries yet.</div>"}
    </div>
  `;

  qsa(".modal-actions button").forEach((btn) => {
    btn.addEventListener("click", (e) => handleIssueAction(e, issue));
  });
}

/** @param {object} issue */
function buildIssueActions(issue) {
  const disabled = APP_STATE.lockMode ? "disabled title=\"Database is locked — modifications disabled\"" : "";
  if (issue.suggested_action === "SELF_HEAL") {
    return `
      <button class="primary" data-action="approve" ${disabled}>Approve Change</button>
      <button class="ghost" data-action="reject" ${disabled}>Reject</button>
    `;
  }
  if (issue.suggested_action === "NEEDS_QUERY") {
    return `<button class="primary" data-action="query" ${disabled}>Draft Site Query</button>`;
  }
  if (issue.suggested_action === "NEEDS_HUMAN_DECISION") {
    return `<button class="primary" data-action="decision" ${disabled}>Open Decision Form</button>`;
  }
  return `<button class="primary" data-action="ack" ${disabled}>Acknowledge</button>`;
}

/** @param {Event} e @param {object} issue */
function handleIssueAction(e, issue) {
  const action = e.target.dataset.action;
  if (APP_STATE.lockMode) return;
  if (action === "approve") {
    APP_STATE.approvedIssues.add(issue.issue_id);
    showToast("Change approved and queued", "success");
    renderApprovals();
    updateBadges();
    closeIssueModal();
  } else if (action === "reject") {
    showToast("Change rejected. Site notified.", "warning");
    closeIssueModal();
  } else if (action === "query") {
    showToast("Drafted site query", "info");
    closeIssueModal();
  } else if (action === "decision") {
    closeIssueModal();
    navigateTo("user-inputs", { issueId: issue.issue_id });
  } else if (action === "ack") {
    showToast("Issue acknowledged", "info");
    closeIssueModal();
  }
}
function renderSubjectTimeline(subjectId) {
  const container = qs("#subject-timeline-content");
  const subjects = Object.values(APP_SUBJECT_TIMELINES)
    .sort((a, b) => b.risk_score - a.risk_score)
    .map((t) => t.subject_id);

  const selected = subjectId || subjects[0];
  APP_STATE.currentSubjectId = selected;
  const timeline = APP_SUBJECT_TIMELINES[selected];
  if (!timeline) return;

  const selector = `
    <select id="subject-selector">
      ${subjects
        .map((s) => {
          const t = APP_SUBJECT_TIMELINES[s];
          return `<option value="${s}" ${s === selected ? "selected" : ""}>${s} (risk: ${t.risk_score})</option>`;
        })
        .join("")}
    </select>
  `;

  const events = timeline.events
    .map((ev, idx) => {
      const dotClass = ev.event_type;
      const warning = ev.linked_issue_ids?.length
        ? `<span class="timeline-warning" data-issues="${ev.linked_issue_ids.join(",")}">⚠ ${ev.linked_issue_ids.length} issues</span>`
        : "";
      return `
        <div class="timeline-event" style="animation-delay:${(idx + 1) * 0.1}s" data-issues="${ev.linked_issue_ids.join(",")}">
          <div class="timeline-dot ${dotClass}"></div>
          <div class="text-muted">${ev.date}</div>
          <strong>${ev.label}</strong>
          <div class="text-muted">${ev.event_type.toUpperCase()}</div>
          <div class="text-muted">${JSON.stringify(ev.details)}</div>
          ${warning}
        </div>
      `;
    })
    .join("");

  const openLoops = timeline.open_loops
    .map((l) => `<div class="text-muted">• ${l}</div>`)
    .join("");

  const contradiction = selected === "SUB-101" ? `<div class="contradiction-line"></div>` : "";

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px;">${selector}</div>
    <div class="timeline-layout">
      <div class="card">
        <div class="timeline">${events}${contradiction}</div>
      </div>
      <div class="right-panel">
        <div class="card">
          <strong>Clinical Narrative</strong>
          <p>${timeline.clinical_narrative}</p>
        </div>
        <div class="card">
          <strong>Open Loops</strong>
          ${openLoops || "<div class='text-muted'>No open loops</div>"}
        </div>
        <div class="card">
          <strong>Risk Score</strong>
          <div class="risk-score">${timeline.risk_score}</div>
        </div>
        <div class="card">
          <details>
            <summary><strong>Timeline Linker Notes</strong></summary>
            <p>Cross-source linkages detected based on overlapping dates, signals, and textual contradictions.</p>
          </details>
        </div>
      </div>
    </div>
  `;

  qs("#subject-selector").addEventListener("change", (e) => {
    renderSubjectTimeline(e.target.value);
  });

  qsa(".timeline-warning").forEach((el) => {
    el.addEventListener("click", () => {
      const issueId = el.dataset.issues.split(",")[0];
      if (issueId) openIssueModal(issueId);
    });
  });
}

function renderApprovals() {
  const container = qs("#approvals-content");
  const pending = APP_PENDING_APPROVALS.filter((i) => !APP_STATE.approvedIssues.has(i.issue_id));

  const header = `
    <div class="card" style="margin-bottom:12px;">
      <strong>${pending.length} proposals pending · ${new Set(pending.map((i) => i.entity_keys.subject_id)).size} subjects · ${pending.filter((i) => i.proposed_change?.affects_lock).length} lock-impacting</strong>
      ${APP_STATE.lockMode ? "<div class='text-muted'>Database locked — approvals disabled. Viewing read-only.</div>" : ""}
    </div>
  `;

  const cards = pending
    .map(
      (issue) => `
      <div class="card" style="margin-bottom:12px;">
        ${severityBadge(issue.severity)}
        <strong>${issue.short_title}</strong>
        <div class="grid-2" style="margin-top:8px;">
          <div style="background:#FEE2E2; padding:8px; border-radius:8px;">Before<br>${JSON.stringify(issue.proposed_change?.before || {})}</div>
          <div style="background:#DCFCE7; padding:8px; border-radius:8px;">After<br>${JSON.stringify(issue.proposed_change?.after || {})}</div>
        </div>
        <div class="text-muted">Subject: ${issue.entity_keys.subject_id || ""}</div>
        <label><input type="checkbox" class="approve-check" data-issue="${issue.issue_id}" /> I have reviewed the evidence and approve this change</label>
        <div class="modal-actions">
          <button class="primary approve-btn" data-issue="${issue.issue_id}">Approve</button>
          <button class="ghost reject-btn" data-issue="${issue.issue_id}">Reject</button>
        </div>
        <div class="text-muted">All actions are audit-logged. No changes without your approval.</div>
      </div>
    `
    )
    .join("");

  container.innerHTML = header + (cards || "<div class='text-muted'>No items match your filters</div>");

  qsa(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (APP_STATE.lockMode) return;
      const check = qs(`.approve-check[data-issue='${btn.dataset.issue}']`);
      if (!check.checked) {
        showToast("Please confirm review before approving", "warning");
        return;
      }
      APP_STATE.approvedIssues.add(btn.dataset.issue);
      showToast("Change approved", "success");
      renderApprovals();
      updateBadges();
    });
  });

  qsa(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (APP_STATE.lockMode) return;
      showToast("Change rejected. Reason captured.", "warning");
      APP_STATE.approvedIssues.add(btn.dataset.issue);
      renderApprovals();
      updateBadges();
    });
  });

  if (APP_STATE.lockMode) {
    qsa(".approve-btn, .reject-btn, .approve-check").forEach((el) => {
      el.disabled = true;
      el.title = "Database is locked — modifications disabled";
    });
  }
}

function renderUserInputs() {
  const container = qs("#user-inputs-content");
  const items = APP_HUMAN_DECISIONS.filter((i) => !APP_STATE.completedDecisions.has(i.issue_id));

  const cards = items
    .map((issue) => {
      const form = buildDecisionForm(issue);
      return `
        <div class="card" style="margin-bottom:12px;">
          ${severityBadge(issue.severity)}
          <strong>${issue.short_title}</strong>
          <div class="text-muted">Subject ${issue.entity_keys.subject_id || ""}</div>
          <div class="card" style="margin-top:8px;">${issue.description}</div>
          ${form}
          <button class="primary decision-submit" data-issue="${issue.issue_id}">Submit Decision</button>
          <div class="text-muted">All actions are audit-logged. No changes without your approval.</div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = cards || "<div class='text-muted'>No items match your filters</div>";

  qsa(".decision-submit").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (APP_STATE.lockMode) return;
      const rationale = qs(`#rationale-${btn.dataset.issue}`);
      if (!rationale.value.trim()) {
        showToast("Rationale is required", "warning");
        return;
      }
      APP_STATE.completedDecisions.add(btn.dataset.issue);
      showToast("Decision recorded", "success");
      renderUserInputs();
      updateBadges();
    });
  });

  if (APP_STATE.lockMode) {
    qsa(".decision-submit").forEach((el) => {
      el.disabled = true;
      el.title = "Database is locked — modifications disabled";
    });
  }
}

/** @param {object} issue */
function buildDecisionForm(issue) {
  const title = issue.short_title.toLowerCase();
  let fields = "";
  if (title.includes("medication") || title.includes("history")) {
    fields = `
      <div>
        <label>Does ${issue.entity_keys.subject_id} have diabetes history?</label>
        <div>
          <label><input type="radio" name="hx-${issue.issue_id}" /> Yes</label>
          <label><input type="radio" name="hx-${issue.issue_id}" /> No</label>
          <label><input type="radio" name="hx-${issue.issue_id}" /> Unknown</label>
        </div>
      </div>
    `;
  } else if (title.includes("hba1c")) {
    fields = `
      <div>
        <label>Is the correct HbA1c value 8.4%?</label>
        <div>
          <label><input type="radio" name="hba1c-${issue.issue_id}" /> Yes</label>
          <label><input type="radio" name="hba1c-${issue.issue_id}" /> No</label>
        </div>
        <input type="text" placeholder="Correct value" />
      </div>
    `;
  } else if (title.includes("onset") || title.includes("chronology")) {
    fields = `
      <div>
        <label>Confirm onset date:</label>
        <input type="date" />
        <label>Confirm end date:</label>
        <input type="date" />
      </div>
    `;
  } else {
    fields = `
      <div>
        <label>Is this AE related to treatment?</label>
        <select>
          <option>Related</option>
          <option>Not Related</option>
          <option>Unknown</option>
        </select>
      </div>
    `;
  }

  return `
    <div class="card" style="margin-top:8px;">
      ${fields}
      <div style="margin-top:8px;">
        <label>Rationale</label>
        <textarea id="rationale-${issue.issue_id}" rows="3" style="width:100%;"></textarea>
      </div>
    </div>
  `;
}

function renderLockReadiness() {
  const container = qs("#lock-readiness-content");
  const baseline = parseReadiness(APP_REPORTS.lock_readiness_pack || "");
  const readiness = Math.max(40, baseline - APP_LOCK_BLOCKERS.length * 2 - Math.floor(APP_ISSUES.length / 30));
  const checklist = [
    { label: "All critical queries resolved", ok: APP_SITE_QUERIES.length === 0 },
    { label: "All external data reconciled", ok: APP_LOCK_BLOCKERS.length === 0 },
    { label: "All protocol deviations reviewed", ok: true },
    { label: "All MedDRA coding complete", ok: true },
    { label: "All endpoint data verified", ok: APP_ISSUES.filter((i) => i.severity === "ENDPOINT_CRITICAL").length === 0 },
    { label: "Audit trail complete", ok: true },
  ];

  const blockers = APP_LOCK_BLOCKERS
    .map(
      (issue) => `
      <div class="card issue-card ${severityClass(issue.severity)}" data-issue="${issue.issue_id}">
        ${severityBadge(issue.severity)}
        <strong>${issue.short_title}</strong>
        <div class="text-muted">${issue.entity_keys.subject_id || ""}</div>
      </div>`
    )
    .join("");

  container.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <strong>Readiness Checklist</strong>
        ${checklist
          .map((c) => `<div>${c.ok ? "✅" : "❌"} ${c.label}</div>`)
          .join("")}
      </div>
      <div class="card" style="text-align:center;">
        <strong>Readiness</strong>
        <svg class="progress-ring" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="50" stroke="#E5E7EB" stroke-width="10" fill="none"></circle>
          <circle cx="60" cy="60" r="50" stroke="#F59E0B" stroke-width="10" fill="none"
            stroke-dasharray="314" stroke-dashoffset="${314 - (314 * readiness) / 100}"></circle>
        </svg>
        <div class="risk-score">${readiness}%</div>
      </div>
    </div>
    <div class="card" style="margin-top:12px;">
      <strong>Lock Blockers</strong>
      <div style="display:grid; gap:8px; margin-top:8px;">${blockers || "<div class='text-muted'>No blockers</div>"}</div>
    </div>
    <div class="card" style="margin-top:12px;">
      <strong>Simulate Database Lock</strong>
      <div class="flex-row" style="justify-content: space-between;">
        <span>Lock Mode toggle</span>
        <label class="switch">
          <input id="lock-toggle" type="checkbox" ${APP_STATE.lockMode ? "checked" : ""} />
          <span class="slider"></span>
        </label>
      </div>
    </div>
  `;

  qsa("#lock-readiness-content .issue-card").forEach((card) => {
    card.addEventListener("click", () => openIssueModal(card.dataset.issue));
  });

  const toggle = qs("#lock-toggle");
  if (toggle) {
    toggle.addEventListener("change", (e) => toggleLockMode(e.target.checked));
  }
}
function renderAuditReports(tab = "audit") {
  const container = qs("#audit-reports-content");
  APP_STATE.auditTab = tab;

  const tabs = `
    <div class="table-tabs">
      <button class="${tab === "audit" ? "active" : ""}" data-tab="audit">Audit Trail</button>
      <button class="${tab === "reports" ? "active" : ""}" data-tab="reports">Reports</button>
    </div>
  `;

  if (tab === "reports") {
    container.innerHTML = `
      ${tabs}
      <div class="grid-2" style="margin-top:12px;">
        <div class="card">
          <strong>Data Review Report</strong>
          <div class="markdown">${renderMarkdown(APP_REPORTS.data_review_report || "")}</div>
          <button class="ghost copy-report" data-report="data">Copy to Clipboard</button>
        </div>
        <div class="card">
          <strong>Lock Readiness Pack</strong>
          <div class="markdown">${renderMarkdown(APP_REPORTS.lock_readiness_pack || "")}</div>
          <button class="ghost copy-report" data-report="lock">Copy to Clipboard</button>
        </div>
      </div>
    `;
  } else {
    const actors = Array.from(new Set(APP_AUDIT_LOG.map((a) => a.actor)));
    const actions = Array.from(new Set(APP_AUDIT_LOG.map((a) => a.action)));
    const subjects = Array.from(new Set(APP_ISSUES.map((i) => i.entity_keys.subject_id).filter(Boolean)));

    container.innerHTML = `
      ${tabs}
      <div class="card" style="margin-top:12px;">
        <div class="table-controls">
          <select id="audit-actor"><option value="ALL">All actors</option>${actors.map((a) => `<option>${a}</option>`).join("")}</select>
          <select id="audit-action"><option value="ALL">All actions</option>${actions.map((a) => `<option>${a}</option>`).join("")}</select>
          <select id="audit-subject"><option value="ALL">All subjects</option>${subjects.map((s) => `<option>${s}</option>`).join("")}</select>
        </div>
        <div id="audit-table"></div>
      </div>
      <div class="card" style="margin-top:12px;">
        <strong>Trace View</strong>
        <select id="trace-issue">
          ${APP_ISSUES.slice(0, 20).map((i) => `<option value="${i.issue_id}">${i.issue_id}</option>`).join("")}
        </select>
        <div id="trace-view" style="margin-top:8px;"></div>
      </div>
    `;

    const renderAuditTable = () => {
      let filtered = APP_AUDIT_LOG;
      const actor = qs("#audit-actor").value;
      const action = qs("#audit-action").value;
      const subject = qs("#audit-subject").value;
      if (actor !== "ALL") filtered = filtered.filter((a) => a.actor === actor);
      if (action !== "ALL") filtered = filtered.filter((a) => a.action === action);
      if (subject !== "ALL") {
        filtered = filtered.filter((a) => (a.references?.subject_ids || []).includes(subject));
      }

      const rows = filtered
        .map(
          (a) => `
          <tr>
            <td>${a.timestamp}</td>
            <td>${a.actor}</td>
            <td>${a.action}</td>
            <td>${(a.references?.issue_ids || [""])[0]}</td>
            <td>${(a.references?.subject_ids || [""])[0]}</td>
            <td>${a.payload?.summary || ""}</td>
          </tr>
        `
        )
        .join("");
      qs("#audit-table").innerHTML = `<table class="data-table"><thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Issue</th><th>Subject</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table>`;
    };

    qsa("#audit-actor, #audit-action, #audit-subject").forEach((el) => {
      el.addEventListener("change", renderAuditTable);
    });

    qs("#trace-issue").addEventListener("change", (e) => renderTraceView(e.target.value));
    renderAuditTable();
    renderTraceView(qs("#trace-issue").value);
  }

  qsa(".table-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => renderAuditReports(btn.dataset.tab));
  });

  qsa(".copy-report").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.dataset.report === "data" ? APP_REPORTS.data_review_report : APP_REPORTS.lock_readiness_pack;
      navigator.clipboard.writeText(text || "");
      showToast("Report copied to clipboard", "info");
    });
  });
}

/** @param {string} issueId */
function renderTraceView(issueId) {
  const entries = APP_AUDIT_LOG.filter((a) => (a.references?.issue_ids || []).includes(issueId));
  const steps = ["DETECT", "PROPOSE", "NOTIFY", "APPROVE", "EXECUTE"];
  const view = steps
    .map((step) => {
      const match = entries.find((e) => e.action === step);
      return `
        <div class="flex-row" style="gap:12px; align-items:center;">
          <div class="chip">${step}</div>
          <div class="text-muted">${match ? `${match.actor} · ${match.timestamp}` : "Pending"}</div>
        </div>
      `;
    })
    .join("");
  qs("#trace-view").innerHTML = view || "<div class='text-muted'>No trace available</div>";
}

function renderLockPill() {
  qs("#lock-mode-pill").classList.toggle("hidden", !APP_STATE.lockMode);
  qs("#lock-banner").classList.toggle("hidden", !APP_STATE.lockMode);
  qs("#sidebar-lock-indicator .dot").style.background = APP_STATE.lockMode ? "#F59E0B" : "#059669";
}

/** @param {boolean} on */
function toggleLockMode(on) {
  APP_STATE.lockMode = on;
  renderLockPill();
  renderLiveOps();
  renderAgentNetwork();
  renderIssueInbox();
  renderApprovals();
  renderUserInputs();
  renderLockReadiness();
}

function updateBadges() {
  qs("#badge-issues").textContent = APP_ISSUES.length;
  qs("#badge-approvals").textContent = APP_PENDING_APPROVALS.filter((i) => !APP_STATE.approvedIssues.has(i.issue_id)).length;
  qs("#badge-inputs").textContent = APP_HUMAN_DECISIONS.filter((i) => !APP_STATE.completedDecisions.has(i.issue_id)).length;
}

/** @param {string} md */
function renderMarkdown(md) {
  if (!md) return "";
  let html = md
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
    .replace(/^- (.*$)/gim, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/gim, "<ul>$1</ul>");
  return html.replace(/\n/g, "<br>");
}

/** @param {string} report */
function parseReadiness(report) {
  const match = report.match(/Readiness score: (\d+)%/);
  return match ? Number(match[1]) : 68;
}

// ========== CHAT ==========
function initChat() {
  const panel = qs("#chat-panel");
  const toggle = qs("#chat-toggle");
  const close = qs("#chat-close");
  const openBtn = qs("#open-chat");

  const openChat = () => {
    panel.classList.remove("hidden");
    const input = qs("#chat-input");
    if (input) input.focus();
  };

  const closeChat = () => {
    panel.classList.add("hidden");
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      const input = qs("#chat-input");
      if (input) input.focus();
    }
  });
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    closeChat();
  });
  if (openBtn) {
    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openChat();
    });
  }

  qs("#chat-send").addEventListener("click", handleChatSend);
  qs("#chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleChatSend();
  });

  qsa(".chat-suggestions .chip").forEach((chip) => {
    chip.addEventListener("click", () => sendChat(chip.dataset.chat));
  });

  document.addEventListener("click", (e) => {
    if (panel.classList.contains("hidden")) return;
    if (e.target.closest("#chat-panel")) return;
    if (e.target.closest("#chat-toggle")) return;
    if (e.target.closest("#open-chat")) return;
    closeChat();
  });
}

function handleChatSend() {
  const input = qs("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  sendChat(text);
  input.value = "";
}

/** @param {string} text */
function sendChat(text) {
  addChatMessage(text, "user");
  const lower = text.toLowerCase();
  const key = Object.keys(APP_CHAT_RESPONSES).find((k) => lower.includes(k)) || "default";
  const response = APP_CHAT_RESPONSES[key] || APP_CHAT_RESPONSES.default;
  setTimeout(() => addChatMessage(linkifyChat(response), "system", true), 500);
}

/** @param {string} msg @param {string} type @param {boolean} html */
function addChatMessage(msg, type, html = false) {
  const container = qs("#chat-messages");
  const div = document.createElement("div");
  div.className = `message ${type}`;
  if (html) div.innerHTML = msg; else div.textContent = msg;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/** @param {string} text */
function linkifyChat(text) {
  const lines = text.split("\n");
  return lines
    .map((line) => {
      if (line.startsWith("→")) {
        const target = line.replace("→", "").trim();
        return `<a href="#" class="chat-link" data-target="${target}">${line}</a>`;
      }
      return line;
    })
    .join("<br>")
    .replace(/\n/g, "<br>");
}

// ========== INIT ==========
document.addEventListener("DOMContentLoaded", () => {
  renderLiveOps();
  renderIssueInbox();
  initChat();
  renderLockPill();
  updateBadges();
  startGlobalAutomation();

  qsa(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.screen));
  });

  qs("#issue-detail-modal").addEventListener("click", (e) => {
    if (e.target.dataset.close) closeIssueModal();
  });

  document.body.addEventListener("click", (e) => {
    if (e.target.classList.contains("chat-link")) {
      e.preventDefault();
      const target = e.target.dataset.target.toLowerCase();
      if (target.includes("lock")) navigateTo("lock-readiness");
      if (target.includes("subject")) navigateTo("subject-timeline", { subjectId: "SUB-101" });
      if (target.includes("approvals")) navigateTo("approvals");
      if (target.includes("issue inbox")) navigateTo("issue-inbox");
    }
  });
});

