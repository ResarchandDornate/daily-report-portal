"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { formatPretty, fullName, todayISO } from "@/lib/data";
import {
  useDeleteDepartment,
  useDepartments,
  useEmployees,
  useMe,
  useReports,
  useUpdateDepartment,
} from "@/lib/queries";
import { Table } from "@/components/Table";

export default function DepartmentPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.deptId; // route param now carries the slug

  const { data: me } = useMe();
  const isHR = me?.role === "hr";
  const { data: departments = [], isLoading: deptsLoading } = useDepartments();
  const dept = departments.find((d) => d.slug === slug);

  const { data: employees = [] } = useEmployees({ department: slug });
  const { data: reports = [] } = useReports({ department: slug });

  const [query, setQuery] = useState("");
  const [editingDept, setEditingDept] = useState(false);
  // Which employee row is expanded inline.  null = none.  Click the row to
  // toggle; clicking the Name link or View button still navigates to the
  // full employee page instead of expanding (those stop propagation).
  const [expandedId, setExpandedId] = useState(null);
  const updateDept = useUpdateDepartment();
  const deleteDept = useDeleteDepartment();
  const today = todayISO();
  // HR can pick a date RANGE (from → to) to scope the "Submitted" column
  // and subtitle.  Defaults to today→today (single-day behaviour).
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  // If the user reverses the range, normalise it on the fly so downstream
  // comparisons are sane.
  const rangeStart = dateFrom <= dateTo ? dateFrom : dateTo;
  const rangeEnd   = dateFrom <= dateTo ? dateTo   : dateFrom;
  const isSingleDay = rangeStart === rangeEnd;
  const isTodayOnly = isSingleDay && rangeStart === today;

  // "This Week" column was replaced by the range-scoped counters; the
  // weekly badge helpers are no longer needed on this page.

  // Sales-only extra column.  Look up the report field whose label is the
  // "meetings" counter so we can sum it per employee.
  const isSales = slug === "sales";
  const meetingsField = useMemo(() => {
    if (!isSales || !dept?.report_fields) return null;
    return (
      dept.report_fields.find((f) =>
        /\bmeeting/i.test(f.label || f.key || ""),
      ) || null
    );
  }, [isSales, dept]);
  // Extract every number from a free-text cell (handles "4, 2", "3 meetings",
  // "Monthly Sales- 12,300", etc.), skipping years (1900-2100) and ordinals.
  function extractMeetingCount(s) {
    if (s == null) return 0;
    const text = String(s).replace(/\d{4}-\d{2}-\d{2}\s*[:\-]?\s*/g, " ");
    let total = 0;
    const re = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(st|nd|rd|th)\b)?/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[2]) continue;
      const n = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(n)) continue;
      if (Number.isInteger(n) && n >= 1900 && n <= 2100) continue;
      total += n;
    }
    return total;
  }

  // Working-day counters are now scoped to the SELECTED range instead of
  // the current calendar month.  "Elapsed" is capped at today so a range
  // that spills into the future doesn't inflate the missing count.
  function countWeekdays(startISO, endISO) {
    if (!startISO || !endISO || startISO > endISO) return 0;
    let count = 0;
    const d = new Date(startISO + "T00:00:00");
    const end = new Date(endISO + "T00:00:00");
    while (d <= end) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }
  // Full Mon-Fri count across the selected range (e.g. 22 for June 2026).
  const rangeWorkdays = useMemo(
    () => countWeekdays(rangeStart, rangeEnd),
    [rangeStart, rangeEnd],
  );
  // "Elapsed" portion of the range — start → min(rangeEnd, today).  For a
  // range fully in the past this equals rangeWorkdays; for a range that
  // extends into the future it's capped at today so "missing" doesn't
  // penalise days that haven't happened yet.
  const elapsedEnd = rangeEnd < today ? rangeEnd : today;
  const rangeWorkdaysElapsed = useMemo(
    () => (elapsedEnd < rangeStart ? 0 : countWeekdays(rangeStart, elapsedEnd)),
    [rangeStart, elapsedEnd],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees
      .map((emp) => {
        const empReports = reports.filter((r) => r.user_id === emp.id);
        const last = [...empReports].sort((a, b) => b.date.localeCompare(a.date))[0];
        // "Submitted" status is whether the employee filed at least one
        // report within the selected from → to range.
        const submittedToday = empReports.some(
          (r) => r.date >= rangeStart && r.date <= rangeEnd,
        );
        // Working-days / missing counters scoped to the SELECTED range.
        // Missing = elapsed workdays inside the range that the employee
        // didn't file for (weekend rows don't count either way — reports
        // filed on Sat/Sun are still counted as "filed", but the
        // denominator only tracks Mon-Fri).
        const rangeSubmitted = empReports.filter(
          (r) => r.date >= rangeStart && r.date <= rangeEnd,
        ).length;
        const rangeMissing = Math.max(0, rangeWorkdaysElapsed - rangeSubmitted);
        // Sum meeting numbers across this employee's reports (Sales only).
        let meetingsCount = 0;
        if (meetingsField) {
          for (const r of empReports) {
            meetingsCount += extractMeetingCount(r.data?.[meetingsField.key]);
          }
        }
        return {
          emp,
          totalReports: empReports.length,
          lastDate: last?.date || null,
          submittedToday,
          rangeSubmitted,
          rangeMissing,
          meetingsCount,
        };
      })
      .filter(({ emp }) => {
        if (!q) return true;
        return (
          fullName(emp).toLowerCase().includes(q) ||
          (emp.email || "").toLowerCase().includes(q)
        );
      });
  }, [employees, reports, rangeStart, rangeEnd, query, rangeWorkdaysElapsed, meetingsField]);

  if (deptsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-600 border-t-transparent" />
      </div>
    );
  }

  if (!dept) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900">
        <h2 className="text-sm font-semibold">Department not found</h2>
        <p className="mt-1 text-xs">
          The department <code className="rounded bg-rose-100 px-1">{slug}</code> does not exist.
        </p>
      </div>
    );
  }

  const submittedCount = rows.filter((r) => r.submittedToday).length;

  return (
    <div className="space-y-4">
      <header className={`relative overflow-hidden rounded-lg border ${tintBorder(dept.color)} ${tintBg(dept.color)} px-4 py-2.5 shadow-soft`}>
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${tintBadgeRing(dept.color)} ${tintBadgeText(dept.color)}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${dotBg(dept.color)}`} />
              Department
            </span>
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight text-zinc-900">{dept.name}</h1>
              <p className="text-[11px] text-zinc-600">
                {employees.length} {employees.length === 1 ? "employee" : "employees"} •{" "}
                <span className="font-medium text-emerald-700">
                  {submittedCount} submitted{" "}
                  {isTodayOnly
                    ? "today"
                    : isSingleDay
                    ? `on ${formatPretty(rangeStart)}`
                    : `between ${formatPretty(rangeStart)} → ${formatPretty(rangeEnd)}`}
                </span>
              </p>
            </div>
          </div>
          {isHR && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditingDept(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <PencilIcon className="h-3.5 w-3.5" />
                Edit department
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Search + date filter */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${dept.name}…`}
            className="block w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-8 pr-2.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="dept-date-from" className="text-[11px] font-medium text-zinc-600">
            From
          </label>
          <input
            id="dept-date-from"
            type="date"
            value={dateFrom}
            max={today}
            onChange={(e) => setDateFrom(e.target.value || today)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
          <label htmlFor="dept-date-to" className="text-[11px] font-medium text-zinc-600">
            To
          </label>
          <input
            id="dept-date-to"
            type="date"
            value={dateTo}
            max={today}
            min={dateFrom}
            onChange={(e) => setDateTo(e.target.value || today)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
          {!isTodayOnly && (
            <button
              type="button"
              onClick={() => {
                setDateFrom(today);
                setDateTo(today);
              }}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <Table maxHeight={520}>
        <Table.Head>
          <Table.Row>
            <Table.Th className="w-12 text-center">#</Table.Th>
            <Table.Th>Employee</Table.Th>
            <Table.Th className="whitespace-nowrap text-center" title="Filed / working days in the selected range">
              Working Days
            </Table.Th>
            {meetingsField && (
              <Table.Th className="whitespace-nowrap text-center" title={`Sum of "${meetingsField.label}" across all reports`}>
                Meetings
              </Table.Th>
            )}
            <Table.Th>Email</Table.Th>
            <Table.Th className="whitespace-nowrap">
              {isTodayOnly
                ? "Today"
                : isSingleDay
                ? formatPretty(rangeStart)
                : `${formatPretty(rangeStart)} → ${formatPretty(rangeEnd)}`}
            </Table.Th>
            <Table.Th>Total Reports</Table.Th>
            <Table.Th>Last Submission</Table.Th>
            <Table.Th />
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {rows.length === 0 ? (
            <Table.Empty
              colSpan={meetingsField ? 9 : 8}
              message={query ? "No employees match your search." : "No employees in this department."}
            />
          ) : (
            rows.flatMap(({ emp, totalReports, lastDate, submittedToday, rangeSubmitted, rangeMissing, meetingsCount }, i) => {
              const isExpanded = expandedId === emp.id;
              // Column count dropped by 1 after removing the "This Week" column.
              const colCount = meetingsField ? 9 : 8;
              const empReports = reports
                .filter((r) => r.user_id === emp.id)
                .sort((a, b) => b.date.localeCompare(a.date));
              const summaryRow = (
                <Table.Row
                  key={emp.id}
                  onClick={() => setExpandedId((prev) => (prev === emp.id ? null : emp.id))}
                  className={`cursor-pointer transition-colors ${isExpanded ? "bg-orange-50/40" : "hover:bg-zinc-50"}`}
                >
                  <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                  <Table.Td className="align-top">
                    <span className="flex items-center gap-2 text-zinc-900">
                      <Avatar name={fullName(emp)} />
                      <span className="text-xs font-medium">{fullName(emp)}</span>
                    </span>
                  </Table.Td>
                  <Table.Td className="align-top text-center" title={`${rangeSubmitted} filed of ${rangeWorkdays} working days in range (${rangeMissing} missed)`}>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-700 ring-1 ring-zinc-200">
                      <span className={rangeSubmitted > 0 ? "text-emerald-700" : "text-zinc-900"}>{rangeSubmitted}</span>
                      <span className="text-zinc-400">/</span>
                      <span className="text-zinc-900">{rangeWorkdays}</span>
                    </span>
                  </Table.Td>
                  {meetingsField && (
                    <Table.Td className="align-top text-center font-medium tabular-nums text-zinc-800">
                      {Number.isInteger(meetingsCount) ? meetingsCount : meetingsCount.toFixed(1)}
                    </Table.Td>
                  )}
                  <Table.Td className="align-top text-zinc-600">{emp.email}</Table.Td>
                  <Table.Td className="align-top">
                    {submittedToday ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        <CheckIcon className="h-2.5 w-2.5" /> Submitted
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                        Pending
                      </span>
                    )}
                  </Table.Td>
                  <Table.Td className="align-top font-medium text-zinc-800">{totalReports}</Table.Td>
                  <Table.Td className="align-top text-zinc-700">
                    {lastDate ? formatPretty(lastDate) : "—"}
                  </Table.Td>
                  <Table.Td className="align-top text-right">
                    <Link
                      href={`/dashboard/employee/${emp.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600 hover:text-orange-700"
                    >
                      View →
                    </Link>
                  </Table.Td>
                </Table.Row>
              );
              if (!isExpanded) return [summaryRow];
              return [
                summaryRow,
                <Table.Row key={`${emp.id}-expanded`}>
                  <Table.Td colSpan={colCount} className="bg-orange-50/30 p-0">
                    <ExpandedEmployeeReports
                      emp={emp}
                      reports={empReports}
                      reportFields={dept.report_fields || []}
                    />
                  </Table.Td>
                </Table.Row>,
              ];
            })
          )}
        </Table.Body>
      </Table>

      {editingDept && (
        <EditDepartmentModal
          dept={dept}
          onClose={() => setEditingDept(false)}
          onSave={async (patch) => {
            try {
              await updateDept.mutateAsync({ slug: dept.slug, ...patch });
              setEditingDept(false);
            } catch {}
          }}
          onDelete={async () => {
            if (employees.length > 0) {
              alert("Move all employees out of this department before deleting it.");
              return;
            }
            if (!confirm(`Delete department "${dept.name}"? This cannot be undone.`)) return;
            try {
              await deleteDept.mutateAsync(dept.slug);
              router.push("/dashboard");
            } catch {}
          }}
          pending={updateDept.isPending || deleteDept.isPending}
          canDelete={employees.length === 0}
        />
      )}
    </div>
  );
}

/* ---------- bits ---------- */

function EditDepartmentModal({ dept, onClose, onSave, onDelete, pending, canDelete }) {
  const [name, setName] = useState(dept?.name || "");
  const [color, setColor] = useState(dept?.color || "zinc");
  const [fields, setFields] = useState(() =>
    (dept?.report_fields || []).map((f) => ({ key: f.key, label: f.label })),
  );

  function updateField(i, k, v) {
    setFields((arr) => arr.map((f, idx) => (idx === i ? { ...f, [k]: v } : f)));
  }
  function addField() {
    setFields((arr) => [...arr, { key: "", label: "" }]);
  }
  function removeField(i) {
    setFields((arr) => arr.filter((_, idx) => idx !== i));
  }

  function save(e) {
    e.preventDefault();
    const cleaned = fields
      .map((f) => ({ key: (f.key || "").trim(), label: (f.label || "").trim() }))
      .filter((f) => f.key && f.label);
    onSave({ name: name.trim(), color, report_fields: cleaned });
  }

  const colors = ["indigo", "amber", "emerald", "rose", "sky", "zinc"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-orange-50 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-700">Edit department</p>
            <h2 className="mt-0.5 text-base font-semibold text-zinc-900">{dept.name}</h2>
            <p className="text-[11px] text-zinc-600">Slug <code className="rounded bg-zinc-100 px-1 font-mono">{dept.slug}</code> is fixed.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-900">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto px-4 py-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Name</label>
              <input className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Color</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${color === c ? "border-zinc-900 bg-zinc-50 text-zinc-900" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${dotBg(c)}`} />
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Report fields</label>
              <button type="button" onClick={addField} className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50">
                + Add field
              </button>
            </div>
            <p className="mt-1 text-[10px] text-zinc-500">Order here is the order shown in the daily report form and tables.</p>
            <div className="mt-1.5 space-y-1.5">
              {fields.length === 0 && (
                <p className="rounded-md border border-dashed border-zinc-200 px-3 py-3 text-[11px] text-zinc-500">No fields yet — click "Add field" to create one.</p>
              )}
              {fields.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-5 text-center text-[10px] font-semibold text-zinc-400">{i + 1}</span>
                  <input
                    className="block w-1/3 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] outline-none focus:border-orange-500"
                    value={f.key}
                    onChange={(e) => updateField(i, "key", e.target.value)}
                    placeholder="fieldKey"
                  />
                  <input
                    className="block flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] outline-none focus:border-orange-500"
                    value={f.label}
                    onChange={(e) => updateField(i, "label", e.target.value)}
                    placeholder="Field label shown in UI"
                  />
                  <button type="button" onClick={() => removeField(i)} className="rounded-md p-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove field">
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-3">
          <button
            type="button"
            onClick={onDelete}
            disabled={pending || !canDelete}
            title={canDelete ? "Delete department" : "Move employees out first"}
            className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete department
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100">Cancel</button>
            <button type="submit" disabled={pending || !name.trim()} className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function PencilIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CloseIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 6l12 12M6 18 18 6" />
    </svg>
  );
}


function Avatar({ name }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-600 text-[9px] font-semibold text-white">
      {initials}
    </span>
  );
}

function SearchIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L9 11.6l6.3-6.3a1 1 0 0 1 1.4 0Z" />
    </svg>
  );
}

function ExpandedEmployeeReports({ emp, reports, reportFields }) {
  if (!reports.length) {
    return (
      <div className="border-t border-orange-100 px-4 py-3 text-[12px] text-zinc-500">
        No daily reports submitted by {fullName(emp)} yet.
      </div>
    );
  }
  // Show every field column the department has plus a leading Date column.
  // Long text values wrap; empty values render as a muted em-dash.
  const cols = reportFields.length ? reportFields : [{ key: "summary", label: "Summary" }];
  return (
    <div className="border-t border-orange-100 px-3 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
          {fullName(emp)}&apos;s daily reports
          <span className="ml-1.5 text-zinc-400">({reports.length})</span>
        </p>
      </div>
      <div className="max-h-80 overflow-auto rounded-md border border-zinc-200 bg-white">
        <table className="min-w-full divide-y divide-zinc-100 text-[11px]">
          <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[inset_0_-1px_0_0_var(--color-zinc-200)]">
            <tr>
              <th className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide text-zinc-600">
                Date
              </th>
              {cols.map((f) => (
                <th
                  key={f.key}
                  className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide text-zinc-600"
                >
                  {f.label || f.key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {reports.map((r) => {
              // Leave rows collapse all field columns into a single red
              // "Absent" cell so HR isn't reading the same "On Leave"
              // repeated across Task / Work Progress / Priorities.
              const isLeave = r.data?.__leave__ === "1";
              return (
                <tr key={r.id || r.date} className="align-top">
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-zinc-800">
                    {formatPretty(r.date)}
                  </td>
                  {isLeave ? (
                    <td colSpan={cols.length} className="px-2.5 py-1.5">
                      <span className="font-bold text-rose-600">Absent</span>
                    </td>
                  ) : (
                    cols.map((f) => {
                      const v = (r.data || {})[f.key];
                      const s = v == null ? "" : String(v).trim();
                      return (
                        <td
                          key={f.key}
                          className={`px-2.5 py-1.5 ${s ? "text-zinc-800" : "text-zinc-300"}`}
                        >
                          {s || "—"}
                        </td>
                      );
                    })
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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

function tintBadgeText(color) {
  return {
    indigo: "text-indigo-700", amber: "text-amber-800", emerald: "text-emerald-700",
    rose: "text-rose-700", sky: "text-sky-700",
  }[color] || "text-zinc-700";
}

function tintBadgeRing(color) {
  return {
    indigo: "ring-indigo-200", amber: "ring-amber-200", emerald: "ring-emerald-200",
    rose: "ring-rose-200", sky: "ring-sky-200",
  }[color] || "ring-zinc-200";
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
