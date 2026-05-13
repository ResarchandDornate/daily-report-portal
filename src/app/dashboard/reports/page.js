"use client";

import { useEffect, useMemo, useState } from "react";
import {
  downloadFile,
  formatPretty,
  fullName,
  getReportFields,
  indexById,
  indexBySlug,
  reportsToCSV,
  shiftDays,
  todayISO,
} from "@/lib/data";
import { useDepartments, useEmployees, useReports } from "@/lib/queries";
import { Table } from "@/components/Table";

export default function ReportsPage() {
  const [dept, setDept] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [start, setStart] = useState(shiftDays(todayISO(), -13));
  const [end, setEnd] = useState(todayISO());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedReport, setSelectedReport] = useState(null);

  // Reset to page 1 whenever any filter changes — otherwise a narrow filter
  // could leave the user on a page that no longer exists.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [dept, employeeId, start, end, pageSize]);

  const { data: departments = [] } = useDepartments();
  const { data: allEmployees = [] } = useEmployees();
  const reportFilters = useMemo(
    () => ({
      start,
      end,
      ...(dept !== "all" && { department: dept }),
      ...(employeeId !== "all" && { employee: Number(employeeId) }),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [start, end, dept, employeeId, page, pageSize],
  );
  const { data: reports = [], total = 0, isFetching } = useReports(reportFilters);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const employeesById = useMemo(() => indexById(allEmployees), [allEmployees]);
  const deptsBySlug = useMemo(() => indexBySlug(departments), [departments]);

  const employeeOptions = useMemo(
    () => (dept === "all" ? allEmployees : allEmployees.filter((e) => e.department?.slug === dept)),
    [dept, allEmployees]
  );

  useEffect(() => {
    if (employeeId !== "all" && !employeeOptions.some((e) => String(e.id) === String(employeeId))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEmployeeId("all");
    }
  }, [employeeOptions, employeeId]);

  // Server-side pagination means `reports` is already just the current page.
  // The search box now filters the current page only (visible-rows filter).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => {
      const emp = employeesById[r.user_id];
      const blob = [
        emp ? fullName(emp) : "",
        emp?.title || "",
        ...Object.values(r.data || {}),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [reports, query, employeesById]);

  const visibleRows = filtered;

  function exportCSV() {
    const csv = reportsToCSV(reports, { usersById: employeesById });
    const filename = `daily-reports_${start}_to_${end}_p${page}.csv`;
    downloadFile(filename, csv, "text/csv");
  }

  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-700 ring-1 ring-orange-200">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              Reports
            </span>
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight text-zinc-900">All Daily Reports</h1>
              <p className="text-[11px] text-zinc-600">Browse and filter every employee&rsquo;s daily report.</p>
            </div>
          </div>
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-orange-700 disabled:opacity-50"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            Export CSV ({filtered.length})
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="rounded-lg border border-zinc-200 surface-tinted p-3">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <FilterField label="Department">
            <select value={dept} onChange={(e) => setDept(e.target.value)} className={inputClass}>
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d.slug} value={d.slug}>{d.name}</option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Employee">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass}>
              <option value="all">All employees</option>
              {employeeOptions.map((e) => (
                <option key={e.id} value={e.id}>{fullName(e)}</option>
              ))}
            </select>
          </FilterField>

          <FilterField label="From">
            <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          </FilterField>

          <FilterField label="To">
            <input type="date" value={end} min={start} max={todayISO()} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
          </FilterField>

          <FilterField label="Search">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any field…"
              className={inputClass}
            />
          </FilterField>
        </div>
      </div>

      {/* Pagination summary + size selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-600">
        <div>
          {total === 0 ? (
            "No reports match the current filters."
          ) : (
            <>
              Showing <span className="font-medium text-zinc-900">{firstRow}–{lastRow}</span> of{" "}
              <span className="font-medium text-zinc-900">{total}</span> reports
              {isFetching && <span className="ml-2 text-zinc-400">loading…</span>}
            </>
          )}
        </div>
        <label className="flex items-center gap-1.5">
          <span className="text-zinc-500">Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] outline-none focus:border-orange-500"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>
      </div>

      {/* Table */}
      {dept === "all" ? (
        <Table maxHeight={520}>
          <Table.Head>
            <Table.Row>
              <Table.Th className="w-12 text-center">#</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th>Employee</Table.Th>
              <Table.Th>Department</Table.Th>
              <Table.Th>Summary</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {filtered.length === 0 ? (
              <Table.Empty colSpan={5} message="No reports match the current filters." />
            ) : (
              visibleRows.map((r, i) => {
                const emp = employeesById[r.user_id];
                const d = emp?.department;
                const fields = emp ? getReportFields(emp.department) : [];
                const summary = fields
                  .map((f) => (r.data?.[f.key] ? `${f.label}: ${r.data[f.key]}` : null))
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("  ·  ") || "—";
                return (
                  <Table.Row
                    key={r.id}
                    onClick={() => setSelectedReport(r)}
                    className="cursor-pointer"
                  >
                    <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                    <Table.Td className="whitespace-nowrap align-top font-medium text-zinc-800">
                      {formatPretty(r.date)}
                    </Table.Td>
                    <Table.Td className="align-top">
                      <div className="text-xs font-medium text-zinc-900">{emp ? fullName(emp) : `User #${r.user_id}`}</div>
                      <div className="text-[10px] text-zinc-500">{emp?.title || ""}</div>
                    </Table.Td>
                    <Table.Td className="align-top">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${badgeBg(d?.color)}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${dotBg(d?.color)}`} />
                        {d?.name || "—"}
                      </span>
                    </Table.Td>
                    <Table.Td className="align-top text-zinc-700">{summary}</Table.Td>
                  </Table.Row>
                );
              })
            )}
          </Table.Body>
        </Table>
      ) : (
        (() => {
          const deptObj = deptsBySlug[dept];
          const deptFields = getReportFields(deptObj);
          return (
            <Table maxHeight={520}>
              <Table.Head>
                <Table.Row>
                  <Table.Th className="w-12 text-center">#</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Employee</Table.Th>
                  {deptFields.map((f) => (
                    <Table.Th key={f.key}>{f.label}</Table.Th>
                  ))}
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {filtered.length === 0 ? (
                  <Table.Empty colSpan={3 + deptFields.length} message="No reports match the current filters." />
                ) : (
                  visibleRows.map((r, i) => {
                    const emp = employeesById[r.user_id];
                    return (
                      <Table.Row
                        key={r.id}
                        onClick={() => setSelectedReport(r)}
                        className="cursor-pointer"
                      >
                        <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                        <Table.Td className="whitespace-nowrap align-top font-medium text-zinc-800">
                          {formatPretty(r.date)}
                        </Table.Td>
                        <Table.Td className="align-top">
                          <div className="text-xs font-medium text-zinc-900">{emp ? fullName(emp) : `User #${r.user_id}`}</div>
                          <div className="text-[10px] text-zinc-500">{emp?.title || ""}</div>
                        </Table.Td>
                        {deptFields.map((f) => (
                          <Table.Td key={f.key} className="align-top text-zinc-700">{r.data?.[f.key] || "—"}</Table.Td>
                        ))}
                      </Table.Row>
                    );
                  })
                )}
              </Table.Body>
            </Table>
          );
        })()
      )}

      {/* Report detail modal */}
      {selectedReport && (
        <ReportDetailModal
          report={selectedReport}
          employee={employeesById[selectedReport.user_id]}
          onClose={() => setSelectedReport(null)}
        />
      )}

      {/* Pagination controls */}
      {total > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2">
          <p className="text-[11px] text-zinc-600">
            Page <span className="font-medium text-zinc-900">{page}</span> of{" "}
            <span className="font-medium text-zinc-900">{totalPages}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <PagerBtn onClick={() => setPage(1)} disabled={page === 1}>« First</PagerBtn>
            <PagerBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹ Prev</PagerBtn>
            <PagerBtn onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next ›</PagerBtn>
            <PagerBtn onClick={() => setPage(totalPages)} disabled={page >= totalPages}>Last »</PagerBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportDetailModal({ report, employee, onClose }) {
  const dept = employee?.department;
  const fields = getReportFields(dept);
  const submitted = report.submitted_at ? new Date(report.submitted_at) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-700">
              Daily Report · {formatPretty(report.date)}
            </p>
            <h2 className="mt-0.5 truncate text-base font-semibold text-zinc-900">
              {employee ? fullName(employee) : `User #${report.user_id}`}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
              {dept && (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 ${badgeBg(dept.color)}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${dotBg(dept.color)}`} />
                  {dept.name}
                </span>
              )}
              {employee?.title && <span>· {employee.title}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-900"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18 18 6" />
            </svg>
          </button>
        </div>

        {/* Body — summary text, label + value per line, no cards */}
        <div className="flex-1 overflow-auto bg-white px-5 py-4">
          {fields.length === 0 ? (
            <p className="text-xs text-zinc-500">No report fields defined for this department.</p>
          ) : (
            <p className="text-[13px] leading-7 text-zinc-800">
              {fields.map((f) => {
                const val = report.data?.[f.key];
                const display = (typeof val === "string" && val.trim()) ? val : "—";
                return (
                  <span key={f.key} className="block">
                    <span className="font-semibold text-zinc-900">{f.label}:</span>{" "}
                    <span className="whitespace-pre-wrap text-zinc-700">{display}</span>
                  </span>
                );
              })}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-white px-4 py-2.5">
          <p className="text-[11px] text-zinc-500">
            {submitted ? `Submitted ${submitted.toLocaleString("en-IN")}` : "—"}
          </p>
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function PagerBtn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20";

function FilterField({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
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
