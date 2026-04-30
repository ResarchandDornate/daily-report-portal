"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  formatPretty,
  fullName,
  getReportFields,
  indexById,
  todayISO,
} from "@/lib/data";
import {
  useDepartments,
  useEmployees,
  useMe,
  useMissingToday,
  useReports,
} from "@/lib/queries";
import { Table } from "@/components/Table";

export default function OverviewPage() {
  const today = todayISO();

  const { data: me } = useMe();
  const isHR = me?.role === "hr";

  // For HR: fetch everything. For employees: fetch only their own reports.
  const { data: departments = [] } = useDepartments();
  const { data: employees = [] } = useEmployees();
  const reportFilters = useMemo(
    () => (me && !isHR ? { employee: me.id } : {}),
    [me, isHR],
  );
  const { data: reports = [] } = useReports(reportFilters);
  const { data: missingIds = [] } = useMissingToday();

  const employeesById = useMemo(() => indexById(employees), [employees]);

  const todayReports = useMemo(
    () => reports.filter((r) => r.date === today),
    [reports, today]
  );

  const missing = useMemo(
    () => missingIds.map((id) => employeesById[id]).filter(Boolean),
    [missingIds, employeesById]
  );

  const deptStats = useMemo(
    () =>
      departments.map((d) => {
        const inDept = employees.filter((e) => e.department?.slug === d.slug);
        const submitted = inDept.filter((e) =>
          todayReports.some((r) => r.user_id === e.id)
        ).length;
        return { ...d, total: inDept.length, submitted, missing: inDept.length - submitted };
      }),
    [departments, employees, todayReports]
  );

  const recent = useMemo(
    () => [...reports].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
    [reports]
  );

  if (!me) return null;

  return (
    <div className="space-y-5">
      {/* Stat cards — HR only */}
      {isHR && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total Employees" value={employees.length} hint={`Across ${departments.length} departments`} icon="users" tone="orange" />
          <StatCard label="Reports Today" value={todayReports.length} hint={formatPretty(today)} icon="check" tone="emerald" />
          <StatCard label="Missing Today" value={missing.length} hint="Pending submissions" icon="alert" tone="rose" />
          <StatCard label="Departments" value={departments.length} hint="Active teams" icon="grid" tone="zinc" />
        </section>
      )}

      {/* Departments + Missing — HR only */}
      {isHR && (
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Department breakdown" subtitle={`Submission status for ${formatPretty(today)}`} />
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              {deptStats.map((d) => {
                const pct = d.total ? Math.round((d.submitted / d.total) * 100) : 0;
                return (
                  <Link
                    key={d.slug}
                    href={`/dashboard/department/${d.slug}`}
                    className="block rounded-md border border-zinc-200 bg-white p-3 transition hover:border-zinc-300"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${dotBg(d.color)}`} />
                        <p className="text-sm font-medium text-zinc-900">{d.name}</p>
                      </div>
                      <span className="text-xs font-medium text-zinc-500">
                        {d.submitted}/{d.total}
                      </span>
                    </div>
                    <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className={`h-full rounded-full ${barBg(d.color)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px]">
                      <span className="text-zinc-600">{pct}% complete</span>
                      {d.missing > 0 ? (
                        <span className="text-rose-600">{d.missing} missing</span>
                      ) : (
                        <span className="text-emerald-600">All in</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader
              title="Pending today"
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
                  <p className="text-[11px] text-zinc-500">Everyone has submitted today.</p>
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

      {/* Recent submissions — visible to everyone (employees see only their own) */}
      <Card>
        <CardHeader
          title={isHR ? "Recent submissions" : "My recent submissions"}
          subtitle={isHR ? "Latest 8 reports from across the company" : "Your last 8 daily reports"}
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
                  <Table.Row key={r.id}>
                    <Table.Td className="text-center font-medium text-zinc-500">{i + 1}</Table.Td>
                    <Table.Td className="whitespace-nowrap font-medium text-zinc-800">
                      {formatPretty(r.date)}
                    </Table.Td>
                    <Table.Td>
                      <Link
                        href={emp ? `/dashboard/employee/${emp.id}` : "#"}
                        className="flex items-center gap-2 hover:text-orange-700"
                      >
                        <Avatar name={emp ? fullName(emp) : "—"} />
                        <span className="font-medium text-zinc-900 hover:text-orange-700">
                          {emp ? fullName(emp) : `User #${r.user_id}`}
                        </span>
                      </Link>
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
      </Card>
    </div>
  );
}

/* ---------- Components ---------- */

function StatCard({ label, value, hint, tone = "zinc", icon }) {
  const map = {
    zinc:    { bg: "bg-stone-50",   chip: "bg-zinc-900 text-white",     bar: "bg-zinc-300",    border: "border-zinc-200" },
    emerald: { bg: "bg-emerald-50/70", chip: "bg-emerald-600 text-white", bar: "bg-emerald-400", border: "border-emerald-200" },
    rose:    { bg: "bg-rose-50/70",  chip: "bg-rose-600 text-white",    bar: "bg-rose-400",    border: "border-rose-200" },
    orange:  { bg: "bg-orange-50/70", chip: "bg-orange-600 text-white",  bar: "bg-orange-400",  border: "border-orange-200" },
  };
  const t = map[tone] || map.zinc;
  return (
    <div className={`relative overflow-hidden rounded-lg border ${t.border} ${t.bg} p-3.5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift`}>
      <span className={`absolute inset-x-0 top-0 h-0.5 ${t.bar}`} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">{value}</p>
          <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>
        </div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-md shadow-soft ${t.chip}`}>
          <StatIcon name={icon} className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
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

function barBg(color) {
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
