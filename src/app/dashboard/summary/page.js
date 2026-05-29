"use client";

import { useMemo, useState } from "react";
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
  const [ceoEmail, setCeoEmail] = useState("ceo@ornatesolar.com");
  const [ceoPhone, setCeoPhone] = useState("");

  const { data: departments = [] } = useDepartments();
  const { data: employees = [] } = useEmployees();
  const reportFilters = useMemo(
    () => ({ start, end, ...(dept !== "all" && { department: dept }) }),
    [start, end, dept],
  );
  const { data: reports = [] } = useReports(reportFilters);

  const employeesById = useMemo(() => indexById(employees), [employees]);
  const insideSalesDept = useMemo(
    () => departments.find((d) => d.slug === "insideSales"),
    [departments],
  );
  const showInsideSalesTable = dept === "insideSales" && !!insideSalesDept;

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
    // Reuses the Reports page exporter — one sheet per department, full
    // dataset in the current date range (not just what's in memory).
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

  function downloadText() {
    downloadFile(`summary_${start}_to_${end}.txt`, summaryText, "text/plain");
  }

  function copyText() {
    if (typeof navigator === "undefined") return;
    navigator.clipboard?.writeText(summaryText);
  }

  function emailSummary() {
    shareViaEmail({
      to: ceoEmail,
      subject: `Daily Report Summary — ${formatPretty(start)} to ${formatPretty(end)}`,
      body: summaryText,
    });
  }

  function whatsappSummary() {
    shareViaWhatsApp({ phone: ceoPhone, text: summaryText });
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
      <div className="grid grid-cols-3 gap-3">
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
            <ActionBtn onClick={downloadText} icon="download">Download .txt</ActionBtn>
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
              <Field label="CEO email">
                <input
                  type="email"
                  value={ceoEmail}
                  onChange={(e) => setCeoEmail(e.target.value)}
                  placeholder="ceo@example.com"
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
                Email opens your default mail app pre-filled. WhatsApp opens wa.me with the summary.
              </p>
            </div>
          </div>
        )}

        <div className="max-h-105 overflow-auto p-4 text-[13px] leading-7 text-zinc-700">
          {renderSummaryLines(summaryText)}
        </div>
      </div>

      {showInsideSalesTable && (
        <InsideSalesTable
          reports={reports}
          employees={employees}
          fields={insideSalesDept.report_fields}
          start={start}
          end={end}
        />
      )}
    </div>
  );
}

/* ---------- Inside Sales tabular summary ---------- */

function InsideSalesTable({ reports, employees, fields, start, end }) {
  const rows = useMemo(() => {
    const insideSalesUsers = employees.filter(
      (u) => u.department?.slug === "insideSales",
    );
    const sumsByUser = {};
    for (const u of insideSalesUsers) {
      sumsByUser[u.id] = Object.fromEntries(fields.map((f) => [f.key, 0]));
    }
    for (const r of reports) {
      if (!sumsByUser[r.user_id]) continue;
      for (const f of fields) {
        const raw = r.data?.[f.key];
        const n = parseNumber(raw);
        sumsByUser[r.user_id][f.key] += n;
      }
    }
    return insideSalesUsers
      .map((u) => ({
        id: u.id,
        name: (u.first_name || u.username || "").trim(),
        sums: sumsByUser[u.id],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [reports, employees, fields]);

  const totals = useMemo(() => {
    const t = Object.fromEntries(fields.map((f) => [f.key, 0]));
    for (const r of rows) {
      for (const f of fields) t[f.key] += r.sums[f.key];
    }
    return t;
  }, [rows, fields]);

  const rangeLabel =
    start === end ? formatPretty(start) : `${formatPretty(start)} → ${formatPretty(end)}`;

  function copyTable() {
    if (typeof navigator === "undefined") return;
    const header = ["Name", ...fields.map((f) => f.label)].join("\t");
    const body = rows
      .map((r) => [r.name, ...fields.map((f) => r.sums[f.key])].join("\t"))
      .join("\n");
    const totalLine = ["Total", ...fields.map((f) => totals[f.key])].join("\t");
    navigator.clipboard?.writeText([header, body, totalLine].join("\n"));
  }

  function downloadCSVTable() {
    const header = ["Name", ...fields.map((f) => f.label)].join(",");
    const body = rows
      .map((r) => [r.name, ...fields.map((f) => r.sums[f.key])].join(","))
      .join("\n");
    const totalLine = ["Total", ...fields.map((f) => totals[f.key])].join(",");
    const csv = [header, body, totalLine].join("\n");
    downloadFile(`inside_sales_${start}_to_${end}.csv`, csv, "text/csv");
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Inside Sales — summary table</h3>
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
                  className="border-b border-r border-zinc-200 px-3 py-2 text-right font-semibold last:border-r-0"
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
                  No Inside Sales employees found.
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
                      className="border-b border-r border-zinc-200 px-3 py-2 text-right text-zinc-800 last:border-r-0"
                    >
                      {formatCell(r.sums[f.key], f.key)}
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
                    className="border-r border-zinc-200 px-3 py-2 text-right last:border-r-0"
                  >
                    {formatCell(totals[f.key], f.key)}
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

function parseNumber(v) {
  if (v == null) return 0;
  const cleaned = String(v).replace(/[₹,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
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
