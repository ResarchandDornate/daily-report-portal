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

export function buildSummaryText(reports, range, opts = {}) {
  const { usersById = {}, audience = "CEO" } = opts;
  const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date));
  const byDept = {};
  sorted.forEach((r) => {
    const user = usersById[r.user_id];
    if (!user) return;
    const deptName = user.department?.name || "—";
    if (!byDept[deptName]) byDept[deptName] = {};
    if (!byDept[deptName][user.id]) byDept[deptName][user.id] = { user, items: [] };
    byDept[deptName][user.id].items.push(r);
  });

  const lines = [];
  lines.push(`Daily Report Summary — ${formatPretty(range.start)} to ${formatPretty(range.end)}`);
  lines.push(`Prepared for: ${audience}`);
  lines.push("");

  Object.keys(byDept)
    .sort()
    .forEach((deptName) => {
      lines.push(`=== ${deptName} ===`);
      Object.values(byDept[deptName]).forEach(({ user, items }) => {
        const fields = getReportFields(user.department);
        lines.push(`\n${fullName(user)} (${user.title || "—"})`);
        items.forEach((r) => {
          lines.push(`  ${formatPretty(r.date)}`);
          fields.forEach((f) => {
            const v = r.data?.[f.key];
            if (v && v !== "—") lines.push(`    • ${f.label}: ${v}`);
          });
        });
      });
      lines.push("");
    });

  if (Object.keys(byDept).length === 0) {
    lines.push("No reports found for the selected range.");
  }
  return lines.join("\n");
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
