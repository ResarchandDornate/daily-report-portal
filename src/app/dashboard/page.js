"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  formatPretty,
  formatPrettyWithDay,
  fullName,
  getReportFields,
  indexById,
  todayISO,
} from "@/lib/data";
import {
  useDepartments,
  useEmployees,
  useMe,
  useReports,
} from "@/lib/queries";
import { Table } from "@/components/Table";

// Departments that don't track daily reports — their employees are excluded
// from the "Total Employees" headline count.  Same departments and people
// still appear everywhere else (sidebar, department detail, All Employees,
// etc.) — this is just so the top-card count reflects "reporting employees".
const NON_REPORTING_DEPTS = new Set(["rd", "finance"]);

// `useSearchParams()` inside OverviewContent bails the route out of static
// prerendering — wrap it in <Suspense> so Next.js can prerender a shell and
// stream the content in on the client.
export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewContent />
    </Suspense>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-600 border-t-transparent" />
    </div>
  );
}

function OverviewContent() {
  const searchParams = useSearchParams();
  const today = todayISO();
  // Selected date is driven by the navbar's date picker via `?date=` in the URL.
  // Defaults to today; clamped to <= today by the picker's `max` attr.
  const selectedDate = searchParams.get("date") || today;
  const isToday = selectedDate === today;
  const dateLabel = isToday ? "today" : formatPretty(selectedDate);
  const stampLabel = isToday ? "Today" : `On ${formatPretty(selectedDate)}`;

  const { data: me } = useMe();
  const isHR = me?.role === "hr";
  const [selectedReport, setSelectedReport] = useState(null);

  // For HR: fetch everything. For employees: fetch only their own reports.
  const { data: departments = [] } = useDepartments();
  const { data: employees = [] } = useEmployees();
  // Pull reports for the entire window from the selected date through today so
  // we cover both stat cards (selected-date slice) and "Recent submissions"
  // (most-recent overall) in one query.
  const reportFilters = useMemo(() => {
    const base = me && !isHR ? { employee: me.id } : {};
    // If the user picked a past date, broaden the range so we have those rows
    // cached.  Otherwise keep the default (latest 1000).
    if (!isToday) return { ...base, start: selectedDate, end: today };
    return base;
  }, [me, isHR, isToday, selectedDate, today]);
  const { data: reports = [] } = useReports(reportFilters);

  const employeesById = useMemo(() => indexById(employees), [employees]);

  const selectedDateReports = useMemo(
    () => reports.filter((r) => r.date === selectedDate),
    [reports, selectedDate]
  );

  // Only employees from reporting departments — same scope as the
  // "Total Employees" headline card.  All three stat cards (Reports /
  // Missing / On Leave) are derived from this set so the math always
  // adds up to the Total Employees count.
  const reportingEmployees = useMemo(
    () =>
      employees.filter(
        (e) =>
          e.role !== "hr" &&
          e.is_active !== false &&
          !NON_REPORTING_DEPTS.has(e.department?.slug),
      ),
    [employees],
  );
  const reportingEmployeeIds = useMemo(
    () => new Set(reportingEmployees.map((e) => e.id)),
    [reportingEmployees],
  );

  // Reports filed today, restricted to reporting-dept employees only.
  const selectedDateReportingReports = useMemo(
    () =>
      selectedDateReports.filter((r) => reportingEmployeeIds.has(r.user_id)),
    [selectedDateReports, reportingEmployeeIds],
  );

  const onLeaveCount = useMemo(
    () =>
      selectedDateReportingReports.filter((r) => r.data?.__leave__ === "1")
        .length,
    [selectedDateReportingReports]
  );

  // Compute the missing list client-side from the selected date — this lets
  // HR scrub back through prior dates and still see who didn't submit.
  // Filters to reporting-dept employees only so Reports + Missing always
  // equals Total Employees on the headline cards.
  const missing = useMemo(() => {
    const submittedIds = new Set(
      selectedDateReportingReports.map((r) => r.user_id),
    );
    return reportingEmployees.filter((e) => !submittedIds.has(e.id));
  }, [reportingEmployees, selectedDateReportingReports]);

  const deptStats = useMemo(
    () =>
      departments
        .map((d) => {
          const inDept = employees.filter((e) => e.department?.slug === d.slug);
          const submitted = inDept.filter((e) =>
            selectedDateReports.some((r) => r.user_id === e.id)
          ).length;
          const onLeave = inDept.filter((e) =>
            selectedDateReports.some(
              (r) => r.user_id === e.id && r.data?.__leave__ === "1",
            ),
          ).length;
          return {
            ...d,
            total: inDept.length,
            submitted,
            onLeave,
            missing: inDept.length - submitted,
          };
        })
        // Sort by completion PERCENTAGE descending so 100%-complete depts
        // (e.g. 4/4) float above half-done (4/2) and lower (4/1), regardless
        // of headcount.  Ties break by absolute submitted count, then total,
        // then name.  Empty departments (0 employees) are pinned to the
        // bottom because they have no work to evaluate.
        .sort((a, b) => {
          const aPct = a.total ? a.submitted / a.total : -1;
          const bPct = b.total ? b.submitted / b.total : -1;
          if (bPct !== aPct) return bPct - aPct;
          if (b.submitted !== a.submitted) return b.submitted - a.submitted;
          if (b.total !== a.total) return b.total - a.total;
          return a.name.localeCompare(b.name);
        }),
    [departments, employees, selectedDateReports]
  );

  // HR sees ALL submissions for the selected date (newest first), so they
  // can scan the day's activity without artificially capping at 8 rows.
  // Employees see ALL of their own reports across dates.
  // Counts that exclude R&D and Finance (those depts don't file daily reports).
  const reportingEmployeesCount = useMemo(
    () => employees.filter((e) => !NON_REPORTING_DEPTS.has(e.department?.slug)).length,
    [employees],
  );
  const reportingDeptsCount = useMemo(
    () => departments.filter((d) => !NON_REPORTING_DEPTS.has(d.slug)).length,
    [departments],
  );

  const recent = useMemo(
    () =>
      [...selectedDateReports].sort((a, b) => {
        // Sort by submitted_at desc so the most recently submitted report
        // is at the top; fall back to user_id for deterministic ordering.
        const ta = a.submitted_at || "";
        const tb = b.submitted_at || "";
        if (tb !== ta) return tb.localeCompare(ta);
        return a.user_id - b.user_id;
      }),
    [selectedDateReports]
  );
  const myRecent = useMemo(
    () => [...reports].sort((a, b) => b.date.localeCompare(a.date)),
    [reports]
  );

  // For employees: report-field columns are determined by their department.
  const meFields = useMemo(() => getReportFields(me?.department), [me]);

  if (!me) return null;

  return (
    <div className="space-y-5">
      {/* Stat cards — HR only */}
      {isHR && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Total Employees" value={reportingEmployeesCount} hint={`Across ${reportingDeptsCount} reporting departments`} icon="users" tone="orange" href="/dashboard/employees" />
          <StatCard label={`Reports ${stampLabel}`} value={selectedDateReportingReports.length} hint={formatPretty(selectedDate)} icon="check" tone="emerald" href="/dashboard/reports" />
          <StatCard label={`Missing ${stampLabel}`} value={missing.length} hint="Pending submissions" icon="alert" tone="rose" href="#pending-today" />
          <StatCard label={`On Leave ${stampLabel}`} value={onLeaveCount} hint="View leave log" icon="palm" tone="amber" href="/dashboard/leaves" />
          <StatCard label="Departments" value={departments.length} hint="Active teams" icon="grid" tone="zinc" href="#department-breakdown" />
        </section>
      )}

      {/* Departments + Missing — HR only */}
      {isHR && (
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div id="department-breakdown" className="scroll-mt-16 lg:col-span-2">
          <Card>
            <CardHeader title="Department breakdown" subtitle={`Submission status for ${formatPretty(selectedDate)}`} />
            <Table maxHeight={460} className="rounded-none border-0">
              <Table.Head>
                <Table.Row>
                  <Table.Th>Department</Table.Th>
                  <Table.Th className="text-center">Total Employees</Table.Th>
                  <Table.Th className="text-center">Submitted</Table.Th>
                  <Table.Th className="text-center">On Leave</Table.Th>
                  <Table.Th className="text-center">Missing</Table.Th>
                  <Table.Th className="text-center">Status</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {deptStats.length === 0 ? (
                  <Table.Empty colSpan={6} message="No departments yet." />
                ) : (
                  deptStats.map((d) => {
                    const pct = d.total ? Math.round((d.submitted / d.total) * 100) : 0;
                    const allIn = d.total > 0 && d.missing === 0;
                    return (
                      <Table.Row key={d.slug}>
                        <Table.Td>
                          <Link
                            href={`/dashboard/department/${d.slug}`}
                            className="inline-flex items-center gap-2 font-medium text-zinc-900 hover:text-orange-700"
                          >
                            <span className={`h-2 w-2 rounded-full ${dotBg(d.color)}`} />
                            {d.name}
                          </Link>
                        </Table.Td>
                        <Table.Td className="text-center font-medium text-zinc-800">{d.total}</Table.Td>
                        <Table.Td className="text-center font-medium text-emerald-600">{d.submitted}</Table.Td>
                        <Table.Td className="text-center">
                          {d.onLeave > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                              {d.onLeave}
                            </span>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </Table.Td>
                        <Table.Td className="text-center font-medium text-rose-600">{d.missing}</Table.Td>
                        <Table.Td className="text-center">
                          {allIn ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              All in · 100%
                            </span>
                          ) : d.total === 0 ? (
                            <span className="text-[10px] text-zinc-400">—</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                              {pct}% complete
                            </span>
                          )}
                        </Table.Td>
                      </Table.Row>
                    );
                  })
                )}
              </Table.Body>
            </Table>
          </Card>
        </div>

        <div id="pending-today" className="scroll-mt-16">
          <Card>
            <CardHeader
              title={isToday ? "Pending today" : `Pending on ${formatPretty(selectedDate)}`}
              subtitle="Employees who haven't submitted"
              right={
                <Link
                  href="/dashboard/reports"
                  className="text-[11px] font-medium text-orange-600 hover:text-orange-700"
                >
                  View all →
                </Link>
              }
            />
            <div className="max-h-90 overflow-y-auto p-1.5">
              {missing.length === 0 && (
                <div className="flex flex-col items-center gap-1.5 px-3 py-10 text-center">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <CheckIcon className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-medium text-zinc-700">All caught up</p>
                  <p className="text-[11px] text-zinc-500">
                    Everyone has submitted {dateLabel}.
                  </p>
                </div>
              )}
              {missing.map((emp) => (
                <Link
                  key={emp.id}
                  href={`/dashboard/employee/${emp.id}`}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition hover:bg-zinc-50"
                >
                  <Avatar name={fullName(emp)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-zinc-900">
                      {fullName(emp)}
                    </p>
                    <p className="truncate text-[11px] text-zinc-500">
                      {emp.department?.name || "—"} • {emp.title || ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700">
                    Pending
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </section>
      )}

      {/* Recent submissions — HR sees company-wide, employees see their own
          with department-specific report-field columns. */}
      <Card>
        <CardHeader
          title={isHR ? `Submissions for ${formatPretty(selectedDate)}` : "My recent submissions"}
          subtitle={
            isHR
              ? `${recent.length} ${recent.length === 1 ? "report" : "reports"} submitted ${isToday ? "today" : `on ${formatPretty(selectedDate)}`}`
              : `Your ${myRecent.length} daily report${myRecent.length === 1 ? "" : "s"}${me.department ? ` — ${me.department.name}` : ""}`
          }
          right={
            isHR && (
              <Link
                href="/dashboard/summary"
                className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-orange-700"
              >
                Generate summary
                <ArrowIcon className="h-3 w-3" />
              </Link>
            )
          }
        />
        {isHR ? (
          <Table maxHeight={360} className="rounded-none border-0">
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
              {recent.length === 0 ? (
                <Table.Empty colSpan={5} message="No reports yet." />
              ) : (
                recent.map((r, i) => {
                  const emp = employeesById[r.user_id];
                  const dept = emp?.department;
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
                      <Table.Td className="text-center font-medium text-zinc-500">{i + 1}</Table.Td>
                      <Table.Td className="whitespace-nowrap font-medium text-zinc-800">
                        {formatPrettyWithDay(r.date)}
                      </Table.Td>
                      <Table.Td>
                        <div className="flex items-center gap-2">
                          <Avatar name={emp ? fullName(emp) : "—"} />
                          <span className="font-medium text-zinc-900">
                            {emp ? fullName(emp) : `User #${r.user_id}`}
                          </span>
                        </div>
                      </Table.Td>
                      <Table.Td>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badgeBg(dept?.color)}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${dotBg(dept?.color)}`} />
                          {dept?.name || "—"}
                        </span>
                      </Table.Td>
                      <Table.Td className="max-w-md truncate text-zinc-600">{summary}</Table.Td>
                    </Table.Row>
                  );
                })
              )}
            </Table.Body>
          </Table>
        ) : (
          /* Employee view — department-specific columns matching the My Daily Report form.
             maxHeight="none": let every row render and the page scroll naturally,
             so a single tall row can't push earlier rows out of the viewport. */
          <Table maxHeight="none" className="rounded-none border-0">
            <Table.Head>
              <Table.Row>
                <Table.Th className="w-12 text-center">#</Table.Th>
                <Table.Th className="min-w-27.5 whitespace-nowrap">Date</Table.Th>
                {meFields.map((f) => (
                  <Table.Th key={f.key} className="min-w-60">{f.label}</Table.Th>
                ))}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {myRecent.length === 0 ? (
                <Table.Empty
                  colSpan={2 + meFields.length}
                  message="No reports yet. Fill in the form on My Daily Report to get started."
                />
              ) : (
                myRecent.map((r, i) => (
                  <Table.Row key={r.id}>
                    <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                    <Table.Td className="whitespace-nowrap align-top font-medium text-zinc-800">
                      {formatPrettyWithDay(r.date)}
                    </Table.Td>
                    {meFields.map((f) => (
                      <Table.Td key={f.key} className="min-w-60 align-top text-zinc-700">
                        {r.data?.[f.key] || "—"}
                      </Table.Td>
                    ))}
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table>
        )}
      </Card>

      {selectedReport && (
        <ReportDetailModal
          report={selectedReport}
          employee={employeesById[selectedReport.user_id]}
          onClose={() => setSelectedReport(null)}
        />
      )}
    </div>
  );
}

/* ---------- Components ---------- */

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

        {/* Body — one line per field */}
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

function StatCard({ label, value, hint, tone = "zinc", icon, href }) {
  const map = {
    zinc:    { bg: "bg-stone-50",   chip: "bg-zinc-900 text-white",     bar: "bg-zinc-300",    border: "border-zinc-200" },
    emerald: { bg: "bg-emerald-50/70", chip: "bg-emerald-600 text-white", bar: "bg-emerald-400", border: "border-emerald-200" },
    rose:    { bg: "bg-rose-50/70",  chip: "bg-rose-600 text-white",    bar: "bg-rose-400",    border: "border-rose-200" },
    orange:  { bg: "bg-orange-50/70", chip: "bg-orange-600 text-white",  bar: "bg-orange-400",  border: "border-orange-200" },
    amber:   { bg: "bg-amber-50/70", chip: "bg-amber-600 text-white",   bar: "bg-amber-400",   border: "border-amber-200" },
  };
  const t = map[tone] || map.zinc;
  const baseClass = `relative block overflow-hidden rounded-md border ${t.border} ${t.bg} px-2.5 py-2 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500`;
  const inner = (
    <>
      <span className={`absolute inset-x-0 top-0 h-0.5 ${t.bar}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
            {label}
          </p>
          <p className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-900">{value}</p>
          <p className="mt-0.5 truncate text-[10px] text-zinc-600">{hint}</p>
        </div>
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${t.chip}`}>
          <StatIcon name={icon} className="h-3 w-3" />
        </div>
      </div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={baseClass}>
        {inner}
      </Link>
    );
  }
  return <div className={baseClass}>{inner}</div>;
}

function Card({ children, className = "" }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-soft ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 bg-brand-strip px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        {subtitle && <p className="text-[11px] text-zinc-500">{subtitle}</p>}
      </div>
      {right}
    </div>
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

function ArrowIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5 12h14" />
      <path d="M13 5l7 7-7 7" />
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

function StatIcon({ name, className = "" }) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": true };
  if (name === "users") return (<svg {...props}><circle cx="9" cy="8" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="17" cy="9" r="3" /></svg>);
  if (name === "check") return (<svg {...props}><path d="M5 12l4 4L19 7" /></svg>);
  if (name === "alert") return (<svg {...props}><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>);
  if (name === "grid") return (<svg {...props}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>);
  if (name === "palm") return (<svg {...props}><path d="M12 22V12" /><path d="M12 12c0-3 2-5 5-5s4 2 3 4" /><path d="M12 12c0-3-2-5-5-5s-4 2-3 4" /><path d="M12 12c-1-3-4-4-7-2" /><path d="M12 12c1-3 4-4 7-2" /></svg>);
  return null;
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
