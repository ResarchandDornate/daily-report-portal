"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatPrettyWithDay, fullName } from "@/lib/data";
import {
  useDepartments,
  useEmployees,
  useMe,
  useOrganisations,
  useReactivateEmployee,
} from "@/lib/queries";
import { Table } from "@/components/Table";

export default function EmployeesLeftPage() {
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");

  const { data: me } = useMe();
  const isHR = me?.role === "hr";

  // Pull the full roster (active + inactive), then filter to left-only.
  const { data: employees = [], isLoading } = useEmployees({ include_inactive: true });
  const { data: departments = [] } = useDepartments();
  const { data: organisations = [] } = useOrganisations();
  const reactivate = useReactivateEmployee();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees
      .filter((e) => e.is_active === false)
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
      // Group rows by department (A→Z), then by employee name within the
      // same department.  Empty depts go to the bottom.
      .sort((a, b) => {
        const da = a.department?.name || "";
        const db = b.department?.name || "";
        if (!da && db) return 1;
        if (da && !db) return -1;
        const deptCmp = da.localeCompare(db);
        if (deptCmp !== 0) return deptCmp;
        return fullName(a).localeCompare(fullName(b));
      });
  }, [employees, query, deptFilter, orgFilter]);

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-lg border border-rose-100 bg-linear-to-br from-rose-50 via-stone-50 to-amber-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-800">
              Roster
            </span>
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight text-zinc-900">
                Employees Left
              </h1>
              <p className="text-[11px] text-zinc-600">
                {filtered.length}{" "}
                {filtered.length === 1 ? "employee" : "employees"} who have
                left the company
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Filters */}
      <section className="grid gap-2 lg:grid-cols-[1fr_240px_240px]">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
            <SearchIcon className="h-3.5 w-3.5" />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, organisation, department, reporting manager, email…"
            className="w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </div>
        <select
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
        >
          <option value="all">All organisations</option>
          {organisations.map((o) => (
            <option key={o.id} value={o.name}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
        >
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name}
            </option>
          ))}
        </select>
      </section>

      <Table maxHeight={600}>
        <Table.Head>
          <Table.Row>
            <Table.Th>Organisation</Table.Th>
            <Table.Th className="w-16 text-center">S. No.</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Department</Table.Th>
            <Table.Th>Reporting Manager</Table.Th>
            <Table.Th>Date of Joining</Table.Th>
            <Table.Th className="whitespace-nowrap text-center">Status</Table.Th>
            <Table.Th />
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {isLoading ? (
            <Table.Empty colSpan={8} message="Loading employees…" />
          ) : filtered.length === 0 ? (
            <Table.Empty
              colSpan={8}
              message={
                query || deptFilter !== "all" || orgFilter !== "all"
                  ? "No employees match the current filters."
                  : "No employees have left the company yet."
              }
            />
          ) : (
            filtered.map((emp, i) => {
              const dept = emp.department;
              return (
                <Table.Row key={emp.id}>
                  <Table.Td className="align-top text-zinc-700">
                    {emp.organisation || "—"}
                  </Table.Td>
                  <Table.Td className="text-center align-top font-medium text-zinc-500">
                    {i + 1}
                  </Table.Td>
                  <Table.Td className="align-top">
                    <Link
                      href={`/dashboard/employee/${emp.id}`}
                      className="flex items-center gap-2 text-zinc-900"
                    >
                      <Avatar name={fullName(emp)} />
                      <span className="text-[13px] font-medium hover:text-orange-700">
                        {fullName(emp)}
                      </span>
                    </Link>
                  </Table.Td>
                  <Table.Td className="align-top">
                    {dept ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${deptToneClasses(
                          dept.color,
                        )}`}
                      >
                        <DotIcon className={`h-1.5 w-1.5 ${deptDotColor(dept.color)}`} />
                        {dept.name}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </Table.Td>
                  <Table.Td className="align-top text-zinc-700">
                    {emp.reporting_manager || "—"}
                  </Table.Td>
                  <Table.Td className="align-top text-zinc-700">
                    {emp.date_of_joining
                      ? formatPrettyWithDay(emp.date_of_joining)
                      : "—"}
                  </Table.Td>
                  <Table.Td className="align-top text-center">
                    <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">
                      Left
                    </span>
                  </Table.Td>
                  <Table.Td className="align-top text-right">
                    {isHR && (
                      <button
                        type="button"
                        onClick={() => reactivate.mutate(emp.id)}
                        disabled={reactivate.isPending}
                        className="text-[12px] font-medium text-orange-600 hover:text-orange-800 disabled:opacity-50"
                      >
                        Rejoin
                      </button>
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

function Avatar({ name }) {
  const initials = (name || "—")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-400 text-[9px] font-semibold text-white">
      {initials}
    </span>
  );
}

function SearchIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function DotIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 8 8" className={className} aria-hidden>
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

function deptToneClasses(color) {
  switch (color) {
    case "rose":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    case "amber":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "emerald":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "sky":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "indigo":
      return "bg-indigo-50 text-indigo-700 ring-indigo-200";
    case "violet":
      return "bg-violet-50 text-violet-700 ring-violet-200";
    case "fuchsia":
      return "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200";
    default:
      return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  }
}

function deptDotColor(color) {
  switch (color) {
    case "rose":
      return "text-rose-500";
    case "amber":
      return "text-amber-500";
    case "emerald":
      return "text-emerald-500";
    case "sky":
      return "text-sky-500";
    case "indigo":
      return "text-indigo-500";
    case "violet":
      return "text-violet-500";
    case "fuchsia":
      return "text-fuchsia-500";
    default:
      return "text-zinc-500";
  }
}
