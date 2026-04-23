"use client";

export const DEPARTMENTS = [
  { id: "rnd", name: "R&D Team", color: "indigo" },
  { id: "logistics", name: "Logistics", color: "amber" },
  { id: "webdev", name: "WebDev Team", color: "emerald" },
  { id: "sales", name: "Sales", color: "rose" },
  { id: "finance", name: "Finance", color: "sky" },
];

export const HR_USER = {
  id: "hr-admin",
  name: "HR Admin",
  email: "hr@ornatesolar.com",
  role: "hr",
  department: "HR",
  title: "HR Manager",
};

export const EMPLOYEES = [
  { id: "e1", name: "Aarav Sharma", email: "aarav@ornatesolar.com", department: "rnd", title: "Senior Engineer" },
  { id: "e2", name: "Meera Kapoor", email: "meera@ornatesolar.com", department: "rnd", title: "R&D Lead" },
  { id: "e3", name: "Rohan Verma", email: "rohan@ornatesolar.com", department: "rnd", title: "Engineer" },
  { id: "e4", name: "Priya Patel", email: "priya@ornatesolar.com", department: "logistics", title: "Logistics Lead" },
  { id: "e5", name: "Karan Mehta", email: "karan@ornatesolar.com", department: "logistics", title: "Coordinator" },
  { id: "e6", name: "Sneha Iyer", email: "sneha@ornatesolar.com", department: "logistics", title: "Analyst" },
  { id: "e7", name: "Vikram Singh", email: "vikram@ornatesolar.com", department: "webdev", title: "Tech Lead" },
  { id: "e8", name: "Ananya Desai", email: "ananya@ornatesolar.com", department: "webdev", title: "Frontend Engineer" },
  { id: "e9", name: "Rahul Joshi", email: "rahul@ornatesolar.com", department: "webdev", title: "Backend Engineer" },
  { id: "e10", name: "Divya Nair", email: "divya@ornatesolar.com", department: "sales", title: "Sales Head" },
  { id: "e11", name: "Arjun Reddy", email: "arjun@ornatesolar.com", department: "sales", title: "Account Executive" },
  { id: "e12", name: "Pooja Bhatt", email: "pooja@ornatesolar.com", department: "sales", title: "Sales Associate" },
  { id: "e13", name: "Manish Gupta", email: "manish@ornatesolar.com", department: "finance", title: "Finance Lead" },
  { id: "e14", name: "Neha Agarwal", email: "neha@ornatesolar.com", department: "finance", title: "Accountant" },
  { id: "e15", name: "Sanjay Khanna", email: "sanjay@ornatesolar.com", department: "finance", title: "Analyst" },
];

export const REPORT_FIELDS = [
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

/* ---------- Seed data ---------- */

const SEED_KEY = "drp_reports_v1";
const USER_KEY = "drp_current_user_v1";

function generateSeed() {
  const today = todayISO();
  const samples = [
    {
      workDone: "Completed module specs and shared with team.",
      workInProgress: "Reviewing supplier datasheets.",
      upcomingPriorities: "Begin prototype testing on Friday.",
      challenges: "Awaiting approval on BoM revision.",
      otherUpdate: "Attended weekly sync.",
    },
    {
      workDone: "Closed 3 customer tickets and shipped fix v2.4.1.",
      workInProgress: "Refactoring auth flow for portal.",
      upcomingPriorities: "QA pass on dashboard module.",
      challenges: "Need staging DB credentials.",
      otherUpdate: "Onboarded new intern.",
    },
    {
      workDone: "Reconciled April vendor invoices.",
      workInProgress: "Drafting Q2 budget sheet.",
      upcomingPriorities: "GST filing on 25th.",
      challenges: "Pending PO numbers from procurement.",
      otherUpdate: "—",
    },
    {
      workDone: "Followed up with 12 leads, closed 2 deals.",
      workInProgress: "Preparing pitch deck for Bengaluru client.",
      upcomingPriorities: "Site visit on Thursday.",
      challenges: "Need updated pricing sheet.",
      otherUpdate: "CRM cleanup completed.",
    },
    {
      workDone: "Coordinated 4 dispatches across north zone.",
      workInProgress: "Tracking pending shipment to Pune.",
      upcomingPriorities: "Inventory audit Monday.",
      challenges: "Truck breakdown delayed Friday delivery.",
      otherUpdate: "—",
    },
  ];
  const reports = [];
  EMPLOYEES.forEach((emp, idx) => {
    for (let dayOffset = 1; dayOffset <= 10; dayOffset++) {
      // skip a couple of days for variety so "missing" feature has data
      if ((idx + dayOffset) % 7 === 0) continue;
      const date = shiftDays(today, -dayOffset);
      const sample = samples[(idx + dayOffset) % samples.length];
      reports.push({
        id: `${emp.id}-${date}`,
        employeeId: emp.id,
        date,
        ...sample,
        submittedAt: new Date().toISOString(),
      });
    }
  });
  return reports;
}

/* ---------- localStorage ---------- */

export function loadReports() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SEED_KEY);
    if (raw) return JSON.parse(raw);
    const seed = generateSeed();
    localStorage.setItem(SEED_KEY, JSON.stringify(seed));
    return seed;
  } catch {
    return [];
  }
}

export function saveReports(reports) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SEED_KEY, JSON.stringify(reports));
}

export function upsertReport(report) {
  const all = loadReports();
  const idx = all.findIndex((r) => r.id === report.id);
  if (idx >= 0) all[idx] = { ...all[idx], ...report };
  else all.push(report);
  saveReports(all);
  return all;
}

export function loadCurrentUser() {
  if (typeof window === "undefined") return HR_USER;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : HR_USER;
  } catch {
    return HR_USER;
  }
}

export function saveCurrentUser(user) {
  if (typeof window === "undefined") return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearCurrentUser() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(USER_KEY);
}

/* ---------- Lookup helpers ---------- */

export function employeeById(id) {
  if (id === HR_USER.id) return HR_USER;
  return EMPLOYEES.find((e) => e.id === id);
}

export function departmentById(id) {
  return DEPARTMENTS.find((d) => d.id === id);
}

export function reportsInRange(reports, start, end) {
  return reports.filter((r) => inRange(r.date, start, end));
}

export function missingToday(reports, employees = EMPLOYEES, dateIso = todayISO()) {
  const submittedIds = new Set(reports.filter((r) => r.date === dateIso).map((r) => r.employeeId));
  return employees.filter((e) => !submittedIds.has(e.id));
}

/* ---------- Summary + export ---------- */

export function buildSummaryText(reports, range, audience = "CEO") {
  const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date));
  const byDept = {};
  sorted.forEach((r) => {
    const emp = employeeById(r.employeeId);
    if (!emp) return;
    const dept = departmentById(emp.department)?.name || emp.department;
    if (!byDept[dept]) byDept[dept] = {};
    if (!byDept[dept][emp.id]) byDept[dept][emp.id] = { emp, items: [] };
    byDept[dept][emp.id].items.push(r);
  });

  const lines = [];
  lines.push(`Daily Report Summary — ${formatPretty(range.start)} to ${formatPretty(range.end)}`);
  lines.push(`Prepared for: ${audience}`);
  lines.push("");

  Object.keys(byDept)
    .sort()
    .forEach((dept) => {
      lines.push(`=== ${dept} ===`);
      Object.values(byDept[dept]).forEach(({ emp, items }) => {
        lines.push(`\n${emp.name} (${emp.title})`);
        items.forEach((r) => {
          lines.push(`  ${formatPretty(r.date)}`);
          if (r.workDone) lines.push(`    • Done: ${r.workDone}`);
          if (r.workInProgress) lines.push(`    • In progress: ${r.workInProgress}`);
          if (r.upcomingPriorities) lines.push(`    • Priorities: ${r.upcomingPriorities}`);
          if (r.challenges) lines.push(`    • Challenges: ${r.challenges}`);
          if (r.otherUpdate && r.otherUpdate !== "—") lines.push(`    • Other: ${r.otherUpdate}`);
        });
      });
      lines.push("");
    });

  if (Object.keys(byDept).length === 0) {
    lines.push("No reports found for the selected range.");
  }

  return lines.join("\n");
}

export function reportsToCSV(reports) {
  const header = [
    "Date",
    "Employee",
    "Department",
    "Work Done",
    "Work in Progress",
    "Upcoming Priorities",
    "Challenges Faced/Support Needed",
    "Other Update",
  ];
  const escape = (v) => {
    const s = (v ?? "").toString();
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = [...reports]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      const emp = employeeById(r.employeeId);
      const dept = emp ? departmentById(emp.department)?.name || emp.department : "—";
      return [
        r.date,
        emp?.name || r.employeeId,
        dept,
        r.workDone,
        r.workInProgress,
        r.upcomingPriorities,
        r.challenges,
        r.otherUpdate,
      ]
        .map(escape)
        .join(",");
    });
  return [header.join(","), ...rows].join("\n");
}

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
