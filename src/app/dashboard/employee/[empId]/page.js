"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  buildSummaryText,
  downloadFile,
  formatPretty,
  formatPrettyWithDay,
  fullName,
  getMonthRange,
  getReportFields,
  getWeekRange,
  reportsToCSV,
  shareViaEmail,
  shareViaWhatsApp,
  shiftDays,
  todayISO,
} from "@/lib/data";
import { useEmployee, useMe, useReports, useSubmitReport } from "@/lib/queries";
import { Table } from "@/components/Table";

export default function EmployeePage() {
  const params = useParams();
  const empId = Number(params.empId);

  const { data: employee, isLoading: empLoading, isError: empError } = useEmployee(empId);
  const { data: myReports = [] } = useReports(
    Number.isFinite(empId) ? { employee: empId } : {},
  );

  const dept = employee?.department;
  const empFields = useMemo(() => getReportFields(dept), [dept]);

  const [showFilter, setShowFilter] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState(todayISO());
  const [summary, setSummary] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [ceoEmail, setCeoEmail] = useState("ceo@ornatesolar.com");
  const [ceoPhone, setCeoPhone] = useState("");

  // HR can edit any employee's reports.  When a row's Edit button is clicked
  // we open a modal with the existing values pre-filled and the field shape
  // matching the employee's department template.
  const { data: me } = useMe();
  const isHR = me?.role === "hr";
  const submit = useSubmitReport();
  const [editing, setEditing] = useState(null); // null | the report row being edited
  const [editForm, setEditForm] = useState({});  // values keyed by field.key

  function openEdit(report) {
    setEditing(report);
    const initial = {};
    empFields.forEach((f) => { initial[f.key] = report.data?.[f.key] || ""; });
    setEditForm(initial);
  }
  function closeEdit() {
    setEditing(null);
    setEditForm({});
  }
  async function saveEdit() {
    if (!editing) return;
    const cleaned = {};
    empFields.forEach((f) => { cleaned[f.key] = editForm[f.key] || ""; });
    try {
      await submit.mutateAsync({ date: editing.date, data: cleaned, user_id: empId });
      closeEdit();
    } catch {
      /* toast already fired by the mutation onError */
    }
  }

  useEffect(() => {
    if (!start && myReports.length) {
      const earliest = myReports.reduce((min, r) => (r.date < min ? r.date : min), myReports[0].date);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStart(earliest);
    }
  }, [myReports, start]);

  const filtered = useMemo(() => {
    return [...myReports]
      .filter((r) => (start ? r.date >= start : true))
      .filter((r) => (end ? r.date <= end : true))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [myReports, start, end]);

  const stats = useMemo(() => {
    const lastDate = myReports.length
      ? myReports.reduce((max, r) => (r.date > max ? r.date : max), myReports[0].date)
      : null;
    const submittedToday = myReports.some((r) => r.date === todayISO());
    return {
      total: myReports.length,
      inRange: filtered.length,
      lastDate,
      submittedToday,
    };
  }, [myReports, filtered]);

  function generateSummary(kind) {
    if (!employee) return;
    let range;
    if (kind === "weekly") range = getWeekRange();
    else if (kind === "monthly") range = getMonthRange();
    else range = { start, end };

    const reportsForRange = myReports.filter((r) => r.date >= range.start && r.date <= range.end);
    const usersById = { [employee.id]: employee };
    const text = buildSummaryText(reportsForRange, range, { usersById, audience: "CEO" });
    setSummary({ kind, range, text, reports: reportsForRange });
    setShareOpen(false);
    setTimeout(() => {
      const el = document.getElementById("summary-card");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function downloadSummaryCSV() {
    if (!summary || !employee) return;
    const csv = reportsToCSV(summary.reports, { usersById: { [employee.id]: employee } });
    downloadFile(`${fullName(employee).replace(/\s+/g, "_")}_${summary.range.start}_to_${summary.range.end}.csv`, csv, "text/csv");
  }

  function downloadSummaryText() {
    if (!summary || !employee) return;
    downloadFile(`${fullName(employee).replace(/\s+/g, "_")}_${summary.range.start}_to_${summary.range.end}.txt`, summary.text, "text/plain");
  }

  function copySummary() {
    if (!summary || typeof navigator === "undefined") return;
    navigator.clipboard?.writeText(summary.text);
  }

  function emailSummary() {
    if (!summary || !employee) return;
    shareViaEmail({
      to: ceoEmail,
      subject: `${fullName(employee)} — ${summary.kind === "weekly" ? "Weekly" : summary.kind === "monthly" ? "Monthly" : "Report"} Summary (${formatPretty(summary.range.start)} – ${formatPretty(summary.range.end)})`,
      body: summary.text,
    });
  }

  function whatsappSummary() {
    if (!summary) return;
    shareViaWhatsApp({ phone: ceoPhone, text: summary.text });
  }

  function resetFilter() {
    if (myReports.length) {
      const earliest = myReports.reduce((min, r) => (r.date < min ? r.date : min), myReports[0].date);
      setStart(earliest);
    } else {
      setStart("");
    }
    setEnd(todayISO());
  }

  function setLast7() { setStart(shiftDays(todayISO(), -6)); setEnd(todayISO()); }
  function setLast30() { setStart(shiftDays(todayISO(), -29)); setEnd(todayISO()); }

  if (empLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-600 border-t-transparent" />
      </div>
    );
  }

  if (empError || !employee) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900">
        <h2 className="text-sm font-semibold">Employee not found</h2>
        <p className="mt-1 text-xs">No employee with id <code className="rounded bg-rose-100 px-1">{params.empId}</code>.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Link href="/dashboard" className="hover:text-orange-700">Overview</Link>
        <span>/</span>
        {dept && (
          <>
            <Link href={`/dashboard/department/${dept.slug}`} className="hover:text-orange-700">
              {dept.name}
            </Link>
            <span>/</span>
          </>
        )}
        <span className="font-medium text-zinc-800">{fullName(employee)}</span>
      </nav>

      {/* Header card */}
      <div className={`relative overflow-hidden rounded-lg border ${tintBorder(dept?.color)} ${tintBg(dept?.color)} px-4 py-3 shadow-soft`}>
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={fullName(employee)} />
            <div className="leading-tight">
              <div className="flex items-center gap-1.5">
                <h1 className="text-base font-semibold tracking-tight text-zinc-900">{fullName(employee)}</h1>
                <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${badgeBg(dept?.color)}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${dotBg(dept?.color)}`} />
                  {dept?.name || "—"}
                </span>
                {stats.submittedToday ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                    Submitted
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                    Missing today
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-600">{employee.title || "—"} • {employee.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-center">
            <Stat label="Total reports submitted" value={stats.total} />
            <Stat label="Reports in selected range" value={stats.inRange} />
            <Stat label="Last report on" value={stats.lastDate ? formatPretty(stats.lastDate) : "—"} small />
          </div>
        </div>
      </div>

      {/* Action toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setShowFilter((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              showFilter
                ? "border-orange-300 bg-orange-50 text-orange-700"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            <FilterIcon className="h-3.5 w-3.5" />
            Filter
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => generateSummary("weekly")}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            Weekly
          </button>
          <button
            onClick={() => generateSummary("monthly")}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            Monthly
          </button>
          <button
            onClick={() => generateSummary("custom")}
            className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700"
          >
            Generate for filter
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilter && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
            <Field label="From">
              <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className={inputClass} />
            </Field>
            <Field label="To">
              <input type="date" value={end} min={start} max={todayISO()} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
            </Field>
            <div className="sm:col-span-2 flex flex-wrap items-end gap-1.5">
              <button onClick={setLast7} className={chipClass}>Last 7 days</button>
              <button onClick={setLast30} className={chipClass}>Last 30 days</button>
              <button onClick={resetFilter} className={chipClass}>All time</button>
              <button
                onClick={() => { resetFilter(); setShowFilter(false); }}
                className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary card */}
      {summary && (
        <div id="summary-card" className="rounded-lg border border-orange-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-orange-50 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                {summary.kind === "weekly" ? "Weekly" : summary.kind === "monthly" ? "Monthly" : "Custom"} Summary — {fullName(employee)}
              </h3>
              <p className="text-[11px] text-zinc-500">
                {formatPretty(summary.range.start)} → {formatPretty(summary.range.end)} • {summary.reports.length} {summary.reports.length === 1 ? "report" : "reports"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <ActionBtn onClick={copySummary}>Copy</ActionBtn>
              <ActionBtn onClick={downloadSummaryText}>Download .txt</ActionBtn>
              <ActionBtn onClick={downloadSummaryCSV} tone="dark">CSV</ActionBtn>
              <ActionBtn onClick={() => setShareOpen((v) => !v)} tone="primary">Share with CEO</ActionBtn>
              <ActionBtn onClick={() => setSummary(null)} tone="ghost">Close</ActionBtn>
            </div>
          </div>
          {shareOpen && (
            <div className="space-y-2.5 border-b border-zinc-100 bg-zinc-50 px-4 py-3">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Field label="CEO email">
                  <input type="email" value={ceoEmail} onChange={(e) => setCeoEmail(e.target.value)} className={inputClass} />
                </Field>
                <Field label="CEO WhatsApp (with country code)">
                  <input type="tel" value={ceoPhone} onChange={(e) => setCeoPhone(e.target.value)} placeholder="e.g. 919812345678" className={inputClass} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={emailSummary} className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700">
                  Send via Email
                </button>
                <button onClick={whatsappSummary} className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1ebd5b]">
                  Send via WhatsApp
                </button>
              </div>
            </div>
          )}
          <div className="max-h-95 overflow-auto p-4 text-[13px] leading-7 text-zinc-700">
            {renderSummaryLines(summary.text)}
          </div>
        </div>
      )}

      {/* Reports table */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Daily reports</h3>
            <p className="text-[11px] text-zinc-500">{filtered.length} {filtered.length === 1 ? "report" : "reports"} in current range</p>
          </div>
        </div>
        <Table maxHeight={460}>
          <Table.Head>
            <Table.Row>
              <Table.Th className="w-12 text-center">#</Table.Th>
              <Table.Th className="min-w-27.5 whitespace-nowrap">Date</Table.Th>
              {empFields.map((f) => (
                <Table.Th key={f.key} className="min-w-60">{f.label}</Table.Th>
              ))}
              {isHR && <Table.Th className="w-16 text-right">Actions</Table.Th>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {filtered.length === 0 ? (
              <Table.Empty colSpan={2 + empFields.length + (isHR ? 1 : 0)} message="No reports in this range." />
            ) : (
              filtered.map((r, i) => (
                <Table.Row key={r.id}>
                  <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                  <Table.Td className="whitespace-nowrap align-top font-medium text-zinc-800">{formatPrettyWithDay(r.date)}</Table.Td>
                  {empFields.map((f) => (
                    <Table.Td key={f.key} className="min-w-60 align-top text-zinc-700">{r.data?.[f.key] || "—"}</Table.Td>
                  ))}
                  {isHR && (
                    <Table.Td className="align-top text-right">
                      <button
                        onClick={() => openEdit(r)}
                        className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"
                      >
                        Edit
                      </button>
                    </Table.Td>
                  )}
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>

      {/* Edit modal — HR-only, opens when openEdit() is called */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
          onClick={closeEdit}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lift"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-100 bg-orange-50 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Edit report — {fullName(employee)}
                </h3>
                <p className="text-[11px] text-zinc-500">
                  {formatPretty(editing.date)} · {dept?.name || "—"}
                </p>
              </div>
              <button
                onClick={closeEdit}
                className="rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-800"
                aria-label="Close"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
              {empFields.map((f) => (
                <div key={f.key} className="sm:col-span-2">
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    {f.label}
                  </label>
                  <textarea
                    value={editForm[f.key] || ""}
                    onChange={(e) => setEditForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    rows={2}
                    className="mt-1 block w-full resize-y rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-stone-50 px-4 py-3">
              <button
                onClick={closeEdit}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={submit.isPending}
                className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
              >
                {submit.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- bits ---------- */

const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20";

const chipClass =
  "rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50";

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

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Stat({ label, value, small = false }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-0.5 font-semibold text-zinc-900 ${small ? "text-xs" : "text-lg"}`}>{value}</p>
    </div>
  );
}

function ActionBtn({ children, onClick, tone = "default" }) {
  const tones = {
    default: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
    dark: "bg-zinc-900 text-white hover:bg-zinc-800",
    primary: "bg-orange-600 text-white hover:bg-orange-700",
    ghost: "text-zinc-500 hover:bg-zinc-100",
  };
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </button>
  );
}

function Avatar({ name }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-orange-600 font-semibold text-white h-6 w-6 text-[9px]">
      {initials}
    </span>
  );
}

function FilterIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 4h18l-7 9v6l-4 2v-8L3 4Z" />
    </svg>
  );
}

function CloseIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function CalendarIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function tintBg(color) {
  return {
    indigo:  "bg-linear-to-br from-indigo-50 via-violet-50 to-stone-50",
    amber:   "bg-linear-to-br from-amber-50 via-orange-50 to-stone-50",
    emerald: "bg-linear-to-br from-emerald-50 via-teal-50 to-stone-50",
    rose:    "bg-linear-to-br from-rose-50 via-pink-50 to-stone-50",
    sky:     "bg-linear-to-br from-sky-50 via-cyan-50 to-stone-50",
  }[color] || "bg-linear-to-br from-stone-50 to-white";
}

function tintBorder(color) {
  return {
    indigo: "border-indigo-100", amber: "border-amber-100", emerald: "border-emerald-100",
    rose: "border-rose-100", sky: "border-sky-100",
  }[color] || "border-zinc-200";
}

function dotBg(color) {
  return {
    indigo: "bg-indigo-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
    rose: "bg-rose-500",
    sky: "bg-sky-500",
  }[color] || "bg-zinc-400";
}

function badgeBg(color) {
  return {
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-800",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    sky: "bg-sky-50 text-sky-700",
  }[color] || "bg-zinc-100 text-zinc-700";
}
