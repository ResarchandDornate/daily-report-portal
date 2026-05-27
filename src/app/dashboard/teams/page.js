"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatPretty, fullName, getWeekRange, todayISO } from "@/lib/data";
import { useEmployees, useMe, useReports } from "@/lib/queries";
import { Table } from "@/components/Table";

export default function TeamsPage() {
  const [query, setQuery] = useState("");
  const { data: me } = useMe();
  const today = todayISO();
  const week = useMemo(() => getWeekRange(), []);

  // The Teams view is scoped to the team head's OWN department.
  const myDeptSlug = me?.department?.slug;
  const { data: employees = [] } = useEmployees(
    myDeptSlug ? { department: myDeptSlug } : {},
  );
  const { data: reports = [] } = useReports(
    myDeptSlug ? { department: myDeptSlug, start: week.start, end: week.end } : {},
  );

  const rows = useMemo(() => {
    if (!me) return [];
    const q = query.trim().toLowerCase();
    return employees
      // Skip the team head themselves — they have "My Daily Report" for that.
      .filter((e) => e.id !== me.id)
      .map((emp) => {
        const empReports = reports.filter((r) => r.user_id === emp.id);
        const last = [...empReports].sort((a, b) => b.date.localeCompare(a.date))[0];
        const submittedToday = empReports.some((r) => r.date === today);
        return {
          emp,
          totalThisWeek: empReports.length,
          lastDate: last?.date || null,
          submittedToday,
        };
      })
      .filter(({ emp }) => {
        if (!q) return true;
        return (
          fullName(emp).toLowerCase().includes(q) ||
          (emp.email || "").toLowerCase().includes(q) ||
          (emp.title || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => fullName(a.emp).localeCompare(fullName(b.emp)));
  }, [employees, reports, me, today, query]);

  if (!me) return null;
  if (!me.is_team_head) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900">
        <h2 className="text-sm font-semibold">Not authorised</h2>
        <p className="mt-1 text-xs">
          Only team heads can view this page. If you should have access, ask HR to enable the team-head flag on your profile.
        </p>
      </div>
    );
  }

  const submittedToday = rows.filter((r) => r.submittedToday).length;

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-700 ring-1 ring-orange-200">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              Team
            </span>
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight text-zinc-900">
                {me.department?.name || "Your team"}
              </h1>
              <p className="text-[11px] text-zinc-600">
                {rows.length} {rows.length === 1 ? "colleague" : "colleagues"} ·{" "}
                <span className="font-medium text-emerald-700">{submittedToday} submitted today</span>
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, title…"
          className="block w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-8 pr-2.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
        />
      </div>

      <Table maxHeight={600}>
        <Table.Head>
          <Table.Row>
            <Table.Th className="w-12 text-center">#</Table.Th>
            <Table.Th>Employee</Table.Th>
            <Table.Th>Title</Table.Th>
            <Table.Th>Today</Table.Th>
            <Table.Th className="text-center">Reports this week</Table.Th>
            <Table.Th>Last submission</Table.Th>
            <Table.Th />
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {rows.length === 0 ? (
            <Table.Empty colSpan={7} message="No teammates match your search." />
          ) : (
            rows.map(({ emp, totalThisWeek, lastDate, submittedToday }, i) => (
              <Table.Row key={emp.id}>
                <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                <Table.Td className="align-top">
                  <div className="flex items-center gap-2">
                    <Avatar name={fullName(emp)} />
                    <div className="leading-tight">
                      <div className="text-xs font-medium text-zinc-900">{fullName(emp)}</div>
                      <div className="text-[10px] text-zinc-500">{emp.email}</div>
                    </div>
                  </div>
                </Table.Td>
                <Table.Td className="align-top text-zinc-700">{emp.title || "—"}</Table.Td>
                <Table.Td className="align-top">
                  {submittedToday ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      ✓ Submitted
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                      Pending
                    </span>
                  )}
                </Table.Td>
                <Table.Td className="text-center align-top font-medium text-zinc-800">{totalThisWeek}</Table.Td>
                <Table.Td className="align-top text-zinc-700">
                  {lastDate ? formatPretty(lastDate) : "—"}
                </Table.Td>
                <Table.Td className="align-top text-right">
                  <Link
                    href={`/dashboard/teams/${emp.id}`}
                    className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-orange-700"
                  >
                    Fill report →
                  </Link>
                </Table.Td>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>
    </div>
  );
}

function Avatar({ name }) {
  const initials = (name || "—").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
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
