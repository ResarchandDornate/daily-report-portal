"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  formatPrettyWithDay,
  fullName,
  indexById,
  shiftDays,
  todayISO,
} from "@/lib/data";
import { useDepartments, useEmployees, useReports } from "@/lib/queries";
import { Table } from "@/components/Table";

export default function LeavesPage() {
  // Default window: 60 days back, to today.  Covers a sensible recent history
  // without pulling the entire reports table.
  const [start, setStart] = useState(shiftDays(todayISO(), -60));
  const [end, setEnd] = useState(todayISO());
  const [dept, setDept] = useState("all");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const defaultStart = shiftDays(todayISO(), -60);
  const defaultEnd = todayISO();
  const activeFilterCount =
    (dept !== "all" ? 1 : 0) + (query.trim() ? 1 : 0);
  const hasNonDefaultFilters =
    activeFilterCount > 0 || start !== defaultStart || end !== defaultEnd;
  function resetFilters() {
    setDept("all");
    setQuery("");
    setStart(defaultStart);
    setEnd(defaultEnd);
  }

  const { data: employees = [] } = useEmployees();
  const { data: departments = [] } = useDepartments();
  const reportFilters = useMemo(
    () => ({ start, end, limit: 5000 }),
    [start, end],
  );
  const { data: reports = [] } = useReports(reportFilters);

  const employeesById = useMemo(() => indexById(employees), [employees]);

  // Group contiguous leave-rows for the same (user, reason) into single periods.
  const leavePeriods = useMemo(() => {
    const leaveRows = reports
      .filter((r) => r.data?.__leave__ === "1")
      .sort((a, b) => {
        if (a.user_id !== b.user_id) return a.user_id - b.user_id;
        return a.date.localeCompare(b.date);
      });

    const periods = [];
    let cur = null;
    for (const r of leaveRows) {
      const reason = r.data?.__leave_reason__ || "";
      const prevDateIso = cur ? shiftDays(cur.end, 1) : null;
      const sameRun =
        cur &&
        cur.user_id === r.user_id &&
        cur.reason === reason &&
        prevDateIso === r.date;
      if (sameRun) {
        cur.end = r.date;
        cur.days += 1;
      } else {
        if (cur) periods.push(cur);
        cur = {
          user_id: r.user_id,
          reason,
          start: r.date,
          end: r.date,
          days: 1,
        };
      }
    }
    if (cur) periods.push(cur);

    // Hydrate each period with employee / department, then sort newest first.
    return periods
      .map((p) => {
        const emp = employeesById[p.user_id];
        return {
          ...p,
          employee: emp,
          deptName: emp?.department?.name || "—",
          deptSlug: emp?.department?.slug || null,
          deptColor: emp?.department?.color || "zinc",
        };
      })
      .sort((a, b) => b.start.localeCompare(a.start));
  }, [reports, employeesById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leavePeriods
      .filter((p) => dept === "all" || p.deptSlug === dept)
      .filter((p) => {
        if (!q) return true;
        const name = p.employee ? fullName(p.employee).toLowerCase() : "";
        return (
          name.includes(q) ||
          p.deptName.toLowerCase().includes(q) ||
          (p.reason || "").toLowerCase().includes(q)
        );
      });
  }, [leavePeriods, dept, query]);

  const totalDays = useMemo(
    () => filtered.reduce((sum, p) => sum + p.days, 0),
    [filtered],
  );
  const uniqueEmployees = useMemo(
    () => new Set(filtered.map((p) => p.user_id)).size,
    [filtered],
  );

  const today = todayISO();
  const onLeaveToday = filtered.filter((p) => today >= p.start && today <= p.end).length;

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-lg border border-amber-100 bg-linear-to-br from-amber-50 via-orange-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Leaves
            </span>
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight text-zinc-900">Leave Log</h1>
              <p className="text-[11px] text-zinc-600">
                Periods marked as &ldquo;On Leave&rdquo; via the Apply Leave action.
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Stat strip */}
      <section className="grid grid-cols-3 gap-3">
        <MiniStat label="On leave today" value={onLeaveToday} tone="amber" />
        <MiniStat label="Total leave days" value={totalDays} tone="zinc" />
        <MiniStat label="Unique employees" value={uniqueEmployees} tone="zinc" />
      </section>

      {/* Filter toggle + Clear button */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
            filtersOpen
              ? "border-orange-600 bg-orange-600 text-white hover:bg-orange-700"
              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          <FilterIcon className="h-3.5 w-3.5" />
          Filter
          {activeFilterCount > 0 && (
            <span className={`ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
              filtersOpen ? "bg-white text-orange-700" : "bg-orange-600 text-white"
            }`}>
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          onClick={resetFilters}
          disabled={!hasNonDefaultFilters}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CloseIcon className="h-3.5 w-3.5" />
          Clear filters
        </button>
      </div>

      {filtersOpen && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
            <Field label="From">
              <input
                type="date"
                value={start}
                max={end}
                onChange={(e) => setStart(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                value={end}
                min={start}
                max={todayISO()}
                onChange={(e) => setEnd(e.target.value)}
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
            <Field label="Search">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, reason…"
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      )}

      {/* Table */}
      <Table maxHeight={560}>
        <Table.Head>
          <Table.Row>
            <Table.Th className="w-12 text-center">#</Table.Th>
            <Table.Th>Employee</Table.Th>
            <Table.Th>Department</Table.Th>
            <Table.Th>From</Table.Th>
            <Table.Th>To</Table.Th>
            <Table.Th className="text-center">Days</Table.Th>
            <Table.Th>Reason</Table.Th>
            <Table.Th />
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {filtered.length === 0 ? (
            <Table.Empty colSpan={8} message="No leave entries in the selected range." />
          ) : (
            filtered.map((p, i) => {
              const isOngoing = today >= p.start && today <= p.end;
              return (
                <Table.Row key={`${p.user_id}-${p.start}`}>
                  <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                  <Table.Td className="align-top">
                    <Link
                      href={p.employee ? `/dashboard/employee/${p.employee.id}` : "#"}
                      className="flex items-center gap-2 text-zinc-900"
                    >
                      <Avatar name={p.employee ? fullName(p.employee) : "—"} />
                      <div className="leading-tight">
                        <div className="text-xs font-medium hover:text-orange-700">
                          {p.employee ? fullName(p.employee) : `User #${p.user_id}`}
                        </div>
                        {p.employee?.title && (
                          <div className="text-[10px] text-zinc-500">{p.employee.title}</div>
                        )}
                      </div>
                    </Link>
                  </Table.Td>
                  <Table.Td className="align-top">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${badgeBg(p.deptColor)}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${dotBg(p.deptColor)}`} />
                      {p.deptName}
                    </span>
                  </Table.Td>
                  <Table.Td className="align-top whitespace-nowrap text-zinc-700">{formatPrettyWithDay(p.start)}</Table.Td>
                  <Table.Td className="align-top whitespace-nowrap text-zinc-700">{formatPrettyWithDay(p.end)}</Table.Td>
                  <Table.Td className="text-center align-top">
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                      {p.days}
                    </span>
                  </Table.Td>
                  <Table.Td className="align-top text-zinc-700">{p.reason || "—"}</Table.Td>
                  <Table.Td className="align-top text-right">
                    {isOngoing && (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                        Ongoing
                      </span>
                    )}
                  </Table.Td>
                </Table.Row>
              );
            })
          )}
        </Table.Body>
      </Table>
    </div>
  );
}

/* ---------- bits ---------- */

const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20";

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function MiniStat({ label, value, tone = "zinc" }) {
  const map = {
    zinc:  "bg-white text-zinc-900 border-zinc-200",
    amber: "bg-amber-50 text-amber-900 border-amber-200",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 ${map[tone] || map.zinc}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold">{value}</p>
    </div>
  );
}

function FilterIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 5h18l-7 9v6l-4-2v-4z" />
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
  const initials = (name || "—").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-600 text-[9px] font-semibold text-white">
      {initials}
    </span>
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
