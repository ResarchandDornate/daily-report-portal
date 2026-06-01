"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  formatPretty,
  formatPrettyWithDay,
  fullName,
  getReportFields,
  indexById,
  indexBySlug,
  shiftDays,
  todayISO,
} from "@/lib/data";
import { api } from "@/lib/api";
import { useDepartments, useEmployees, useReports } from "@/lib/queries";
import { Table } from "@/components/Table";

// Departments excluded from the compliance summary strip at the top of this
// page — they don't track daily reports, so HR doesn't need to monitor them
// there.  Employees with no department are also dropped from the summary.
// (They still appear normally in the table below and everywhere else.)
const HIDDEN_FROM_COMPLIANCE = new Set(["support", "rd", "finance"]);

export default function ReportsPage() {
  const [dept, setDept] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [start, setStart] = useState(shiftDays(todayISO(), -13));
  const [end, setEnd] = useState(todayISO());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedReport, setSelectedReport] = useState(null);
  const [drillDownDept, setDrillDownDept] = useState(null);  // dept slug being expanded
  // Client-side sort over the current page.
  // Cycle on each click: ascending → descending → cleared (back to default).
  // When sortKey is null, rows use the server's natural order (date desc).
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  function toggleSort(key) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    // Third click on same column → clear sort, revert to natural order.
    setSortKey(null);
    setSortDir("asc");
  }

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

  // Separate, unpaginated query JUST for the compliance summary strip —
  // we need every report in the date/dept window to count distinct submitters
  // per department, not only the current page's 50 rows.
  const summaryFilters = useMemo(
    () => ({
      start,
      end,
      ...(dept !== "all" && { department: dept }),
      ...(employeeId !== "all" && { employee: Number(employeeId) }),
      limit: 5000,
    }),
    [start, end, dept, employeeId],
  );
  const { data: summaryReports = [] } = useReports(summaryFilters);

  const employeesById = useMemo(() => indexById(allEmployees), [allEmployees]);
  const deptsBySlug = useMemo(() => indexBySlug(departments), [departments]);

  // Compliance summary — for each department in scope, how many people
  // submitted at least one report in the current date / dept / employee filter.
  // Departments listed in HIDDEN_FROM_COMPLIANCE don't track daily reports,
  // so we exclude them from both the chip grid AND the overall headline.
  const deptSummary = useMemo(() => {
    const submitters = new Set(summaryReports.map((r) => r.user_id));
    const inScope = allEmployees.filter((e) => {
      if (e.is_active === false) return false;
      if (dept !== "all" && e.department?.slug !== dept) return false;
      if (employeeId !== "all" && String(e.id) !== String(employeeId)) return false;
      // Drop departments that don't participate in daily report tracking
      // (and employees with no department assigned).
      const slug = e.department?.slug;
      if (!slug) return false;
      if (HIDDEN_FROM_COMPLIANCE.has(slug)) return false;
      return true;
    });
    const byDept = {};
    for (const emp of inScope) {
      const d = emp.department;
      const slug = d?.slug || "—";
      if (!byDept[slug]) {
        byDept[slug] = {
          slug,
          name: d?.name || "No department",
          color: d?.color || "zinc",
          total: 0,
          submitted: 0,
        };
      }
      byDept[slug].total += 1;
      if (submitters.has(emp.id)) byDept[slug].submitted += 1;
    }
    return Object.values(byDept).sort((a, b) => {
      const aPct = a.total ? a.submitted / a.total : -1;
      const bPct = b.total ? b.submitted / b.total : -1;
      if (bPct !== aPct) return bPct - aPct;
      if (b.submitted !== a.submitted) return b.submitted - a.submitted;
      return a.name.localeCompare(b.name);
    });
  }, [allEmployees, summaryReports, dept, employeeId]);

  const overallSummary = useMemo(() => {
    const total = deptSummary.reduce((s, d) => s + d.total, 0);
    const submitted = deptSummary.reduce((s, d) => s + d.submitted, 0);
    const pct = total ? Math.round((submitted / total) * 100) : 0;
    return { total, submitted, pct, missing: total - submitted };
  }, [deptSummary]);

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

  // Apply client-side sort over the current page's rows.  Numeric values are
  // detected and sorted as numbers; everything else falls back to a
  // case-insensitive string compare.  When sortKey is null (third click on
  // the same column), we leave the rows in the server's natural order
  // (date desc, user_id asc).
  const sortedRows = useMemo(() => {
    if (!sortKey) return filtered;
    const rows = [...filtered];
    rows.sort((a, b) => {
      let av;
      let bv;
      if (sortKey === "date") {
        av = a.date;
        bv = b.date;
      } else if (sortKey === "employee") {
        av = (employeesById[a.user_id] ? fullName(employeesById[a.user_id]) : "").toLowerCase();
        bv = (employeesById[b.user_id] ? fullName(employeesById[b.user_id]) : "").toLowerCase();
      } else if (sortKey === "department") {
        av = (employeesById[a.user_id]?.department?.name || "").toLowerCase();
        bv = (employeesById[b.user_id]?.department?.name || "").toLowerCase();
      } else {
        // Report-field column — try numeric (stripping ₹, commas, spaces);
        // fall back to lowercase string.
        const sa = String(a.data?.[sortKey] ?? "").trim();
        const sb = String(b.data?.[sortKey] ?? "").trim();
        const na = Number(sa.replace(/[₹,\s]/g, ""));
        const nb = Number(sb.replace(/[₹,\s]/g, ""));
        const bothNumeric =
          sa !== "" && sb !== "" && Number.isFinite(na) && Number.isFinite(nb);
        if (bothNumeric) {
          av = na;
          bv = nb;
        } else {
          // Empty cells go to the bottom regardless of sort direction.
          if (sa === "" && sb !== "") return 1;
          if (sa !== "" && sb === "") return -1;
          av = sa.toLowerCase();
          bv = sb.toLowerCase();
        }
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [filtered, sortKey, sortDir, employeesById]);

  const visibleRows = sortedRows;

  const [exporting, setExporting] = useState(false);
  async function exportExcel() {
    // Multi-sheet XLSX: Sales — Detail + Inside Sales — Detail + Detailed Summary.
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      if (dept !== "all") params.set("department", dept);
      if (employeeId !== "all") params.set("employee", String(employeeId));
      const res = await api.get(`/api/reports/export.xlsx?${params.toString()}`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daily-reports_${start}_to_${end}.xlsx`;
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
            onClick={exportExcel}
            disabled={total === 0 || exporting}
            className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-orange-700 disabled:opacity-50"
            title="Download an Excel file with one tab per department"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            {exporting ? "Preparing…" : `Export Excel (${total})`}
          </button>
        </div>
      </header>

      {/* Compliance summary — overall + per-department in this filter window */}
      <ComplianceSummary
        overall={overallSummary}
        deptStats={deptSummary}
        onPickDept={(slug) => setDrillDownDept(slug)}
      />

      {drillDownDept && (
        <DeptDrillDownModal
          slug={drillDownDept}
          deptStats={deptSummary}
          allEmployees={allEmployees}
          summaryReports={summaryReports}
          start={start}
          end={end}
          onClose={() => setDrillDownDept(null)}
        />
      )}

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
              <Table.Th className="min-w-35 whitespace-nowrap">
                <SortButton label="Date" col="date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              </Table.Th>
              <Table.Th className="min-w-50">
                <SortButton label="Employee" col="employee" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              </Table.Th>
              <Table.Th className="min-w-40">
                <SortButton label="Department" col="department" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              </Table.Th>
              <Table.Th className="min-w-70">Summary</Table.Th>
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
                      {formatPrettyWithDay(r.date)}
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
                  <Table.Th className="min-w-35 whitespace-nowrap">
                    <SortButton label="Date" col="date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  </Table.Th>
                  <Table.Th className="min-w-50">
                    <SortButton label="Employee" col="employee" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  </Table.Th>
                  {deptFields.map((f) => (
                    <Table.Th key={f.key} className="min-w-45">
                      <SortButton label={f.label} col={f.key} sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </Table.Th>
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
                          {formatPrettyWithDay(r.date)}
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

function ComplianceSummary({ overall, deptStats, onPickDept }) {
  if (overall.total === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[11px] text-zinc-500">
        No employees match the current filter — nothing to summarise.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      {/* Headline — overall stat as a clean hero line */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-100 pb-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Reports submitted in this range
          </p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-900">
            <span className="text-emerald-700">{overall.submitted}</span>
            <span className="text-zinc-300"> / </span>
            <span>{overall.total}</span>
            <span className="ml-2 text-sm font-normal text-zinc-500">people</span>
          </p>
        </div>
        {overall.missing > 0 && (
          <p className="text-[11px] font-medium text-rose-600">{overall.missing} pending</p>
        )}
      </div>

      {/* Per-department rows with thin progress bars — clean and scannable */}
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {deptStats.map((d) => (
          <DeptComplianceRow key={d.slug} d={d} onClick={() => onPickDept(d.slug)} />
        ))}
      </div>
    </div>
  );
}

function DeptComplianceRow({ d, onClick }) {
  const pct = d.total ? Math.round((d.submitted / d.total) * 100) : 0;
  const barColor =
    pct >= 100 ? "bg-emerald-500"
    : pct >= 50 ? "bg-amber-500"
    : pct > 0 ? "bg-rose-500"
    : "bg-zinc-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md px-1.5 py-1 text-left transition hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
      title={`Click to see who submitted vs missing in ${d.name}`}
    >
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1.5 truncate text-zinc-800">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotBg(d.color)}`} />
          <span className="truncate">{d.name}</span>
        </span>
        <span className="shrink-0 font-medium tabular-nums text-zinc-700">
          {d.submitted}<span className="text-zinc-400">/{d.total}</span>
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}

function DeptDrillDownModal({ slug, deptStats, allEmployees, summaryReports, start, end, onClose }) {
  const dept = deptStats.find((d) => d.slug === slug);

  // Build the employee list for this dept, splitting by "submitted at least
  // once in range" vs "not submitted at all in range".
  const { submitted, missing, reportsByUser } = useMemo(() => {
    const inDept = allEmployees.filter(
      (e) => e.is_active !== false && e.department?.slug === slug,
    );
    const map = {};
    for (const r of summaryReports) map[r.user_id] = (map[r.user_id] || []).concat(r);
    // Reports per user, newest first.
    Object.keys(map).forEach((uid) => {
      map[uid].sort((a, b) => b.date.localeCompare(a.date));
    });
    const submittedList = inDept.filter((e) => (map[e.id] || []).length > 0)
      .sort((a, b) => (map[b.id]?.length || 0) - (map[a.id]?.length || 0));
    const missingList = inDept.filter((e) => !(map[e.id] && map[e.id].length))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));
    return { submitted: submittedList, missing: missingList, reportsByUser: map };
  }, [allEmployees, summaryReports, slug]);

  const [expanded, setExpanded] = useState(null); // user_id whose reports are expanded
  function toggleExpand(uid) {
    setExpanded((cur) => (cur === uid ? null : uid));
  }

  if (!dept) return null;

  const reportFields = (() => {
    // Pull fields from any submitter (they all share the dept's report_fields).
    const anyEmp = allEmployees.find((e) => e.department?.slug === slug);
    return getReportFields(anyEmp?.department);
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-3 pb-8 pt-12" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        {/* Header — compact */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-5 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dotBg(dept.color)}`} />
              <h2 className="text-sm font-semibold text-zinc-900">{dept.name}</h2>
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-700">
              <span className="font-medium">{formatPretty(start)} → {formatPretty(end)}</span>
              <span className="mx-1.5 text-zinc-300">·</span>
              <span className="font-semibold text-emerald-700">{dept.submitted}</span> submitted
              <span className="mx-1.5 text-zinc-300">·</span>
              <span className="font-semibold text-rose-600">{dept.total - dept.submitted}</span> missing
              <span className="mx-1.5 text-zinc-300">·</span>
              <span>{dept.total} total</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-900"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18 18 6" />
            </svg>
          </button>
        </div>

        {/* Body — submitted list, then missing list */}
        <div className="flex-1 overflow-auto bg-stone-50/40">
          {submitted.length > 0 && (
            <DrillSection title="Submitted" count={submitted.length} tone="emerald">
              {submitted.map((emp) => (
                <DrillRow
                  key={emp.id}
                  emp={emp}
                  reports={reportsByUser[emp.id] || []}
                  fields={reportFields}
                  expanded={expanded === emp.id}
                  onToggle={() => toggleExpand(emp.id)}
                />
              ))}
            </DrillSection>
          )}
          {missing.length > 0 && (
            <DrillSection title="Missing" count={missing.length} tone="rose">
              {missing.map((emp) => (
                <DrillRow
                  key={emp.id}
                  emp={emp}
                  reports={[]}
                  fields={reportFields}
                  expanded={false}
                  onToggle={() => {}}
                  disabled
                />
              ))}
            </DrillSection>
          )}
        </div>
      </div>
    </div>
  );
}

function DrillSection({ title, count, tone, children }) {
  const toneCls = {
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
  }[tone] || "bg-zinc-100 text-zinc-700 ring-zinc-200";
  return (
    <section className="border-b border-zinc-200 last:border-b-0">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-200 bg-white px-5 py-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-700">{title}</h3>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${toneCls}`}>
          {count}
        </span>
      </div>
      <div>{children}</div>
    </section>
  );
}

function DrillRow({ emp, reports, fields, expanded, onToggle, disabled }) {
  return (
    <div className="border-b border-zinc-100 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-3 px-5 py-1.5 text-left transition ${
          disabled ? "cursor-default" : "hover:bg-orange-50/40"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {!disabled && (
            <span className={`text-[10px] text-zinc-400 transition-transform ${expanded ? "rotate-90" : ""}`}>
              ▸
            </span>
          )}
          <Avatar name={fullName(emp)} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[12px] font-semibold text-zinc-900">{fullName(emp)}</div>
            {emp.title && (
              <div className="truncate text-[10px] text-zinc-500">{emp.title}</div>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            disabled
              ? "bg-zinc-100 text-zinc-500"
              : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          }`}
        >
          {disabled
            ? "no reports"
            : `${reports.length} ${reports.length === 1 ? "report" : "reports"}`}
        </span>
      </button>

      {expanded && reports.length > 0 && (
        <div className="border-t border-zinc-100 bg-stone-50/60 px-5 py-2">
          <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-zinc-50 text-left text-zinc-600">
                  <th className="whitespace-nowrap border-b border-r border-zinc-200 px-2.5 py-1.5 font-semibold last:border-r-0">
                    Date
                  </th>
                  {fields.map((f) => (
                    <th
                      key={f.key}
                      className="whitespace-nowrap border-b border-r border-zinc-200 px-2.5 py-1.5 font-semibold last:border-r-0"
                    >
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="text-zinc-800 hover:bg-stone-50/60">
                    <td className="whitespace-nowrap border-b border-r border-zinc-100 px-2.5 py-1.5 font-medium text-zinc-900 last:border-r-0">
                      {formatPretty(r.date)}
                    </td>
                    {fields.map((f) => (
                      <td
                        key={f.key}
                        className="min-w-[160px] border-b border-r border-zinc-100 px-2.5 py-1.5 align-top last:border-r-0"
                      >
                        {r.data?.[f.key] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ name }) {
  const initials = (name || "—")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-600 text-[9px] font-semibold text-white">
      {initials}
    </span>
  );
}

function SortButton({ label, col, sortKey, sortDir, onClick }) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      onClick={() => onClick(col)}
      className={`inline-flex w-full items-center justify-between gap-1.5 text-left transition hover:text-orange-700 ${
        active ? "text-orange-700" : "text-zinc-700"
      }`}
      title={
        active
          ? `Sorted ${sortDir === "asc" ? "ascending" : "descending"} — click to ${sortDir === "asc" ? "switch to descending" : "clear sort"}`
          : `Click to sort by ${label}`
      }
    >
      <span>{label}</span>
      <SortIcon active={active} dir={sortDir} />
    </button>
  );
}

function SortIcon({ active, dir }) {
  // Stacked up + down arrow icon.  When the column is active, the matching
  // arrow lights up orange and the other goes very faint.  When inactive,
  // both arrows are mid-grey so the user can tell the column is sortable.
  const upActive = active && dir === "asc";
  const downActive = active && dir === "desc";
  const upColor = upActive ? "text-orange-600" : active ? "text-zinc-300" : "text-zinc-400";
  const downColor = downActive ? "text-orange-600" : active ? "text-zinc-300" : "text-zinc-400";
  return (
    <span className="inline-flex flex-col items-center leading-none">
      <svg viewBox="0 0 8 5" className={`h-1.5 w-2 ${upColor} fill-current`} aria-hidden>
        <path d="M0 5 L4 0 L8 5 Z" />
      </svg>
      <svg viewBox="0 0 8 5" className={`mt-0.5 h-1.5 w-2 ${downColor} fill-current`} aria-hidden>
        <path d="M0 0 L4 5 L8 0 Z" />
      </svg>
    </span>
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
