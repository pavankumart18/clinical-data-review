
/**
 * Aegis CDM UI (vanilla JS)
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
  lastAutomationAt: null,
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

/** @param {string} text */
function infoTip(text) {
  return `<span class="info-tip"><button class="info-btn" type="button" aria-label="Information">i</button><span class="info-pop">${text}</span></span>`;
}

const SCREEN_GUIDES = {
  "live-ops": {
    title: "Live Operations Guide",
    purpose: "Use this screen for a real-time overview of data quality pressure and review workload.",
    watch: "Watch steward counts, top-priority issues, and readiness metrics to understand current risk.",
    story: "Story it tells: what entered today, what was flagged, and where human attention is needed first.",
    score: "Readiness is a percentage out of 100. Lower values mean more open blockers and unresolved critical items.",
    act: "Click a subject or issue to drill into timeline and evidence before taking action.",
  },
  "screen-agent-network": {
    title: "Agent Network Guide",
    purpose: "This screen explains how incoming data is processed layer by layer.",
    watch: "Watch ingestion, steward detections, cross-linking, and queue routing into human decisions.",
    story: "Story it tells: many signals enter at the top; only policy-sensitive items flow down to human review, with explicit routing basis shown.",
    score: "All steward and queue counts are synchronized from the same master issue list to avoid drift.",
    act: "Use it to explain governance: agents detect and propose, humans approve and decide.",
  },
  "data-explorer": {
    title: "Data Explorer Guide",
    purpose: "Use this screen to validate source records behind every detection.",
    watch: "Use tabs, search, and sorting to trace suspicious values and chronology errors.",
    story: "Story it tells: every issue can be traced back to an observable source row and field value.",
    score: "No derived score here. This is source-of-truth evidence view.",
    act: "Open flagged rows to review evidence and proposed actions.",
  },
  "issue-inbox": {
    title: "Issue Inbox Guide",
    purpose: "Use this as the central triage queue for all open findings.",
    watch: "Use routing shortcut buttons and filters by severity, custodian, and action to focus reviewer effort.",
    story: "Story it tells: each item is routed by policy basis into self-heal, query, human decision, or lock blocker paths.",
    score: "Confidence is a 0-100% estimate of detection certainty, not clinical severity.",
    act: "Open issue cards to review evidence and route to approvals, queries, or decisions.",
  },
  "subject-timeline": {
    title: "Subject Timeline Guide",
    purpose: "Use this to understand each subject as a clinical story, not isolated rows.",
    watch: "Follow event order, cross-source links, and unresolved loops.",
    story: "Story it tells: temporal sequence plus contradictions across systems for one subject.",
    score: "Risk Score is points (not percent): LOCKx10 + SAFETYx7 + ENDPOINTx5 + OPERATIONALx1.",
    act: "Prioritize high-risk subjects and confirm whether signals are clinically meaningful.",
  },
  "approvals": {
    title: "Approvals Guide",
    purpose: "Use this queue to approve or reject safe system-proposed corrections.",
    watch: "Compare before/after diffs and evidence before approving.",
    story: "Story it tells: safe, explainable fixes pending explicit human authorization.",
    score: "Queue count shows pending approvals after excluding already approved/rejected items in this session.",
    act: "Approve only when evidence is sufficient; rejected items remain for follow-up.",
  },
  "user-inputs": {
    title: "Human Decisions Guide",
    purpose: "Use this queue for ambiguous or policy-restricted decisions that require judgment.",
    watch: "Review context and complete structured forms with rationale.",
    story: "Story it tells: issues where rules alone are insufficient and clinical judgment is required.",
    score: "Queue count shows pending decision requests after excluding completed decisions in this session.",
    act: "Submit clear decisions to unblock downstream governance and lock readiness.",
  },
  "lock-readiness": {
    title: "Lock Readiness Guide",
    purpose: "Use this view to decide whether the database is ready for lock/freeze.",
    watch: "Track blockers, checklist status, and readiness score trend.",
    story: "Story it tells: what still prevents lock and which actions reduce residual risk.",
    score: "Readiness is percent out of 100 based on open blockers, unresolved critical findings, and pending queues.",
    act: "Resolve blockers and critical queries before enabling lock mode.",
  },
  "audit-reports": {
    title: "Audit and Reports Guide",
    purpose: "Use this screen for compliance evidence and review documentation.",
    watch: "Inspect actor/action traces and final reporting outputs.",
    story: "Story it tells: complete accountability path from detection through human action.",
    score: "No single score. Trace completeness and chronological integrity are the key checks.",
    act: "Use trace view for issue lineage and reports for sign-off discussions.",
  },
};

const SCREEN_LABELS = {
  "live-ops": "Live Operations",
  "screen-agent-network": "Agent Network",
  "data-explorer": "Data Explorer",
  "issue-inbox": "Issue Inbox",
  "subject-timeline": "Subject Timeline",
  approvals: "Approvals Center",
  "user-inputs": "User Inputs",
  "lock-readiness": "Lock & Readiness",
  "audit-reports": "Audit & Reports",
};

const SCREEN_MANUAL = {
  "live-ops": {
    objective: "High-level operational pulse. This is your first stop to understand current risk pressure and where to focus reviewer attention.",
    inputs: ["All detected issues", "Activity stream updates every 2 seconds", "Current queue counts and lock status"],
    explains: ["Which stewards are active", "Which subjects are currently highest priority", "How readiness is moving over time"],
    how_to_tell_story: ["Start with total issues and lock blockers.", "Move to attention panel and click one high-priority subject.", "Use feed messages to show how detections arrived over time."],
    score_logic: "Readiness here is a percentage out of 100. It decreases when lock blockers, unresolved critical issues, and pending decisions/queries increase.",
  },
  "screen-agent-network": {
    objective: "Shows the full processing chain from data ingestion through steward checks to governance routing and human escalation.",
    inputs: ["Current sample row counts per source", "Issue list grouped by steward", "Queue state after governance classification"],
    explains: ["What each steward searches for", "Why issues are routed to self-heal/query/human/blocker", "How many items are still waiting for human action"],
    how_to_tell_story: ["Point to each steward's 'Searches' and 'Does' lines.", "Use routing basis cards to explain policy decisions.", "Click route buttons to jump into exact queues and prove consistency."],
    score_logic: "No single score. This screen is about workflow integrity and consistent counts. Numbers are synchronized to the same underlying issue/queue state.",
  },
  "data-explorer": {
    objective: "Evidence validation screen. Confirms every detection can be traced to source rows.",
    inputs: ["Raw/normalized source tables", "Issue-to-row linkage by source file and row id"],
    explains: ["Where suspicious values came from", "Whether chronology and unit context are valid", "Which rows are currently linked to open issues"],
    how_to_tell_story: ["Switch tabs by source.", "Search for a subject and open a flagged row.", "Show that issue decisions are traceable to concrete fields."],
    score_logic: "No score. This screen is for data traceability and audit confidence.",
  },
  "issue-inbox": {
    objective: "Primary triage queue for all findings with operational filters and routing shortcuts.",
    inputs: ["Master issue list", "Severity/action metadata", "Queue mapping context"],
    explains: ["Which items are self-healable vs needing query vs needing human decision", "How lock impact changes triage priority", "Detection confidence vs severity impact"],
    how_to_tell_story: ["Use routing shortcut cards first.", "Filter to lock-critical and show immediate blockers.", "Open one issue to show evidence and action options."],
    score_logic: "Confidence bar is 0-100% detection certainty only. Severity and lock-impact drive business risk and escalation, not confidence alone.",
  },
  "subject-timeline": {
    objective: "Subject-centric clinical story view joining events and inconsistencies across domains.",
    inputs: ["Timeline events from all sources", "Linked issue ids", "Open loops and severity counts"],
    explains: ["Event sequence and contradictions", "Why this subject has current priority", "What remains unresolved for this subject"],
    how_to_tell_story: ["Pick highest-risk subject.", "Walk chronologically through events.", "Use linked issue badges to open evidence from timeline."],
    score_logic: "Risk Score is points (not percent): Lock×10 + Safety×7 + Endpoint×5 + Operational×1 using current issues for that subject.",
  },
  approvals: {
    objective: "Controlled approval gate for reversible, low-risk corrections proposed by the system.",
    inputs: ["Items marked SELF_HEAL", "Proposed before/after diffs", "Evidence references"],
    explains: ["Why a correction is considered safe", "What changes before execution", "How approval updates governance queues"],
    how_to_tell_story: ["Show one unit/standardization correction.", "Tick evidence review checkbox and approve.", "Show badge and queue count drop immediately."],
    score_logic: "Queue count is pending items only (excluding those approved/rejected this session).",
  },
  "user-inputs": {
    objective: "Human judgment queue for ambiguous, contradictory, or policy-restricted items.",
    inputs: ["Items marked NEEDS_HUMAN_DECISION", "Structured decision forms", "Required rationale capture"],
    explains: ["Why rules are insufficient in these cases", "What specific clinical/data judgment is required", "How decisions unblock downstream processes"],
    how_to_tell_story: ["Open one conflict case.", "Fill structured answer + rationale.", "Submit and show queue decrement."],
    score_logic: "Queue count is pending human decisions only; completed submissions are removed from active queue.",
  },
  "lock-readiness": {
    objective: "Governance checkpoint for lock/freeze decision readiness.",
    inputs: ["Blocker list", "Critical severity totals", "Pending decision/query queues"],
    explains: ["What specifically blocks lock", "Why readiness changed", "What must be resolved before freeze"],
    how_to_tell_story: ["Start with readiness percent and checklist.", "Click blockers for detail.", "Toggle lock mode to show read-only governance behavior."],
    score_logic: "Readiness is a percentage out of 100 using configured penalties for blockers, critical severities, and unresolved queues.",
  },
  "audit-reports": {
    objective: "Compliance and accountability view of all key actions and report outputs.",
    inputs: ["Audit log entries", "Issue trace references", "Generated reports"],
    explains: ["Who did what and when", "How one issue moved across lifecycle steps", "What is documented for sign-off"],
    how_to_tell_story: ["Filter audit rows by actor/action.", "Use trace view for one issue lifecycle.", "Open reports for review-pack context."],
    score_logic: "No single score. Evaluate completeness and chronology of trace and report artifacts.",
  },
};

const SCORE_MODEL = {
  risk_weights: {
    LOCK_CRITICAL: 10,
    SAFETY_CRITICAL: 7,
    ENDPOINT_CRITICAL: 5,
    OPERATIONAL: 1,
  },
  readiness: {
    base: 100,
    lock_blocker_penalty: 8,
    safety_critical_penalty: 3,
    endpoint_critical_penalty: 2,
    pending_query_penalty: 1,
    pending_human_penalty: 1,
    min: 35,
  },
};

const AGENT_ROLE_GUIDE = {
  edc: {
    searches: "Visit chronology, missing randomization, endpoint outliers, duplicate visits, demographic contradictions.",
    does: "Creates site queries for date/field gaps and proposes safe data fixes (like decimal or duplicate merges) for approval.",
    escalates: "Escalates when issues affect lock, endpoint interpretation, or remain ambiguous after rule checks.",
  },
  lab: {
    searches: "Unit mismatches, lab collection/receipt chronology, specimen collisions, and trend-based safety signals.",
    does: "Proposes reversible unit conversions and flags rising enzyme trends for medical review.",
    escalates: "Escalates lock-impacting specimen conflicts and safety trends needing clinical judgment.",
  },
  safety: {
    searches: "AE/SAE chronology errors, missing seriousness details, and duplicate event coding conflicts.",
    does: "Routes missing/invalid safety fields to site query and links events for reviewer context.",
    escalates: "Escalates serious, incomplete, or lock-critical events because policy requires human sign-off.",
  },
  meds: {
    searches: "Medication date conflicts, naming standardization opportunities, and history contradictions.",
    does: "Proposes medication name standardization and flags contradiction cases for decision.",
    escalates: "Escalates when medication history conflicts with investigator statements or safety context.",
  },
  device: {
    searches: "Impossible vitals, timezone drift, and compliance gaps from device/ePRO submissions.",
    does: "Flags implausible measurements and sends compliance gaps to query workflow.",
    escalates: "Escalates safety spikes and unresolved chronology/compliance anomalies for human review.",
  },
};

const ACTION_BASIS = {
  SELF_HEAL: "Self-heal: reversible, low-risk data normalization (units, naming, dedup) with full before/after trace. Still requires your approval.",
  NEEDS_QUERY: "Site Query: source record is incomplete/inconsistent, and only site/investigator can confirm the truth.",
  NEEDS_HUMAN_DECISION: "Human Decision: ambiguity or cross-source contradiction where clinical/program judgment is required.",
  LOCK_CRITICAL: "Lock Blocker: issue can compromise lock readiness or data integrity and must be resolved before freeze.",
};

function countUnique(arr, key) {
  const set = new Set(arr.map((x) => x?.[key]).filter(Boolean));
  return set.size;
}

function computeConsistencyReport() {
  const issues = APP_ISSUES || [];
  const byId = new Map(issues.map((i) => [i.issue_id, i]));
  const lockBlockers = APP_LOCK_BLOCKERS || [];
  const approvals = APP_PENDING_APPROVALS || [];
  const decisions = APP_HUMAN_DECISIONS || [];
  const siteQueries = APP_SITE_QUERIES || [];
  const timelines = APP_SUBJECT_TIMELINES || {};

  const duplicates = issues.length - countUnique(issues, "issue_id");
  const missingFromIssues = (arr) => arr.filter((x) => !byId.has(x.issue_id)).length;
  const wrongSeverity = lockBlockers.filter((x) => x.severity !== "LOCK_CRITICAL").length;
  const wrongApprovalAction = approvals.filter((x) => x.suggested_action !== "SELF_HEAL").length;
  const wrongDecisionAction = decisions.filter((x) => x.suggested_action !== "NEEDS_HUMAN_DECISION").length;
  const wrongQueryAction = siteQueries.filter((x) => x.suggested_action !== "NEEDS_QUERY").length;
  const missingTimeline = issues.filter((x) => x.entity_keys?.subject_id && !timelines[x.entity_keys.subject_id]).length;
  const agentTreeMismatches = [];
  if (typeof APP_AGENT_TREE !== "undefined" && APP_AGENT_TREE?.stewards) {
    const map = {
      edc: "edc_form_custodian",
      lab: "lab_signal_custodian",
      safety: "safety_event_custodian",
      meds: "meds_history_custodian",
      device: "device_epro_custodian",
    };
    APP_AGENT_TREE.stewards.forEach((s) => {
      const expected = issues.filter((i) => i.custodian === map[s.id]).length;
      if ((s.issues_found || 0) !== expected) {
        agentTreeMismatches.push(`${s.name} count mismatch (${s.issues_found} shown vs ${expected} expected).`);
      }
    });
  }

  const errors = [];
  const warnings = [];
  if (duplicates > 0) errors.push(`${duplicates} duplicate issue IDs found.`);
  if (missingFromIssues(lockBlockers) > 0) errors.push(`${missingFromIssues(lockBlockers)} lock blocker items are not in the master issue list.`);
  if (missingFromIssues(approvals) > 0) errors.push(`${missingFromIssues(approvals)} approval items are not in the master issue list.`);
  if (missingFromIssues(decisions) > 0) errors.push(`${missingFromIssues(decisions)} human decision items are not in the master issue list.`);
  if (missingFromIssues(siteQueries) > 0) errors.push(`${missingFromIssues(siteQueries)} site query items are not in the master issue list.`);
  if (wrongSeverity > 0) errors.push(`${wrongSeverity} lock blocker items are not lock-critical.`);
  if (wrongApprovalAction > 0) warnings.push(`${wrongApprovalAction} approvals are not marked SELF_HEAL.`);
  if (wrongDecisionAction > 0) warnings.push(`${wrongDecisionAction} human decisions are not marked NEEDS_HUMAN_DECISION.`);
  if (wrongQueryAction > 0) warnings.push(`${wrongQueryAction} site queries are not marked NEEDS_QUERY.`);
  if (missingTimeline > 0) warnings.push(`${missingTimeline} issues have no subject timeline mapping yet.`);
  if (agentTreeMismatches.length > 0) warnings.push(...agentTreeMismatches);

  const ok = errors.length === 0;
  const status = ok ? "Consistent" : "Needs attention";
  const details = [...errors, ...warnings];
  return { ok, status, details };
}

function renderConsistencyBadge() {
  const report = computeConsistencyReport();
  const cls = report.ok ? "consistency-ok" : "consistency-warn";
  const details = report.details.length ? report.details.join(" ") : "No structural mismatches detected across issues and queues.";
  return `
    <span class="consistency-pill ${cls}">
      <strong>Data Consistency:</strong> ${report.status}
      ${infoTip(details)}
    </span>
  `;
}

function renderScreenGuide(screenKey) {
  const guide = SCREEN_GUIDES[screenKey];
  if (!guide) return "";
  return `
    <div class="card screen-guide">
      <div class="screen-guide-head">
        <strong>${guide.title}</strong>
        ${renderConsistencyBadge()}
      </div>
      <div class="screen-guide-grid">
        <div><strong>Purpose:</strong> ${guide.purpose}</div>
        <div><strong>What to Watch:</strong> ${guide.watch}</div>
        <div><strong>Storyline:</strong> ${guide.story}</div>
        <div><strong>Score Basis:</strong> ${guide.score}</div>
        <div><strong>What to Do:</strong> ${guide.act}</div>
      </div>
    </div>
  `;
}

function renderScreenManual(screenId) {
  const key = screenId || APP_STATE.currentScreen || "live-ops";
  const details = SCREEN_MANUAL[key] || SCREEN_MANUAL["live-ops"];
  const content = qs("#screen-guide-content");
  if (!content) return;

  const tabs = SCREENS.map((id) => `
    <button class="manual-tab ${id === key ? "active" : ""}" data-manual-screen="${id}">
      ${SCREEN_LABELS[id] || id}
    </button>
  `).join("");

  const list = (items) => `<ul class="manual-list">${(items || []).map((x) => `<li>${x}</li>`).join("")}</ul>`;
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const joinSentence = (items) => {
    const parts = (items || []).map((x) => clean(x)).filter(Boolean);
    if (!parts.length) return "";
    if (parts.length === 1) return `${parts[0]}.`;
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}.`;
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`;
  };
  const inputSentence = `This screen pulls from ${joinSentence(details.inputs)}`;
  const explainSentence = `This screen helps users understand ${joinSentence(details.explains)}`;
  const storySentence = `A clear explanation flow is ${joinSentence(details.how_to_tell_story)}`;

  content.innerHTML = `
    <div class="manual-top">
      <h2 style="margin:0;">Screen Guide: ${SCREEN_LABELS[key] || key}</h2>
      <div class="manual-subtitle">Detailed screen explanation for users and reviewers.</div>
      <div class="manual-screen-tabs">${tabs}</div>
    </div>
    <div class="manual-grid">
      <div class="manual-section">
        <h3>Objective</h3>
        <div class="manual-subtitle">${details.objective}</div>
      </div>
      <div class="manual-section">
        <h3>Data Inputs</h3>
        ${list(details.inputs)}
        <div class="manual-subtitle manual-sentence">${inputSentence}</div>
      </div>
      <div class="manual-section">
        <h3>What It Explains</h3>
        ${list(details.explains)}
        <div class="manual-subtitle manual-sentence">${explainSentence}</div>
      </div>
      <div class="manual-section">
        <h3>How To Present It</h3>
        ${list(details.how_to_tell_story)}
        <div class="manual-subtitle manual-sentence">${storySentence}</div>
      </div>
      <div class="manual-section" style="grid-column: 1 / -1;">
        <h3>Score/Metric Basis</h3>
        <div class="manual-subtitle">${details.score_logic}</div>
      </div>
    </div>
  `;

  qsa(".manual-tab").forEach((btn) => {
    btn.addEventListener("click", () => renderScreenManual(btn.dataset.manualScreen));
  });
}

function openScreenManual(screenId) {
  renderScreenManual(screenId || APP_STATE.currentScreen);
  qs("#screen-guide-modal")?.classList.remove("hidden");
}

function closeScreenManual() {
  qs("#screen-guide-modal")?.classList.add("hidden");
}

function pendingCounts() {
  return {
    approvals: APP_PENDING_APPROVALS.filter((i) => !APP_STATE.approvedIssues.has(i.issue_id)).length,
    decisions: APP_HUMAN_DECISIONS.filter((i) => !APP_STATE.completedDecisions.has(i.issue_id)).length,
    queries: APP_SITE_QUERIES.length,
    blockers: APP_LOCK_BLOCKERS.length,
  };
}

function issueSeverityCounts() {
  return APP_ISSUES.reduce((acc, i) => {
    acc[i.severity] = (acc[i.severity] || 0) + 1;
    return acc;
  }, { LOCK_CRITICAL: 0, SAFETY_CRITICAL: 0, ENDPOINT_CRITICAL: 0, OPERATIONAL: 0 });
}

function computeReadinessPercent() {
  const sev = issueSeverityCounts();
  const pending = pendingCounts();
  const cfg = SCORE_MODEL.readiness;
  const score = cfg.base
    - pending.blockers * cfg.lock_blocker_penalty
    - sev.SAFETY_CRITICAL * cfg.safety_critical_penalty
    - sev.ENDPOINT_CRITICAL * cfg.endpoint_critical_penalty
    - pending.queries * cfg.pending_query_penalty
    - pending.decisions * cfg.pending_human_penalty;
  return Math.max(cfg.min, Math.min(100, score));
}

function computeRiskBreakdown(subjectId) {
  const related = APP_ISSUES.filter((i) => i.entity_keys?.subject_id === subjectId);
  const counts = related.reduce((acc, i) => {
    acc[i.severity] = (acc[i.severity] || 0) + 1;
    return acc;
  }, { LOCK_CRITICAL: 0, SAFETY_CRITICAL: 0, ENDPOINT_CRITICAL: 0, OPERATIONAL: 0 });
  const weights = SCORE_MODEL.risk_weights;
  const points = counts.LOCK_CRITICAL * weights.LOCK_CRITICAL
    + counts.SAFETY_CRITICAL * weights.SAFETY_CRITICAL
    + counts.ENDPOINT_CRITICAL * weights.ENDPOINT_CRITICAL
    + counts.OPERATIONAL * weights.OPERATIONAL;
  return { counts, points };
}

function syncAgentTreeWithState() {
  if (typeof APP_AGENT_TREE === "undefined" || !APP_AGENT_TREE?.stewards) return;
  const custodianMap = {
    edc: "edc_form_custodian",
    lab: "lab_signal_custodian",
    safety: "safety_event_custodian",
    meds: "meds_history_custodian",
    device: "device_epro_custodian",
  };
  const recordsMap = {
    edc: APP_SAMPLE_EDC.length,
    lab: APP_SAMPLE_LABS.length,
    safety: APP_SAMPLE_SAFETY.length,
    meds: APP_SAMPLE_MEDS.length,
    device: APP_SAMPLE_DEVICE.length,
  };

  const latestByCustodian = {};
  APP_ISSUES.forEach((issue) => {
    const current = latestByCustodian[issue.custodian];
    if (!current || (issue.detected_at || "") > (current.detected_at || "")) {
      latestByCustodian[issue.custodian] = issue;
    }
  });

  APP_AGENT_TREE.stewards.forEach((s) => {
    const custodian = custodianMap[s.id];
    const issues = APP_ISSUES.filter((i) => i.custodian === custodian);
    s.issues_found = issues.length;
    s.records_checked = recordsMap[s.id] || s.records_checked || 0;
    s.by_severity = issues.reduce((acc, i) => {
      acc[i.severity] = (acc[i.severity] || 0) + 1;
      return acc;
    }, { LOCK_CRITICAL: 0, SAFETY_CRITICAL: 0, ENDPOINT_CRITICAL: 0, OPERATIONAL: 0 });
    s.self_healable = issues.filter((i) => i.suggested_action === "SELF_HEAL").length;
    s.escalated = Math.max(0, s.issues_found - s.self_healable);
    s.recent_finding = latestByCustodian[custodian]?.short_title || s.recent_finding || "No new findings";
  });

  const pending = pendingCounts();
  const issuesBySubject = {};
  APP_ISSUES.forEach((issue) => {
    const subjectId = issue.entity_keys?.subject_id;
    if (!subjectId) return;
    if (!issuesBySubject[subjectId]) issuesBySubject[subjectId] = [];
    issuesBySubject[subjectId].push(issue);
  });
  const subjectIds = Object.keys(issuesBySubject);
  const crossLinkedSubjects = subjectIds.filter((sid) => new Set(issuesBySubject[sid].map((i) => i.custodian)).size > 1);

  if (APP_AGENT_TREE?.ingestion?.feeds) {
    const feedMap = {
      "EDC Visits": APP_SAMPLE_EDC,
      "Labs": APP_SAMPLE_LABS,
      "Safety AE": APP_SAMPLE_SAFETY,
      "Medications": APP_SAMPLE_MEDS,
      "Device/ePRO": APP_SAMPLE_DEVICE,
    };
    APP_AGENT_TREE.ingestion.feeds.forEach((feed) => {
      const arr = feedMap[feed.name];
      if (Array.isArray(arr)) {
        feed.records = arr.length;
        feed.status = "ingested";
      }
      if (APP_STATE.lastAutomationAt) feed.last_sync = APP_STATE.lastAutomationAt;
    });
  }

  if (APP_AGENT_TREE?.linker) {
    APP_AGENT_TREE.linker.case_packets_created = subjectIds.length;
    APP_AGENT_TREE.linker.cross_links = crossLinkedSubjects.length;
    APP_AGENT_TREE.linker.total_issues_received = APP_ISSUES.length;
    APP_AGENT_TREE.linker.issues_enriched = APP_ISSUES.filter((i) => {
      const sid = i.entity_keys?.subject_id;
      return sid && crossLinkedSubjects.includes(sid);
    }).length;
    APP_AGENT_TREE.linker.escalated_to_conductor = APP_ISSUES.length;
    const latestIssue = [...APP_ISSUES].sort((a, b) => (a.detected_at || "").localeCompare(b.detected_at || "")).at(-1);
    if (latestIssue?.entity_keys?.subject_id) {
      APP_AGENT_TREE.linker.recent = `Linked ${latestIssue.short_title.toLowerCase()} for ${latestIssue.entity_keys.subject_id}`;
    }
  }

  if (APP_AGENT_TREE?.conductor?.buckets) {
    APP_AGENT_TREE.conductor.buckets.self_heal.count = pending.approvals;
    APP_AGENT_TREE.conductor.buckets.site_queries.count = pending.queries;
    APP_AGENT_TREE.conductor.buckets.human_decisions.count = pending.decisions;
    APP_AGENT_TREE.conductor.buckets.lock_blockers.count = pending.blockers;
    APP_AGENT_TREE.conductor.total_classified = APP_ISSUES.length;
  }
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

  const readiness = computeReadinessPercent();
  const introCard = `
    <div class="card" style="margin-bottom:12px;">
      <div class="flex-row" style="justify-content: space-between; align-items: flex-start;">
        <div>
          <strong>What This System Does</strong>
          <div class="text-muted" style="margin-top:6px;">
            1. Ingests EDC, Labs, Safety, Medications, and Device streams.<br>
            2. Runs steward checks to detect chronology, safety, endpoint, and operational issues.<br>
            3. Suggests self-heal changes where policy allows; routes unresolved items to Site Query, Human Decision, or Lock Blocker queues.<br>
            4. Builds subject timelines so reviewers can approve, reject, or request clarification with full evidence.
          </div>
        </div>
        <span class="chip info">Audit logged</span>
      </div>
    </div>
  `;

  container.innerHTML = `
    ${renderScreenGuide("live-ops")}
    ${introCard}
    <div class="steward-row">${stewardCards}</div>
    <div class="grid-2">
      <div class="card">
        <div class="flex-row" style="justify-content: space-between; margin-bottom: 8px;">
          <strong>Activity Feed ${infoTip("Streaming log of steward detections and routing events as they happen.")}</strong>
          <span class="text-muted">Live playback</span>
        </div>
        <div class="feed" id="activity-feed"></div>
      </div>
      <div class="card">
        <div class="flex-row" style="justify-content: space-between; margin-bottom: 8px;">
          <strong>Attention Now ${infoTip("Highest-priority issues ranked by severity and urgency.")}</strong>
          <span class="text-muted">Top 5 by severity</span>
        </div>
        <div id="attention-now-list" style="display: grid; gap: 8px;">${topIssues}</div>
      </div>
    </div>
    <div class="metrics-bar">
      <div class="metric">
        <div class="text-muted">Total Issues ${infoTip("All open issues currently tracked across data sources.")}</div>
        <strong id="metric-total-issues">${totalIssues}</strong>
      </div>
      <div class="metric">
        <div class="text-muted">Lock Blockers ${infoTip("Critical items that must be resolved before database lock.")}</div>
        <strong id="metric-lock-blockers">${APP_LOCK_BLOCKERS.length}</strong>
      </div>
      <div class="metric">
        <div class="text-muted">Readiness ${infoTip("Estimated lock readiness based on blocker volume and open risk.")}</div>
        <strong id="metric-readiness">${readiness}%</strong>
        <div class="text-muted">Scale: percentage out of 100</div>
      </div>
      <div class="metric">
        <div class="text-muted">Active Subjects ${infoTip("Subjects with linked events and/or open issues in monitoring scope.")}</div>
        <strong id="metric-active-subjects">${Object.keys(APP_SUBJECT_TIMELINES).length}</strong>
      </div>
      <div class="metric">
        <div class="text-muted">Severity Mix ${infoTip("Distribution of issues by criticality level.")}</div>
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
  syncAgentTreeWithState();
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
      const role = AGENT_ROLE_GUIDE[s.id] || {};
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
          <div class="agent-role-line"><strong>Searches:</strong> ${role.searches || "Rule-based checks for source consistency."}</div>
          <div class="agent-role-line"><strong>Does:</strong> ${role.does || "Flags issues and routes them for review."}</div>
          <div class="text-muted">${severity}</div>
          <div class="text-muted">Self-healable: <span class="data-number" data-base="${s.self_healable}" data-target="${s.self_healable}">0</span></div>
          <button class="link-button steward-nav" data-nav="issue-inbox" data-custodian="${custodian}">Escalated: <span class="data-number" data-base="${s.escalated}" data-target="${s.escalated}">0</span></button>
          <div class="agent-steward-details">
            <div class="text-muted">Recent: ${s.recent_finding}</div>
            <div class="text-muted"><strong>Escalation basis:</strong> ${role.escalates || "Escalated when policy requires reviewer decision."}</div>
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
    ${renderScreenGuide("screen-agent-network")}
    <div class="agent-network ${locked ? "locked" : ""}">
      <div>
        <div class="agent-section-title">Today's Data Ingestion Status ${infoTip("Current intake status from each external data feed.")}</div>
        <div class="automation-strip">
          <div class="automation-label">Automation cycle (updates every 5s)</div>
          <div class="automation-bar"><span></span></div>
        </div>
        <div class="ingestion-grid">${ingestionCards}</div>
        <div class="flow-row">${ingestionLines}</div>
      </div>

      <div>
        <div class="agent-section-title">Layer 1: Data Stewards ${infoTip("Rule custodians that validate data quality and detect anomalies.")}</div>
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
        <div class="flex-row"><span>${linker.icon}</span><strong>${linker.name}</strong>${infoTip("Cross-source correlator that builds subject-level narratives from multiple systems.")}</div>
        <div class="text-muted">Correlating findings across stewards · Building subject timelines</div>
        <div class="text-muted"><span class="data-number" data-base="${linker.case_packets_created}" data-target="${linker.case_packets_created}">0</span> case packets · <span class="data-number" data-base="${linker.cross_links}" data-target="${linker.cross_links}">0</span> cross-links</div>
        <div class="text-muted">Recent: ${linker.recent}</div>
      </div>

      <div class="flow-row single"><div class="flow-line"></div></div>
      <div class="flow-label">Classified: ${conductor.total_classified} issues routed to governance</div>

      <div class="routing-basis card">
        <div class="routing-basis-head">
          <strong>Routing Basis (Why items go to each queue)</strong>
          ${infoTip("Decision policy that determines whether an item can be approved, queried, or needs human judgment.")}
        </div>
        <div class="routing-grid">
          <div class="routing-item">
            <div class="chip self">Self-Heal</div>
            <div class="text-muted">${ACTION_BASIS.SELF_HEAL}</div>
            <button class="ghost route-nav-btn" data-nav="approvals">Open Self-Heal Queue</button>
          </div>
          <div class="routing-item">
            <div class="chip query">Site Query</div>
            <div class="text-muted">${ACTION_BASIS.NEEDS_QUERY}</div>
            <button class="ghost route-nav-btn" data-nav="issue-inbox" data-action-filter="NEEDS_QUERY">Open Query Queue</button>
          </div>
          <div class="routing-item">
            <div class="chip human">Human Decision</div>
            <div class="text-muted">${ACTION_BASIS.NEEDS_HUMAN_DECISION}</div>
            <button class="ghost route-nav-btn" data-nav="user-inputs">Open Human Decision Queue</button>
          </div>
          <div class="routing-item">
            <div class="chip human">Lock Blocker</div>
            <div class="text-muted">${ACTION_BASIS.LOCK_CRITICAL}</div>
            <button class="ghost route-nav-btn" data-nav="lock-readiness">Open Lock Blockers</button>
          </div>
        </div>
      </div>

      <div class="conductor-card">
        <div class="flex-row"><span>${conductor.icon}</span><strong>${conductor.name}</strong>${infoTip("Governance router that assigns each issue to approvals, queries, decisions, or blockers.")}</div>
        <div class="text-muted">Classifying issues · Enforcing governance · Routing decisions</div>
        <div class="conductor-buckets">${bucketCards}</div>
      </div>

      <div class="flow-row triple">
        <div class="flow-line"></div>
        <div class="flow-line"></div>
        <div class="flow-line"></div>
      </div>

      <div>
        <div class="agent-section-title">Layer 4: Human Review ${infoTip("Final review queues requiring explicit human confirmation.")}</div>
        <div class="human-grid">${humanCards}</div>
      </div>

      <div class="escalation-reasons">
        <strong>Why escalation happens ${infoTip("Policy-driven explanation of why certain items must go to human review.")}</strong>
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

  qsa(".route-nav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const nav = btn.dataset.nav;
      const actionFilter = btn.dataset.actionFilter;
      if (actionFilter) {
        APP_STATE.issueFilters = {
          ...APP_STATE.issueFilters,
          action: actionFilter,
          severity: "ALL",
          custodian: "ALL",
          subject: "ALL",
          lockImpact: "ALL",
        };
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
    ${renderScreenGuide("data-explorer")}
    <div class="card">
      <div class="table-controls">
        <div class="text-muted">Source Table ${infoTip("Inspect source records, sort columns, and search any value to validate detections.")}</div>
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
  const start = Number(el.textContent || 0) || 0;
  if (start === target) {
    el.textContent = target.toString();
    return;
  }
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
  const statuses = qsa("#agent-network-content .ingestion-status");
  const syncTimes = qsa("#agent-network-content .sync-time");
  const now = new Date();
  const timeStr = APP_STATE.lastAutomationAt || now.toTimeString().slice(0, 8);
  if (locked) {
    numbers.forEach((el) => {
      const target = Number(el.dataset.base || el.dataset.target || 0);
      el.textContent = target.toString();
    });
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

  const animateAll = () => {
    numbers.forEach((el) => {
      const target = Number(el.dataset.base || el.dataset.target || 0);
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

/** @param {string} subjectId */
function computeSubjectRiskPoints(subjectId) {
  return computeRiskBreakdown(subjectId).points;
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
function syncTimelineFromIssue(issue) {
  const subjectId = issue.entity_keys?.subject_id;
  if (!subjectId) return;

  if (!APP_SUBJECT_TIMELINES[subjectId]) {
    APP_SUBJECT_TIMELINES[subjectId] = {
      subject_id: subjectId,
      site_id: issue.entity_keys.site_id || "SITE-A",
      events: [],
      linked_issues: [],
      clinical_narrative: "Ongoing monitoring timeline created from current cross-source signals.",
      open_loops: [],
      risk_score: 0,
    };
  }

  const timeline = APP_SUBJECT_TIMELINES[subjectId];
  const eventTypeMap = {
    edc_form_custodian: "visit",
    lab_signal_custodian: "lab",
    safety_event_custodian: "ae",
    meds_history_custodian: "med",
    device_epro_custodian: "device",
  };
  const sourceMap = {
    edc_form_custodian: "edc_visits.csv",
    lab_signal_custodian: "labs.csv",
    safety_event_custodian: "safety_ae.csv",
    meds_history_custodian: "meds.csv",
    device_epro_custodian: "device_epro.csv",
  };

  timeline.events.push({
    event_type: eventTypeMap[issue.custodian] || "event",
    date: nowIso().slice(0, 10),
    label: issue.short_title,
    source_file: sourceMap[issue.custodian] || "unknown.csv",
    row_id: issue.evidence?.[0]?.row_id || 0,
    details: {
      severity: issue.severity,
      action: issue.suggested_action,
      note: friendlyIssueSummary(issue),
    },
    linked_issue_ids: [issue.issue_id],
  });

  timeline.events.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (!timeline.linked_issues.includes(issue.issue_id)) timeline.linked_issues.push(issue.issue_id);

  const loopText = `${severityLabel(issue.severity)}: ${friendlyIssueSummary(issue)}`;
  if (!timeline.open_loops.includes(loopText)) timeline.open_loops.unshift(loopText);
  timeline.open_loops = timeline.open_loops.slice(0, 10);
  timeline.risk_score = computeSubjectRiskPoints(subjectId);
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
    readinessEl.textContent = `${computeReadinessPercent()}%`;
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
  syncAgentTreeWithState();
  if (APP_STATE.currentScreen === "live-ops") refreshLiveOpsDynamic();
  if (APP_STATE.currentScreen === "screen-agent-network") renderAgentNetwork();
  if (APP_STATE.currentScreen === "data-explorer") renderDataExplorer(APP_STATE.dataTab);
  if (APP_STATE.currentScreen === "issue-inbox") renderIssueInbox();
  // Keep timeline stable while presenting; user refreshes by changing subject selector.
  if (APP_STATE.currentScreen === "approvals") renderApprovals();
  if (APP_STATE.currentScreen === "user-inputs") renderUserInputs();
  if (APP_STATE.currentScreen === "lock-readiness") renderLockReadiness();
  if (APP_STATE.currentScreen === "audit-reports") renderAuditReports(APP_STATE.auditTab);
}

function runAutomationTick() {
  if (APP_STATE.lockMode) return;
  APP_STATE.lastAutomationAt = new Date().toTimeString().slice(0, 8);
  const newIssuesCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < newIssuesCount; i += 1) {
    const issue = buildRuntimeIssue();
    APP_ISSUES.push(issue);
    pushQueueForIssue(issue);
    appendAuditForIssue(issue);
    appendActivityForIssue(issue);
    appendSampleRows(issue);
    syncTimelineFromIssue(issue);
  }
  syncAgentTreeWithState();
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
  const queueStats = pendingCounts();

  const routeButtons = `
    <div class="card route-shortcuts" style="margin-bottom:12px;">
      <div class="route-shortcuts-head">
        <strong>Why items route to different queues</strong>
        ${infoTip("Use these shortcuts to explain queue logic and jump directly to the relevant slice of work.")}
      </div>
      <div class="route-shortcuts-grid">
        <button class="route-pill self" data-route-action="SELF_HEAL">
          Self-Heal (${queueStats.approvals})
          <span>${ACTION_BASIS.SELF_HEAL}</span>
        </button>
        <button class="route-pill query" data-route-action="NEEDS_QUERY">
          Site Query (${queueStats.queries})
          <span>${ACTION_BASIS.NEEDS_QUERY}</span>
        </button>
        <button class="route-pill human" data-route-action="NEEDS_HUMAN_DECISION">
          Human Decision (${queueStats.decisions})
          <span>${ACTION_BASIS.NEEDS_HUMAN_DECISION}</span>
        </button>
        <button class="route-pill lock" data-route-severity="LOCK_CRITICAL" data-route-lock="YES">
          Lock Blocker (${queueStats.blockers})
          <span>${ACTION_BASIS.LOCK_CRITICAL}</span>
        </button>
      </div>
    </div>
  `;

  const filterRow = `
    <div class="card">
      <div class="text-muted" style="margin-bottom:8px;">Triage Controls ${infoTip("Filter by severity, steward, subject, action, and lock impact to focus review.")}</div>
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

  container.innerHTML = `${renderScreenGuide("issue-inbox")}${routeButtons}${filterRow}<div id="issue-cards" style="display:grid; gap:12px; margin-top:12px;"></div>`;

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

    qs("#issue-summary").innerHTML = `${filtered.length} total · ${countBy(filtered, "LOCK_CRITICAL")} Lock Critical · ${countBy(filtered, "SAFETY_CRITICAL")} Safety Critical · ${countBy(filtered, "ENDPOINT_CRITICAL")} Endpoint Critical · ${countBy(filtered, "OPERATIONAL")} Operational<br><span class="text-muted">Confidence bars show detection certainty (0-100%), not medical risk magnitude.</span>`;

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

  qsa(".route-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.routeAction || "ALL";
      const severity = btn.dataset.routeSeverity || "ALL";
      const lock = btn.dataset.routeLock || "ALL";
      APP_STATE.issueFilters = {
        severity,
        custodian: "ALL",
        subject: "ALL",
        action,
        lockImpact: lock,
      };
      qs("#filter-severity").value = APP_STATE.issueFilters.severity;
      qs("#filter-custodian").value = APP_STATE.issueFilters.custodian;
      qs("#filter-subject").value = APP_STATE.issueFilters.subject;
      qs("#filter-action").value = APP_STATE.issueFilters.action;
      qs("#filter-lock").value = APP_STATE.issueFilters.lockImpact;
      applyFilters();
    });
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
      <div class="text-muted">Confidence scale: 0-100% detection certainty (not severity).</div>
      <div class="text-muted">Subject ${issue.entity_keys.subject_id || ""}</div>
    </div>
    <div class="card" style="margin-top:12px;">
      <strong>Evidence</strong> ${infoTip("Source fields and values used by the system to justify this issue.")}
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
      <strong>Plain‑Language Summary</strong> ${infoTip("Non-technical explanation for quick review.")}
      <p>${friendlyIssueSummary(issue)}</p>
    </div>
    <div class="card" style="margin-top:12px;">
      <strong>Why This Matters</strong> ${infoTip("Impact context describing safety, endpoint, or operational risk.")}
      <p>${humanizeText(issue.description)}</p>
    </div>
    ${proposed}
    <div class="modal-actions">${actions}</div>
    <div class="card" style="margin-top:12px;">
      <strong>Mini Audit Trail</strong> ${infoTip("Most recent system/user actions associated with this issue.")}
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
    syncAgentTreeWithState();
    showToast("Change approved and queued", "success");
    renderApprovals();
    updateBadges();
    closeIssueModal();
  } else if (action === "reject") {
    syncAgentTreeWithState();
    showToast("Change rejected. Site notified.", "warning");
    closeIssueModal();
  } else if (action === "query") {
    syncAgentTreeWithState();
    showToast("Drafted site query", "info");
    closeIssueModal();
  } else if (action === "decision") {
    syncAgentTreeWithState();
    closeIssueModal();
    navigateTo("user-inputs", { issueId: issue.issue_id });
  } else if (action === "ack") {
    syncAgentTreeWithState();
    showToast("Issue acknowledged", "info");
    closeIssueModal();
  }
}
function renderSubjectTimeline(subjectId) {
  const container = qs("#subject-timeline-content");
  const subjects = Object.keys(APP_SUBJECT_TIMELINES || {})
    .sort((a, b) => computeRiskBreakdown(b).points - computeRiskBreakdown(a).points);

  const selected = subjectId || subjects[0];
  APP_STATE.currentSubjectId = selected;
  const timeline = APP_SUBJECT_TIMELINES[selected];
  if (!timeline) return;
  const risk = computeRiskBreakdown(selected);

  const selector = `
    <select id="subject-selector">
      ${subjects
        .map((s) => {
          const points = computeRiskBreakdown(s).points;
          return `<option value="${s}" ${s === selected ? "selected" : ""}>${s} (risk: ${points})</option>`;
        })
        .join("")}
    </select>
  `;

  const events = timeline.events
    .map((ev, idx) => {
      const dotClass = ev.event_type;
      const linkedIds = ev.linked_issue_ids || [];
      const linkedIssues = linkedIds
        .map((issueId) => APP_ISSUES.find((i) => i.issue_id === issueId))
        .filter(Boolean);
      const warning = linkedIds.length
        ? `
          <div class="timeline-warning-wrap">
            <span class="timeline-warning">⚠ ${linkedIds.length} linked issues</span>
            <div class="timeline-warning-list">
              ${linkedIssues.length
                ? linkedIssues
                    .slice(0, 4)
                    .map((issue) => `<button class="timeline-issue-link" data-issue="${issue.issue_id}">${severityLabel(issue.severity)} · ${issue.short_title}</button>`)
                    .join("")
                : linkedIds
                    .slice(0, 4)
                    .map((issueId) => `<button class="timeline-issue-link" data-issue="${issueId}">${issueId}</button>`)
                    .join("")}
              ${linkedIds.length > 4 ? `<div class="text-muted">+${linkedIds.length - 4} more linked issues</div>` : ""}
            </div>
          </div>`
        : "";
      return `
        <div class="timeline-event" style="animation-delay:${(idx + 1) * 0.1}s" data-issues="${linkedIds.join(",")}">
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
    ${renderScreenGuide("subject-timeline")}
    <div class="card" style="margin-bottom:12px;">
      ${selector}
      <div class="text-muted" style="margin-top:8px;">Timeline view is stable by design and does not auto-refresh every cycle. This prevents context loss during explanation.</div>
    </div>
    <div class="timeline-layout">
      <div class="card">
        <div class="timeline">${events}${contradiction}</div>
      </div>
      <div class="right-panel">
        <div class="card">
          <strong>Clinical Narrative</strong> ${infoTip("Summarized patient story synthesized across all data sources.")}
          <p>${timeline.clinical_narrative}</p>
        </div>
        <div class="card">
          <strong>Open Loops</strong> ${infoTip("Unresolved items still requiring query, decision, or correction.")}
          ${openLoops || "<div class='text-muted'>No open loops</div>"}
        </div>
        <div class="card">
          <strong>Risk Score</strong> ${infoTip("Weighted severity score to prioritize high-risk subjects.")}
          <div class="risk-score">${risk.points}</div>
          <div class="text-muted">Score type: points (not percentage)</div>
          <div class="text-muted">Formula: Lock (${risk.counts.LOCK_CRITICAL})×10 + Safety (${risk.counts.SAFETY_CRITICAL})×7 + Endpoint (${risk.counts.ENDPOINT_CRITICAL})×5 + Operational (${risk.counts.OPERATIONAL})×1</div>
        </div>
        <div class="card">
          <details>
            <summary><strong>Timeline Linker Notes</strong> ${infoTip("Cross-source linkage rationale used during timeline synthesis.")}</summary>
            <p>Cross-source linkages detected based on overlapping dates, signals, and textual contradictions.</p>
          </details>
        </div>
      </div>
    </div>
  `;

  qs("#subject-selector").addEventListener("change", (e) => {
    renderSubjectTimeline(e.target.value);
  });

  qsa(".timeline-issue-link").forEach((el) => {
    el.addEventListener("click", () => {
      const issueId = el.dataset.issue;
      if (issueId) openIssueModal(issueId);
    });
  });
}

function renderApprovals() {
  const container = qs("#approvals-content");
  const pending = APP_PENDING_APPROVALS.filter((i) => !APP_STATE.approvedIssues.has(i.issue_id));

  const header = `
    <div class="card" style="margin-bottom:12px;">
      <strong>${pending.length} proposals pending · ${new Set(pending.map((i) => i.entity_keys.subject_id)).size} subjects · ${pending.filter((i) => i.proposed_change?.affects_lock).length} lock-impacting</strong> ${infoTip("Review and approve system-proposed corrections before they are applied.")}
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

  container.innerHTML = renderScreenGuide("approvals") + header + (cards || "<div class='text-muted'>No items match your filters</div>");

  qsa(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (APP_STATE.lockMode) return;
      const check = qs(`.approve-check[data-issue='${btn.dataset.issue}']`);
      if (!check.checked) {
        showToast("Please confirm review before approving", "warning");
        return;
      }
      APP_STATE.approvedIssues.add(btn.dataset.issue);
      syncAgentTreeWithState();
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
      syncAgentTreeWithState();
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

  const queueIntro = items.length ? `<div class="card" style="margin-bottom:12px;"><strong>Human Decision Queue</strong> ${infoTip("Capture required clinical or data-management decisions with rationale.")}</div>` : "";
  container.innerHTML = renderScreenGuide("user-inputs") + queueIntro + (cards || "<div class='text-muted'>No items match your filters</div>");

  qsa(".decision-submit").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (APP_STATE.lockMode) return;
      const rationale = qs(`#rationale-${btn.dataset.issue}`);
      if (!rationale.value.trim()) {
        showToast("Rationale is required", "warning");
        return;
      }
      APP_STATE.completedDecisions.add(btn.dataset.issue);
      syncAgentTreeWithState();
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
  const readiness = computeReadinessPercent();
  const pending = pendingCounts();
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
    ${renderScreenGuide("lock-readiness")}
    <div class="grid-2">
      <div class="card">
        <strong>Readiness Checklist</strong> ${infoTip("Checklist gates that must pass before lock can proceed.")}
        ${checklist
          .map((c) => `<div>${c.ok ? "✅" : "❌"} ${c.label}</div>`)
          .join("")}
      </div>
      <div class="card" style="text-align:center;">
        <strong>Readiness</strong> ${infoTip("Dynamic score summarizing lock preparedness across open issues.")}
        <svg class="progress-ring" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="50" stroke="#E5E7EB" stroke-width="10" fill="none"></circle>
          <circle cx="60" cy="60" r="50" stroke="#F59E0B" stroke-width="10" fill="none"
            stroke-dasharray="314" stroke-dashoffset="${314 - (314 * readiness) / 100}"></circle>
        </svg>
        <div class="risk-score">${readiness}%</div>
        <div class="text-muted">Score type: percentage out of 100</div>
        <div class="text-muted">Calculation basis: blockers, critical severities, and pending decision/query queues.</div>
      </div>
    </div>
    <div class="card" style="margin-top:12px;">
      <strong>Lock Blockers</strong> ${infoTip("Critical unresolved items that directly prevent lock/freeze.")}
      <div style="display:grid; gap:8px; margin-top:8px;">${blockers || "<div class='text-muted'>No blockers</div>"}</div>
    </div>
    <div class="card" style="margin-top:12px;">
      <strong>Simulate Database Lock</strong> ${infoTip("Enable read-only mode to preview behavior after lock.")}
      <div class="flex-row" style="justify-content: space-between;">
        <span>Lock Mode toggle</span>
        <label class="switch">
          <input id="lock-toggle" type="checkbox" ${APP_STATE.lockMode ? "checked" : ""} />
          <span class="slider"></span>
        </label>
      </div>
    </div>
    <div class="card" style="margin-top:12px;">
      <strong>Why This Score Moved</strong>
      <div class="text-muted">Pending approvals: ${pending.approvals} · Pending human decisions: ${pending.decisions} · Pending site queries: ${pending.queries} · Lock blockers: ${pending.blockers}</div>
      <div class="text-muted">Interpretation: higher blockers and unresolved critical items reduce lock readiness.</div>
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
      ${renderScreenGuide("audit-reports")}
      ${tabs}
      <div class="grid-2" style="margin-top:12px;">
        <div class="card">
          <strong>Data Review Report</strong> ${infoTip("Narrative summary of quality findings and review progress.")}
          <div class="markdown">${renderMarkdown(APP_REPORTS.data_review_report || "")}</div>
          <button class="ghost copy-report" data-report="data">Copy to Clipboard</button>
        </div>
        <div class="card">
          <strong>Lock Readiness Pack</strong> ${infoTip("Formal readiness package for lock governance and sign-off.")}
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
      ${renderScreenGuide("audit-reports")}
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
        <strong>Trace View</strong> ${infoTip("Step-by-step audit lineage for a selected issue from detection to execution.")}
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
  APP_STATE.lastAutomationAt = new Date().toTimeString().slice(0, 8);
  syncAgentTreeWithState();
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

  const openGuide = qs("#open-screen-guide");
  if (openGuide) {
    openGuide.addEventListener("click", () => openScreenManual(APP_STATE.currentScreen));
  }

  qs("#screen-guide-modal").addEventListener("click", (e) => {
    if (e.target.dataset.closeManual) closeScreenManual();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeIssueModal();
      closeScreenManual();
    }
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

