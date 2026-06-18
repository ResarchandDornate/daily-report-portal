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
  // Use local components instead of toISOString — see getWeekRange comment
  // below for why (timezone offset shifts the date in non-UTC locales).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatPretty(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Same as formatPretty but prefixed with the abbreviated weekday — used in
// table date cells where surfacing the day-of-week aids quick scanning.
// e.g. "Wed, 13 May 2026".
export function formatPrettyWithDay(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* How many working days (Mon-Fri) have elapsed in the current week so far,
 * including today.  Used as the denominator of the "X / Y" attendance badge.
 *
 *   Mon → 1   (only today)
 *   Tue → 2
 *   Wed → 3
 *   Thu → 4
 *   Fri → 5   (full week so far)
 *   Sat → 5   (the week just ended)
 *   Sun → 5   (also the just-ended week)
 *
 * Matches getWeekRange()'s window: on a weekday it's today's day-of-week
 * (1-5); on a weekend it's the previous full Mon-Fri (always 5).
 */
export function workdaysElapsedThisWeek(refIso = todayISO()) {
  const d = new Date(refIso + "T00:00:00");
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (dow === 0 || dow === 6) return 5;
  return dow; // 1..5
}

export function getWeekRange(refIso = todayISO()) {
  // "Weekly" = the CURRENT calendar week (Monday → today, capped at Friday).
  // - Mon → Fri: range is this-week's-Mon → today
  // - Sat / Sun: range is this-week's-Mon → this-week's-Fri (week is over)
  //
  // This matches what employees intuitively call "this week".  On Monday,
  // before submitting, the X/5 badge is 0/5; after today's submission it
  // becomes 1/5.  It only reaches 5/5 once the employee has submitted on
  // each weekday from Monday to Friday.
  const d = new Date(refIso + "T00:00:00");
  const dow = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  // Days to subtract to land on this week's Monday.
  let mondayOffset;
  if (dow === 0) {
    mondayOffset = -6; // Sun → previous Monday (the week that just ended)
  } else if (dow === 6) {
    mondayOffset = -5; // Sat → this week's Monday
  } else {
    mondayOffset = -(dow - 1); // Mon-Fri → this week's Monday
  }
  const monday = new Date(d);
  monday.setDate(monday.getDate() + mondayOffset);

  // End: today (if we're mid-week) or this Friday (if weekend / today past Fri).
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  const end = d <= friday ? d : friday;

  // IMPORTANT: format using local date components, not toISOString().
  // toISOString() converts to UTC, which shifts the date by one day in
  // any non-UTC timezone (e.g. IST is +5:30, so local midnight Tuesday
  // becomes UTC Monday 18:30 → slice gives the wrong day).
  const toIso = (x) => {
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  return { start: toIso(monday), end: toIso(end), label: "This week" };
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
  // One LINE per report field — easier to scan than a wall of prose.
  if (peopleCount === 1 && reports[0]) {
    const onlyUser = usersById[reports[0].user_id];
    const dept = onlyUser?.department;
    const fields = getReportFields(dept);
    for (const f of fields) {
      if (f.key === "challenges" || f.key === "remarks") continue; // closing sentence
      const line = _summariseFieldLine(f, reports);
      if (line) sentences.push(line);
    }
  } else {
    // ─── Multi-employee path ───────────────────────────────────────────
    // Per-employee breakdown: one section per submitter showing what
    // they filled in across their reports.  Grouped by department for
    // scan-ability so all of Sales clusters together, then Inside Sales,
    // etc.
    const deptList = _joinList(deptNames);
    sentences.push(
      `Between ${startLabel} and ${endLabel}, ${peopleCount} ${peopleCount === 1 ? "employee" : "employees"} ` +
      `across ${deptNames.length} ${deptNames.length === 1 ? "department" : "departments"} ` +
      `(${deptList}) submitted ${totalReports} daily ${totalReports === 1 ? "report" : "reports"}.`
    );

    // Group reports by user.
    const byUser = {};
    for (const r of reports) {
      const user = usersById[r.user_id];
      if (!user) continue;
      if (!byUser[user.id]) byUser[user.id] = { user, reports: [] };
      byUser[user.id].reports.push(r);
    }

    // Sort employees by department name, then alphabetically by full name
    // so Sales/Joel sits with Sales/Khushi etc.
    const sortedEntries = Object.values(byUser).sort((a, b) => {
      const da = a.user.department?.name || "~";
      const db = b.user.department?.name || "~";
      if (da !== db) return da.localeCompare(db);
      return fullName(a.user).localeCompare(fullName(b.user));
    });

    // For each employee: a header line ("Name — Dept · N reports:") followed
    // by one field line each (same formatter as the single-employee path).
    // Blank line between people.
    let lastDept = null;
    for (const { user, reports: empReports } of sortedEntries) {
      const dept = user.department;
      const deptName = dept?.name || "—";
      const fields = getReportFields(dept);

      // Insert a blank line between departments for a bit of breathing room.
      if (lastDept !== null && lastDept !== deptName) sentences.push("");
      lastDept = deptName;

      const empHeader =
        `${fullName(user)} — ${deptName} · ` +
        `${empReports.length} ${empReports.length === 1 ? "report" : "reports"}:`;
      sentences.push(empHeader);

      for (const f of fields) {
        if (f.key === "challenges" || f.key === "remarks") continue; // closing sentence
        const line = _summariseFieldLine(f, empReports);
        if (line) sentences.push(`  ${line}`); // indent for readability
      }
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

  // One line per sentence — render with `whitespace-pre-line` so each
  // field/department becomes its own visible line.
  return sentences.join("\n");
}

/* Summarise a single field's values across multiple reports.
 *
 * - If every non-empty value parses as a number, return a sum + average line
 *   (e.g. "Total Calls: total 4,610 across 6 days (avg 768).").  Useful for
 *   numeric departments like Inside Sales.
 * - Otherwise list up to N distinct text values
 *   (e.g. "Warehouse Coordination: Cycle count, Spot audit, Reorganized rack.").
 *
 * Returns `null` if there's nothing to say.
 */
function _summariseFieldLine(field, reports, opts = {}) {
  const { itemsPerField = 3 } = opts;
  const numbers = [];
  const textValues = new Set();
  let nonEmpty = 0;
  for (const r of reports) {
    const v = r.data?.[field.key];
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || t === "—" || t === "-") continue;
    nonEmpty++;
    const stripped = t.replace(/[₹,\s]/g, "");
    const n = Number(stripped);
    if (stripped !== "" && Number.isFinite(n)) {
      numbers.push(n);
    } else {
      textValues.add(t);
    }
  }
  if (nonEmpty === 0) return null;

  // Pure-numeric column — totals/averages are far more useful than distinct samples.
  if (numbers.length === nonEmpty) {
    const sum = numbers.reduce((a, b) => a + b, 0);
    const avg = sum / numbers.length;
    const isCurrency = /₹|invoice|revenue|amount/i.test(field.label) || /invoiceTotal/i.test(field.key);
    const fmt = (n) => {
      const rounded = Number.isInteger(n) ? n : Math.round(n);
      return isCurrency
        ? `₹${rounded.toLocaleString("en-IN")}`
        : rounded.toLocaleString("en-IN");
    };
    const dayWord = numbers.length === 1 ? "day" : "days";
    return `${field.label}: total ${fmt(sum)} across ${numbers.length} ${dayWord} (avg ${fmt(avg)}).`;
  }

  // Mixed or text-only — list distinct values.
  if (textValues.size === 0) return null;
  const picked = [...textValues].slice(0, itemsPerField);
  return `${field.label}: ${_joinSentenceItems(picked)}.`;
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
  // Open Gmail's web compose URL in a new tab — works for anyone signed in
  // to Gmail / Google Workspace and avoids the "Chrome doesn't know how to
  // open mailto:" problem on machines without a default mail client.
  // Multiple recipients are joined with raw commas (Gmail accepts both
  // commas and URL-encoded `%2C`, but plain commas read better in URLs).
  const addrs = String(to)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");
  const url =
    `https://mail.google.com/mail/?view=cm&fs=1` +
    `&to=${encodeURIComponent(addrs)}` +
    `&su=${encodeURIComponent(subject || "")}` +
    `&body=${encodeURIComponent(body || "")}`;
  // Open in a new tab so the user's current dashboard stays open behind it.
  const w = window.open(url, "_blank", "noopener");
  // Pop-up blocked? Fall back to same-tab navigation so the user still gets
  // there.  Toasts on the calling page will already have surfaced the
  // "download → attach → send" reminder.
  if (!w) {
    window.location.href = url;
  }
}

export function shareViaWhatsApp({ phone = "", text }) {
  const base = phone ? `https://wa.me/${phone.replace(/[^\d]/g, "")}` : "https://wa.me/";
  const url = `${base}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
