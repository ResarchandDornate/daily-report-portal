"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEPARTMENTS,
  EMPLOYEES,
  departmentById,
  downloadFile,
  employeeById,
  formatPretty,
  loadReports,
  reportsToCSV,
  shiftDays,
  todayISO,
} from "@/lib/data";
import { Table } from "@/components/Table";

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [dept, setDept] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [start, setStart] = useState(shiftDays(todayISO(), -13));
  const [end, setEnd] = useState(todayISO());
  const [query, setQuery] = useState("");

  useEffect(() => {
    setReports(loadReports());
  }, []);

  const employeeOptions = useMemo(
    () => (dept === "all" ? EMPLOYEES : EMPLOYEES.filter((e) => e.department === dept)),
    [dept]
  );

  useEffect(() => {
    if (employeeId !== "all" && !employeeOptions.some((e) => e.id === employeeId)) {
      setEmployeeId("all");
    }
  }, [employeeOptions, employeeId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports
      .filter((r) => r.date >= start && r.date <= end)
      .filter((r) => {
        const emp = employeeById(r.employeeId);
        if (!emp) return false;
        if (dept !== "all" && emp.department !== dept) return false;
        if (employeeId !== "all" && emp.id !== employeeId) return false;
        if (!q) return true;
        const blob = [
          emp.name,
          emp.title,
          r.workDone,
          r.workInProgress,
          r.upcomingPriorities,
          r.challenges,
          r.otherUpdate,
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [reports, dept, employeeId, start, end, query]);

  function exportCSV() {
    const csv = reportsToCSV(filtered);
    const filename = `daily-reports_${start}_to_${end}.csv`;
    downloadFile(filename, csv, "text/csv");
  }

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
              {DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Employee">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass}>
              <option value="all">All employees</option>
              {employeeOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
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

      {/* Table */}
      <Table maxHeight={520}>
        <Table.Head>
          <Table.Row>
            <Table.Th className="w-12 text-center">#</Table.Th>
            <Table.Th>Date</Table.Th>
            <Table.Th>Employee</Table.Th>
            <Table.Th>Department</Table.Th>
            <Table.Th>Work Done</Table.Th>
            <Table.Th>Work in Progress</Table.Th>
            <Table.Th>Upcoming Priorities</Table.Th>
            <Table.Th>Challenges / Support</Table.Th>
            <Table.Th>Other Update</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {filtered.length === 0 ? (
            <Table.Empty colSpan={9} message="No reports match the current filters." />
          ) : (
            filtered.map((r, i) => {
              const emp = employeeById(r.employeeId);
              const d = emp ? departmentById(emp.department) : null;
              return (
                <Table.Row key={r.id}>
                  <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                  <Table.Td className="whitespace-nowrap align-top font-medium text-zinc-800">
                    {formatPretty(r.date)}
                  </Table.Td>
                  <Table.Td className="align-top">
                    <div className="text-xs font-medium text-zinc-900">{emp?.name || r.employeeId}</div>
                    <div className="text-[10px] text-zinc-500">{emp?.title}</div>
                  </Table.Td>
                  <Table.Td className="align-top">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${badgeBg(d?.color)}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${dotBg(d?.color)}`} />
                      {d?.name || "—"}
                    </span>
                  </Table.Td>
                  <Table.Td className="align-top text-zinc-700">{r.workDone || "—"}</Table.Td>
                  <Table.Td className="align-top text-zinc-700">{r.workInProgress || "—"}</Table.Td>
                  <Table.Td className="align-top text-zinc-700">{r.upcomingPriorities || "—"}</Table.Td>
                  <Table.Td className="align-top text-zinc-700">{r.challenges || "—"}</Table.Td>
                  <Table.Td className="align-top text-zinc-700">{r.otherUpdate || "—"}</Table.Td>
                </Table.Row>
              );
            })
          )}
        </Table.Body>
      </Table>
    </div>
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
