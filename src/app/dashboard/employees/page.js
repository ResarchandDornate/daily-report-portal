"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatPretty, fullName } from "@/lib/data";
import { useDepartments, useEmployees } from "@/lib/queries";
import { Table } from "@/components/Table";

export default function AllEmployeesPage() {
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");

  const { data: employees = [], isLoading } = useEmployees();
  const { data: departments = [] } = useDepartments();

  const organisations = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => { if (e.organisation) set.add(e.organisation); });
    return [...set].sort();
  }, [employees]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees
      .filter((e) => deptFilter === "all" || e.department?.slug === deptFilter)
      .filter((e) => orgFilter === "all" || (e.organisation || "") === orgFilter)
      .filter((e) => {
        if (!q) return true;
        return (
          fullName(e).toLowerCase().includes(q) ||
          (e.organisation || "").toLowerCase().includes(q) ||
          (e.department?.name || "").toLowerCase().includes(q) ||
          (e.reporting_manager || "").toLowerCase().includes(q) ||
          (e.email || "").toLowerCase().includes(q) ||
          (e.title || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Sort by department, then by name
        const da = a.department?.name || "~";
        const db = b.department?.name || "~";
        if (da !== db) return da.localeCompare(db);
        return fullName(a).localeCompare(fullName(b));
      });
  }, [employees, query, deptFilter, orgFilter]);

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-700 ring-1 ring-orange-200">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              Roster
            </span>
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight text-zinc-900">All Employees</h1>
              <p className="text-[11px] text-zinc-600">
                {employees.length} {employees.length === 1 ? "employee" : "employees"} across {departments.length} departments
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
        <div className="sm:col-span-2 relative">
          <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, organisation, dept, RM, email…"
            className="block w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-8 pr-2.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
        </div>
        <select
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
          className={inputClass}
        >
          <option value="all">All organisations</option>
          {organisations.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className={inputClass}
        >
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d.slug} value={d.slug}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Table — columns match the Excel: Organisation | S. No. | Name | Dept | RM | DOJ */}
      <Table maxHeight={600}>
        <Table.Head>
          <Table.Row>
            <Table.Th>Organisation</Table.Th>
            <Table.Th className="w-16 text-center">S. No.</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Dept</Table.Th>
            <Table.Th>RM</Table.Th>
            <Table.Th>DOJ</Table.Th>
            <Table.Th />
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {isLoading ? (
            <Table.Empty colSpan={7} message="Loading employees…" />
          ) : filtered.length === 0 ? (
            <Table.Empty colSpan={7} message={query || deptFilter !== "all" || orgFilter !== "all" ? "No employees match the current filters." : "No employees found."} />
          ) : (
            filtered.map((emp, i) => {
              const dept = emp.department;
              return (
                <Table.Row key={emp.id}>
                  <Table.Td className="align-top text-zinc-700">{emp.organisation || "—"}</Table.Td>
                  <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                  <Table.Td className="align-top">
                    <Link
                      href={`/dashboard/employee/${emp.id}`}
                      className="flex items-center gap-2 text-zinc-900"
                    >
                      <Avatar name={fullName(emp)} />
                      <div className="leading-tight">
                        <div className="text-xs font-medium hover:text-orange-700">{fullName(emp)}</div>
                        {emp.title ? (
                          <div className="text-[10px] text-zinc-500">{emp.title}</div>
                        ) : null}
                      </div>
                    </Link>
                  </Table.Td>
                  <Table.Td className="align-top">
                    {dept ? (
                      <Link
                        href={`/dashboard/department/${dept.slug}`}
                        className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] hover:underline ${badgeBg(dept.color)}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${dotBg(dept.color)}`} />
                        {dept.name}
                      </Link>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </Table.Td>
                  <Table.Td className="align-top text-zinc-700">{emp.reporting_manager || "—"}</Table.Td>
                  <Table.Td className="align-top whitespace-nowrap text-zinc-700">
                    {emp.date_of_joining ? formatPretty(emp.date_of_joining) : "—"}
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

function dotBg(color) {
  return {
    indigo: "bg-indigo-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
    rose: "bg-rose-500",
    sky: "bg-sky-500",
    zinc: "bg-zinc-500",
  }[color] || "bg-zinc-400";
}

function badgeBg(color) {
  return {
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-800",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    sky: "bg-sky-50 text-sky-700",
    zinc: "bg-zinc-100 text-zinc-700",
  }[color] || "bg-zinc-100 text-zinc-700";
}
