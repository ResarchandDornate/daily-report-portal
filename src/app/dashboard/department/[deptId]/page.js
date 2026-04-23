"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  EMPLOYEES,
  departmentById,
  formatPretty,
  loadReports,
  todayISO,
} from "@/lib/data";
import { Table } from "@/components/Table";

export default function DepartmentPage() {
  const params = useParams();
  const deptId = params.deptId;
  const dept = departmentById(deptId);
  const [reports, setReports] = useState([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setReports(loadReports());
  }, []);

  const employees = useMemo(
    () => EMPLOYEES.filter((e) => e.department === deptId),
    [deptId]
  );

  const today = todayISO();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees
      .map((emp) => {
        const empReports = reports.filter((r) => r.employeeId === emp.id);
        const last = empReports.sort((a, b) => b.date.localeCompare(a.date))[0];
        const submittedToday = empReports.some((r) => r.date === today);
        return {
          emp,
          totalReports: empReports.length,
          lastDate: last?.date || null,
          submittedToday,
        };
      })
      .filter(({ emp }) => {
        if (!q) return true;
        return (
          emp.name.toLowerCase().includes(q) ||
          emp.title.toLowerCase().includes(q) ||
          emp.email.toLowerCase().includes(q)
        );
      });
  }, [employees, reports, today, query]);

  if (!dept) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900">
        <h2 className="text-sm font-semibold">Department not found</h2>
        <p className="mt-1 text-xs">
          The department <code className="rounded bg-rose-100 px-1">{deptId}</code> does not exist.
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
                <span className="font-medium text-emerald-700">{submittedCount} submitted today</span>
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${dept.name}…`}
          className="block w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-8 pr-2.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
        />
      </div>

      {/* Table */}
      <Table maxHeight={520}>
        <Table.Head>
          <Table.Row>
            <Table.Th className="w-12 text-center">#</Table.Th>
            <Table.Th>Employee</Table.Th>
            <Table.Th>Title</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Today</Table.Th>
            <Table.Th>Total Reports</Table.Th>
            <Table.Th>Last Submission</Table.Th>
            <Table.Th />
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {rows.length === 0 ? (
            <Table.Empty
              colSpan={8}
              message={query ? "No employees match your search." : "No employees in this department."}
            />
          ) : (
            rows.map(({ emp, totalReports, lastDate, submittedToday }, i) => (
              <Table.Row key={emp.id}>
                <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                <Table.Td className="align-top">
                  <Link
                    href={`/dashboard/employee/${emp.id}`}
                    className="flex items-center gap-2 text-zinc-900"
                  >
                    <Avatar name={emp.name} />
                    <span className="text-xs font-medium hover:text-orange-700">{emp.name}</span>
                  </Link>
                </Table.Td>
                <Table.Td className="align-top text-zinc-700">{emp.title}</Table.Td>
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
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600 hover:text-orange-700"
                  >
                    View →
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

/* ---------- bits ---------- */

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
