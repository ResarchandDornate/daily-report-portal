"use client";

/**
 * Pure utilities only. No mock data, no localStorage, no department lists.
 * All entity data comes from the backend via @/lib/queries.
 *
 * The helpers below understand the shape returned by the FastAPI backend:
 *   user      = { id, username, email, first_name, last_name, role, title,
 *                 contact_number, department: { id, slug, name, color, report_fields } | null }
 *   report    = { id, user_id, date, data: { [fieldKey]: string }, submitted_at }
 *   department = { id, slug, name, color, report_fields: [{ key, label }] }
 */

/* ---------- Defaults ---------- */

export const DEFAULT_REPORT_FIELDS = [
  { key: "workDone", label: "Work Done" },
  { key: "workInProgress", label: "Work in Progress" },
  { key: "upcomingPriorities", label: "Upcoming Priorities" },
  { key: "challenges", label: "Challenges Faced / Support Needed" },
  { key: "otherUpdate", label: "Other Update" },
];

/* ---------- Date helpers ---------- */

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function shiftDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatPretty(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function getWeekRange(refIso = todayISO()) {
  const start = shiftDays(refIso, -6);
  return { start, end: refIso, label: "Last 7 days" };
}

export function getMonthRange(refIso = todayISO()) {
  const start = shiftDays(refIso, -29);
  return { start, end: refIso, label: "Last 30 days" };
}

export function inRange(iso, start, end) {
  return iso >= start && iso <= end;
}

/* ---------- User / report helpers ---------- */

export function fullName(user) {
  if (!user) return "—";
  const n = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  return n || user.username || user.email || "—";
}

export function getReportFields(department) {
  return department?.report_fields?.length ? department.report_fields : DEFAULT_REPORT_FIELDS;
}

/* Build an { [id]: user } lookup map from a list. */
export function indexById(rows = []) {
  const map = {};
  rows.forEach((r) => { map[r.id] = r; });
  return map;
}

/* Build a { [slug]: department } lookup map. */
export function indexBySlug(rows = []) {
  const map = {};
  rows.forEach((r) => { map[r.slug] = r; });
  return map;
}

/* ---------- Summary + CSV ---------- */

/**
 * Build a short, narrative summary paragraph from a set of daily reports.
 *
 * The summary reads as flowing prose (no bullets, no headings).  It synthesises
 * the actual values employees filled in across the chosen date range — opening
 * sentence with scope, one sentence per department covering their key
 * activities, and one closing sentence on challenges raised, if any.
 *
 * For a single employee (e.g. an employee detail page), the per-department loop
 * naturally collapses to one sentence about that person.
 */
export function buildSummaryText(reports, range, opts = {}) {
  const { usersById = {} } = opts;
  // _audience kept for API compatibility but no longer rendered — paragraph
  // form already implies it's a leadership-facing readout.

  const startLabel = formatPretty(range.start);
  const endLabel = formatPretty(range.end);

  if (!reports || reports.length === 0) {
    return `No reports were submitted between ${startLabel} and ${endLabel}.`;
  }

  // Group reports by department so we can write one sentence per dept.
  const byDept = {};
  const employeeIds = new Set();
  for (const r of reports) {
    const user = usersById[r.user_id];
    if (!user) continue;
    employeeIds.add(user.id);
    const deptName = user.department?.name || "—";
    if (!byDept[deptName]) byDept[deptName] = { reports: [], people: new Set() };
    byDept[deptName].reports.push(r);
    byDept[deptName].people.add(user.id);
  }

  const sentences = [];

  const totalReports = reports.length;
  const peopleCount = employeeIds.size;
  const deptNames = Object.keys(byDept).sort();

  // ─── Single-employee path ────────────────────────────────────────────
  // Skip the "X submitted N reports" opener — the surrounding card already
  // shows that ("Weekly Summary — Abhishek Jadon · 6 reports").  Dive straight
  // into one sentence per report column.
  if (peopleCount === 1 && reports[0]) {
    const onlyUser = usersById[reports[0].user_id];
    const dept = onlyUser?.department;
    // Cap to a few items per field so the paragraph stays readable.  The
    // "Daily reports" table beneath the summary card already shows every entry,
    // so this paragraph just needs to convey the gist.
    const ITEMS_PER_FIELD = 3;
    const fields = getReportFields(dept);
    for (const f of fields) {
      if (f.key === "challenges" || f.key === "remarks") continue; // covered separately at the end
      const values = new Set();
      for (const r of reports) {
        const v = r.data?.[f.key];
        if (typeof v !== "string") continue;
        const t = v.trim();
        if (t && t !== "—" && t !== "-") values.add(t);
      }
      if (values.size === 0) continue;
      const picked = [...values].slice(0, ITEMS_PER_FIELD);
      sentences.push(`${f.label}: ${_joinSentenceItems(picked)}.`);
    }
  } else {
    // ─── Multi-employee path ───────────────────────────────────────────
    const deptList = _joinList(deptNames);
    sentences.push(
      `Between ${startLabel} and ${endLabel}, ${peopleCount} ${peopleCount === 1 ? "employee" : "employees"} ` +
      `across ${deptNames.length} ${deptNames.length === 1 ? "department" : "departments"} ` +
      `(${deptList}) submitted ${totalReports} daily ${totalReports === 1 ? "report" : "reports"}.`
    );

    // For company-wide summaries we only cover the top 5 departments by volume
    // to keep the paragraph readable, and round off with a count of the rest.
    const TOP_DEPTS = 5;
    const ACTIVITIES_PER_DEPT = 3;
    const rankedDepts = [...deptNames].sort(
      (a, b) => byDept[b].reports.length - byDept[a].reports.length,
    );
    const topDepts = rankedDepts.slice(0, TOP_DEPTS);
    const restDepts = rankedDepts.slice(TOP_DEPTS);

    for (const deptName of topDepts) {
      const data = byDept[deptName];
      const activities = new Set();
      for (const r of data.reports) {
        for (const [key, val] of Object.entries(r.data || {})) {
          if (key === "challenges" || key === "remarks") continue;
          if (typeof val !== "string") continue;
          const trimmed = val.trim();
          if (trimmed && trimmed !== "—" && trimmed !== "-") activities.add(trimmed);
        }
      }
      if (activities.size === 0) continue;

      const picked = [...activities].slice(0, ACTIVITIES_PER_DEPT);
      const stat = ` (${data.people.size} ${data.people.size === 1 ? "person" : "people"}, ${data.reports.length} ${data.reports.length === 1 ? "report" : "reports"})`;
      sentences.push(`${deptName}${stat}: ${_joinSentenceItems(picked)}.`);
    }

    if (restDepts.length > 0) {
      sentences.push(`${restDepts.length} other ${restDepts.length === 1 ? "department" : "departments"} (${_joinList(restDepts)}) also reported in.`);
    }
  }

  // Closing sentence — challenges and free-text remarks.
  const notes = new Set();
  for (const r of reports) {
    for (const k of ["challenges", "remarks"]) {
      const v = r.data?.[k];
      if (typeof v !== "string") continue;
      const t = v.trim();
      if (t && t !== "—" && t !== "-") notes.add(t);
    }
  }
  if (notes.size > 0) {
    // Single-employee summaries get every note (they're already focused).
    // Multi-employee summaries cap to 3 to keep the paragraph tight.
    const picked = peopleCount === 1 ? [...notes] : [...notes].slice(0, 3);
    const label = peopleCount === 1 ? "Notes & challenges" : "Challenges raised";
    sentences.push(`${label}: ${_joinSentenceItems(picked)}.`);
  }

  return sentences.join(" ");
}

/* Joins items with commas + "and" before the last one. */
function _joinList(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/* Joins free-text items with commas to read like natural prose.  Strips any
 * trailing periods/semicolons/whitespace from each item so the joined output
 * doesn't have double punctuation.
 */
function _joinSentenceItems(items) {
  return items
    .map((s) => s.replace(/[;.\s]+$/, ""))
    .join(", ");
}

export function reportsToCSV(reports, opts = {}) {
  const { usersById = {} } = opts;
  const keyOrder = [];
  const keyLabels = {};
  reports.forEach((r) => {
    const user = usersById[r.user_id];
    const fields = user ? getReportFields(user.department) : DEFAULT_REPORT_FIELDS;
    fields.forEach((f) => {
      if (!(f.key in keyLabels)) {
        keyOrder.push(f.key);
        keyLabels[f.key] = f.label;
      }
    });
  });

  const header = ["Date", "Employee", "Department", ...keyOrder.map((k) => keyLabels[k])];
  const escape = (v) => {
    const s = (v ?? "").toString();
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = [...reports]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      const user = usersById[r.user_id];
      const deptName = user?.department?.name || "—";
      return [
        r.date,
        user ? fullName(user) : `User #${r.user_id}`,
        deptName,
        ...keyOrder.map((k) => r.data?.[k] ?? ""),
      ]
        .map(escape)
        .join(",");
    });
  return [header.join(","), ...rows].join("\n");
}

/* ---------- Browser utils ---------- */

export function downloadFile(filename, content, mime = "text/plain") {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function shareViaEmail({ to = "", subject, body }) {
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = url;
}

export function shareViaWhatsApp({ phone = "", text }) {
  const base = phone ? `https://wa.me/${phone.replace(/[^\d]/g, "")}` : "https://wa.me/";
  const url = `${base}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
