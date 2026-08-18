"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  buildSummaryText,
  downloadFile,
  formatPretty,
  getMonthRange,
  getWeekRange,
  indexById,
  shareViaEmail,
  shareViaWhatsApp,
  todayISO,
} from "@/lib/data";
import { api } from "@/lib/api";
import { useDepartments, useEmployees, useReports } from "@/lib/queries";

export default function SummaryPage() {
  const [start, setStart] = useState(getWeekRange().start);
  const [end, setEnd] = useState(getWeekRange().end);
  const [dept, setDept] = useState("all");
  const [audience, setAudience] = useState("CEO");
  const [preset, setPreset] = useState("weekly");
  const [shareOpen, setShareOpen] = useState(false);
  // Fixed CEO / leadership recipient list — HR can still edit before sending.
  const [ceoEmail, setCeoEmail] = useState(
    "aditya.goel@ornatesolar.com, anisha@ornatesolar.com, tarini@ornatesolar.com, hr.ornatesolar@gmail.com",
  );
  const [ceoPhone, setCeoPhone] = useState("");

  const { data: departments = [] } = useDepartments();
  const { data: employees = [] } = useEmployees();
  const reportFilters = useMemo(
    () => ({ start, end, ...(dept !== "all" && { department: dept }) }),
    [start, end, dept],
  );
  const { data: reports = [] } = useReports(reportFilters);

  const employeesById = useMemo(() => indexById(employees), [employees]);
  // Departments that get a per-employee summed table at the bottom of the
  // summary page.  Useful for teams whose daily reports are mostly numeric
  // (counts, revenue, etc.) so HR can scan totals at a glance.
  const SUMMARY_TABLE_SLUGS = ["insideSales", "sales"];
  const summaryDepts = useMemo(
    () =>
      SUMMARY_TABLE_SLUGS.map((slug) => departments.find((d) => d.slug === slug))
        .filter(Boolean),
    [departments],
  );
  // The per-department summary tables can be heavy to render (one row per
  // employee × per field, with text concatenation), so we only show them on
  // explicit intent — either the user filters to a specific department, or
  // they click the "Generate summary tables" button below.  Filter changes
  // (date / dept) reset the flag so a stale generation doesn't linger.
  const [showAllSummaryTables, setShowAllSummaryTables] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowAllSummaryTables(false);
  }, [dept, start, end]);

  const visibleSummaryDepts = useMemo(() => {
    if (dept !== "all") return summaryDepts.filter((d) => d.slug === dept);
    return showAllSummaryTables ? summaryDepts : [];
  }, [summaryDepts, dept, showAllSummaryTables]);

  function applyPreset(kind) {
    setPreset(kind);
    if (kind === "weekly") {
      const r = getWeekRange();
      setStart(r.start);
      setEnd(r.end);
    } else if (kind === "monthly") {
      const r = getMonthRange();
      setStart(r.start);
      setEnd(r.end);
    }
  }

  const summaryText = useMemo(
    () =>
      buildSummaryText(reports, { start, end }, { usersById: employeesById, audience }),
    [reports, start, end, employeesById, audience]
  );

  const stats = useMemo(() => {
    const employeeIds = new Set(reports.map((r) => r.user_id));
    return {
      total: reports.length,
      employees: employeeIds.size,
      challenges: reports.filter((r) => r.data?.challenges && r.data.challenges !== "—").length,
    };
  }, [reports]);

  const [exporting, setExporting] = useState(false);
  async function exportExcel() {
    // Multi-sheet XLSX: Sales — Detail, Inside Sales — Detail (with per-field
    // columns), plus a combined Detailed Summary for all other departments.
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      if (dept !== "all") params.set("department", dept);
      const res = await api.get(`/api/reports/export.xlsx?${params.toString()}`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `summary_${start}_to_${end}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`Couldn't export Excel: ${e.message || "unknown error"}`);
    } finally {
      setExporting(false);
    }
  }

  function copyText() {
    if (typeof navigator === "undefined") return;
    navigator.clipboard?.writeText(summaryText);
  }

  // Email / WhatsApp now share the EXCEL file, not the plain-text summary.
  // Browsers can't auto-attach files via mailto: / wa.me, so we:
  //   1. Generate + download the Excel locally (so HR has it)
  //   2. Open the mail / WhatsApp compose window with a short message
  //   3. Toast a reminder so HR attaches the just-downloaded file
  async function emailSummary() {
    await exportExcel();
    const subject = `Daily Report Summary — ${formatPretty(start)} to ${formatPretty(end)}`;
    const body =
      `Hi,\n\nPlease find the Daily Report Excel summary attached ` +
      `(${formatPretty(start)} → ${formatPretty(end)}).\n\nRegards`;
    shareViaEmail({ to: ceoEmail, subject, body });
    toast.success("Excel downloaded. Attach it to the email window before sending.");
  }

  async function whatsappSummary() {
    await exportExcel();
    const text =
      `Daily Report Excel summary (${formatPretty(start)} → ${formatPretty(end)}) attached.`;
    shareViaWhatsApp({ phone: ceoPhone, text });
    toast.success("Excel downloaded. Attach it to the WhatsApp window before sending.");
  }

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-700 ring-1 ring-orange-200">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            Digest
          </span>
          <div className="leading-tight">
            <h1 className="text-base font-semibold tracking-tight text-zinc-900">Generate Summary</h1>
            <p className="text-[11px] text-zinc-600">
              Build a weekly or monthly digest from daily reports — then download or share with the CEO.
            </p>
          </div>
        </div>
      </header>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-1.5">
        <PresetButton active={preset === "weekly"} onClick={() => applyPreset("weekly")}>
          Weekly (5 working days)
        </PresetButton>
        <PresetButton active={preset === "monthly"} onClick={() => applyPreset("monthly")}>
          Monthly (last 30 days)
        </PresetButton>
        <PresetButton active={preset === "custom"} onClick={() => setPreset("custom")}>
          Custom range
        </PresetButton>
      </div>

      {/* Controls */}
      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From">
            <input
              type="date"
              value={start}
              max={end}
              onChange={(e) => { setStart(e.target.value); setPreset("custom"); }}
              className={inputClass}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={end}
              min={start}
              max={todayISO()}
              onChange={(e) => { setEnd(e.target.value); setPreset("custom"); }}
              className={inputClass}
            />
          </Field>
          <Field label="Department">
            <select value={dept} onChange={(e) => setDept(e.target.value)} className={inputClass}>
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d.slug} value={d.slug}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Prepared for">
            <input type="text" value={audience} onChange={(e) => setAudience(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Reports in range" value={stats.total} />
        <Stat label="Employees covered" value={stats.employees} />
        <Stat label="Reported challenges" value={stats.challenges} />
      </div>

      {/* Preview + actions */}
      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Summary preview</h3>
            <p className="text-[11px] text-zinc-500">
              {formatPretty(start)} → {formatPretty(end)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionBtn onClick={copyText} icon="copy">Copy</ActionBtn>
            <ActionBtn onClick={exportExcel} icon="download" tone="dark" disabled={exporting}>
              {exporting ? "Preparing…" : "Excel"}
            </ActionBtn>
            <ActionBtn onClick={() => setShareOpen((v) => !v)} icon="share" tone="primary">
              Share with CEO
            </ActionBtn>
          </div>
        </div>

        {shareOpen && (
          <div className="space-y-3 border-b border-zinc-100 bg-zinc-50 px-4 py-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Field label="Recipient emails (comma-separated)">
                <input
                  type="text"
                  value={ceoEmail}
                  onChange={(e) => setCeoEmail(e.target.value)}
                  placeholder="aditya.goel@ornatesolar.com, anisha@…"
                  className={inputClass}
                />
              </Field>
              <Field label="CEO WhatsApp number (with country code)">
                <input
                  type="tel"
                  value={ceoPhone}
                  onChange={(e) => setCeoPhone(e.target.value)}
                  placeholder="e.g. 919812345678"
                  className={inputClass}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={emailSummary}
                className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700"
              >
                <MailIcon className="h-3.5 w-3.5" />
                Send via Email
              </button>
              <button
                onClick={whatsappSummary}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1ebd5b]"
              >
                <WhatsAppIcon className="h-3.5 w-3.5" />
                Send via WhatsApp
              </button>
              <p className="text-[10px] text-zinc-500">
                Both buttons first download the Excel file, then open a new
                tab — Gmail web compose for Email, WhatsApp Web for WhatsApp.
                Attach the downloaded Excel in that new tab and click Send.
              </p>
            </div>
          </div>
        )}

        <div className="max-h-105 overflow-auto p-4 text-[13px] leading-7 text-zinc-700">
          {renderSummaryLines(summaryText)}
        </div>
      </div>

      {dept === "all" && !showAllSummaryTables && summaryDepts.length > 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-5 text-center">
          <p className="text-[12px] text-zinc-600">
            Per-department summary tables are hidden. Pick a department from the
            filter above, or generate tables for{" "}
            <span className="font-medium text-zinc-900">
              {summaryDepts.map((d) => d.name).join(" and ")}
            </span>{" "}
            below.
          </p>
          <button
            onClick={() => setShowAllSummaryTables(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
          >
            Generate summary tables
          </button>
        </div>
      )}

      {visibleSummaryDepts.map((d) => {
        // Drop columns HR doesn't want on the Inside Sales summary table —
        // matches the same exclusion applied in the Excel export.
        const HIDDEN_FIELDS_BY_DEPT = {
          insideSales: new Set([
            "dataCalledType",
            "mailSent",
            "whatsappSent",
            "otherWorks",
          ]),
        };
        const hidden = HIDDEN_FIELDS_BY_DEPT[d.slug];
        const visibleFields = hidden
          ? (d.report_fields || []).filter((f) => !hidden.has(f.key))
          : d.report_fields;
        return (
          <DeptSummaryTable
            key={d.slug}
            title={d.name}
            deptSlug={d.slug}
            reports={reports}
            employees={employees}
            fields={visibleFields}
            start={start}
            end={end}
          />
        );
      })}
    </div>
  );
}

/* ---------- Per-department tabular summary ----------
 *
 * Same shape as the original Inside Sales table but works for any department.
 * Each report field is classified as numeric (every non-empty value parses
 * cleanly as a number) or text.  Numeric fields are summed per employee,
 * text fields show distinct values comma-joined so HR still sees where
 * someone went / what they wrote without a hopeless 0 sum.
 */
function DeptSummaryTable({ title, deptSlug, reports, employees, fields, start, end }) {
  // Classify each field as numeric or text.  A field is numeric when EITHER
  //   (a) its label looks like a count/amount column ("No. of …", "Revenue",
  //       "Total …", "Calls", "Leads", "Amount", "₹", etc.), so even when
  //       people type mixed content like "4, 2, On Medical Leave, 3" we
  //       still extract and sum the numbers; or
  //   (b) every non-empty value cleanly parses as a single number.
  const fieldKinds = useMemo(() => {
    const kinds = {};
    for (const f of fields) {
      if (labelLooksNumeric(f.label || f.key || "")) {
        kinds[f.key] = "numeric";
        continue;
      }
      let isNumeric = true;
      for (const r of reports) {
        const raw = r.data?.[f.key];
        if (raw == null || String(raw).trim() === "") continue;
        if (String(raw).trim().toLowerCase() === "on leave") continue;
        const cleaned = String(raw).replace(/[₹,\s]/g, "");
        if (cleaned === "" || !Number.isFinite(Number(cleaned))) {
          isNumeric = false;
          break;
        }
      }
      kinds[f.key] = isNumeric ? "numeric" : "text";
    }
    return kinds;
  }, [fields, reports]);

  const rows = useMemo(() => {
    const deptUsers = employees.filter((u) => u.department?.slug === deptSlug);
    const byUser = {};
    for (const u of deptUsers) byUser[u.id] = [];
    for (const r of reports) {
      if (byUser[r.user_id]) byUser[r.user_id].push(r);
    }
    return deptUsers
      .map((u) => {
        const userReports = byUser[u.id] || [];
        const cells = {};
        for (const f of fields) {
          if (fieldKinds[f.key] === "numeric") {
            // Sum every number we can find inside the cell strings — handles
            // both clean numeric cells AND mixed content like
            // "4, 2, On Medical Leave, 3" or "Monthly Sales- 543.15".
            let total = 0;
            for (const r of userReports) {
              extractNumbers(r.data?.[f.key]).forEach((n) => (total += n));
            }
            cells[f.key] = total;
          } else {
            const distinct = new Set();
            for (const r of userReports) {
              const v = r.data?.[f.key];
              if (v != null && String(v).trim() && String(v).trim().toLowerCase() !== "on leave") {
                distinct.add(String(v).trim());
              }
            }
            cells[f.key] = [...distinct].join(", ");
          }
        }
        return {
          id: u.id,
          name: (u.first_name || u.username || "").trim(),
          cells,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [reports, employees, deptSlug, fields, fieldKinds]);

  const totals = useMemo(() => {
    const t = {};
    for (const f of fields) {
      if (fieldKinds[f.key] === "numeric") {
        t[f.key] = rows.reduce((sum, r) => sum + (r.cells[f.key] || 0), 0);
      } else {
        const all = new Set();
        for (const r of rows) {
          if (r.cells[f.key]) {
            r.cells[f.key]
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((v) => all.add(v));
          }
        }
        // Show just the count number for text columns — matches numeric columns
      // visually so the Total row is uniform.
      t[f.key] = all.size > 0 ? all.size : "—";
      }
    }
    return t;
  }, [rows, fields, fieldKinds]);

  const rangeLabel =
    start === end ? formatPretty(start) : `${formatPretty(start)} → ${formatPretty(end)}`;

  function cellDisplay(value, key) {
    if (fieldKinds[key] === "numeric") return formatCell(value, key);
    return value || "—";
  }

  function copyTable() {
    if (typeof navigator === "undefined") return;
    const header = ["Name", ...fields.map((f) => f.label)].join("\t");
    const body = rows
      .map((r) => [r.name, ...fields.map((f) => cellDisplay(r.cells[f.key], f.key))].join("\t"))
      .join("\n");
    const totalLine = ["Total", ...fields.map((f) => cellDisplay(totals[f.key], f.key))].join("\t");
    navigator.clipboard?.writeText([header, body, totalLine].join("\n"));
  }

  function downloadCSVTable() {
    const escape = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Name", ...fields.map((f) => f.label)].map(escape).join(",");
    const body = rows
      .map((r) =>
        [r.name, ...fields.map((f) => cellDisplay(r.cells[f.key], f.key))].map(escape).join(","),
      )
      .join("\n");
    const totalLine = ["Total", ...fields.map((f) => cellDisplay(totals[f.key], f.key))].map(escape).join(",");
    const csv = [header, body, totalLine].join("\n");
    const safeSlug = (deptSlug || "summary").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    downloadFile(`${safeSlug}_${start}_to_${end}.csv`, csv, "text/csv");
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">{title} — summary table</h3>
          <p className="text-[11px] text-zinc-500">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <ActionBtn onClick={copyTable} icon="copy">Copy</ActionBtn>
          <ActionBtn onClick={downloadCSVTable} icon="download" tone="dark">CSV</ActionBtn>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-zinc-50 text-zinc-700">
              <th className="border-b border-r border-zinc-200 px-3 py-2 text-left font-semibold">
                {rangeLabel}
              </th>
              {fields.map((f) => (
                <th
                  key={f.key}
                  className={`border-b border-r border-zinc-200 px-3 py-2 font-semibold last:border-r-0 ${
                    fieldKinds[f.key] === "numeric" ? "text-right" : "text-left"
                  }`}
                >
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={fields.length + 1} className="px-3 py-6 text-center text-zinc-500">
                  No {title} employees found.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-50">
                  <td className="border-b border-r border-zinc-200 px-3 py-2 font-medium text-zinc-900">
                    {r.name}
                  </td>
                  {fields.map((f) => (
                    <td
                      key={f.key}
                      className={`border-b border-r border-zinc-200 px-3 py-2 text-zinc-800 last:border-r-0 ${
                        fieldKinds[f.key] === "numeric" ? "text-right" : "text-left"
                      }`}
                    >
                      {cellDisplay(r.cells[f.key], f.key)}
                    </td>
                  ))}
                </tr>
              ))
            )}
            {rows.length > 0 && (
              <tr className="bg-zinc-50 font-semibold text-zinc-900">
                <td className="border-r border-zinc-200 px-3 py-2">Total</td>
                {fields.map((f) => (
                  <td
                    key={f.key}
                    className={`border-r border-zinc-200 px-3 py-2 last:border-r-0 ${
                      fieldKinds[f.key] === "numeric" ? "text-right" : "text-left"
                    }`}
                  >
                    {cellDisplay(totals[f.key], f.key)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Label hint — when the column name reads like a count or amount, we always
// treat it as numeric so the totals row sums numbers buried inside free text.
const NUMERIC_LABEL_RE =
  /\b(no\.?|number|count|total|amount|revenue|calls?|meetings?|enquiries|leads?|companies|visits?|orders?|hours?|sum|rate|₹|rs\.?|inr|amt|pis?|picked|closed|lost|following|invoice|sent|shared|received|made|type|works?)\b/i;
function labelLooksNumeric(label) {
  return NUMERIC_LABEL_RE.test(String(label || ""));
}

// Pull every number out of a free-text cell.  Handles thousand-separator
// commas ("1,287.32" → 1287.32), skips year-looking integers (1900-2100),
// skips ordinal dates ("25th"), and strips ISO date prefixes like
// "2026-05-04:" so "2026-05-04: 5 calls" becomes [5] (not [5, 4, 5]).
function extractNumbers(s) {
  if (s == null) return [];
  // Drop ISO date prefixes ("2026-05-04:", "2026-05-04 - ", "2026-05-04 -")
  // so the day/month digits don't pollute the sum.
  const text = String(s).replace(/\d{4}-\d{2}-\d{2}\s*[:\-]?\s*/g, " ");
  const out = [];
  // Match either a 1,234,567.89-style number (thousand separators) OR a
  // plain 1234.56 number, then optionally consume an ordinal suffix so we
  // can detect and discard date-like matches ("25th", "1st").
  const re =
    /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(st|nd|rd|th)\b)?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2]) continue; // ordinal — skip (1st, 25th, …)
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    if (Number.isInteger(n) && n >= 1900 && n <= 2100) continue; // likely a year
    out.push(n);
  }
  return out;
}

function formatCell(value, key) {
  if (!Number.isFinite(value)) return "—";
  if (key === "invoiceTotal") return `₹${value.toLocaleString("en-IN")}`;
  return value.toLocaleString("en-IN");
}

/* ---------- bits ---------- */

const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20";

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function renderSummaryLines(text) {
  if (!text) return null;
  return text.split("\n").map((line, i) => {
    const idx = line.indexOf(":");
    if (idx === -1) {
      return <p key={i} className="my-0.5">{line}</p>;
    }
    return (
      <p key={i} className="my-0.5">
        <span className="font-semibold text-zinc-900">{line.slice(0, idx + 1)}</span>
        {line.slice(idx + 1)}
      </p>
    );
  });
}

function PresetButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
        active
          ? "border-orange-600 bg-orange-600 text-white hover:bg-orange-700"
          : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

function ActionBtn({ children, onClick, icon, tone = "default", disabled = false }) {
  const tones = {
    default: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
    dark: "bg-zinc-900 text-white hover:bg-zinc-800",
    primary: "bg-orange-600 text-white hover:bg-orange-700",
  };
  const Icon = { copy: CopyIcon, download: DownloadIcon, share: ShareIcon }[icon];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${tones[tone]} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

/* ---------- icons ---------- */

function CopyIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function DownloadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}
function ShareIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}
function MailIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}
function WhatsAppIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.5 3.5A11.7 11.7 0 0 0 3 18.7L2 22l3.5-1A11.7 11.7 0 1 0 20.5 3.5Zm-8.5 18a9.6 9.6 0 0 1-4.9-1.3l-.4-.2-2.1.6.6-2-.2-.4A9.6 9.6 0 1 1 12 21.5Zm5.4-7.2c-.3-.1-1.7-.8-2-.9s-.5-.1-.7.2-.8.9-1 1.1-.4.2-.7.1a8 8 0 0 1-3.9-3.4c-.3-.5.3-.5.8-1.5a.5.5 0 0 0 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.6 3.6 0 0 0-1.1 2.7c0 1.6 1.1 3.1 1.3 3.3s2.3 3.6 5.7 5c1.4.6 2.5.9 3.3.7s1.7-.7 2-1.4.3-1.3.2-1.4-.3-.2-.7-.3Z" />
    </svg>
  );
}
