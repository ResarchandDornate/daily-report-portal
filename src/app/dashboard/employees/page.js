"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatPrettyWithDay, fullName, getWeekRange } from "@/lib/data";
import {
  useCreateDepartment,
  useCreateEmployee,
  useCreateOrganisation,
  useDeactivateEmployee,
  useDeleteOrganisation,
  useDepartments,
  useEmployees,
  useMe,
  useOrganisations,
  useReactivateEmployee,
  useReports,
  useUpdateEmployee,
  useUpdateOrganisation,
} from "@/lib/queries";
import { Table } from "@/components/Table";

export default function AllEmployeesPage() {
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [empModal, setEmpModal] = useState(null); // { mode: "add" | "edit", employee? }
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [orgModalOpen, setOrgModalOpen] = useState(false);

  const { data: me } = useMe();
  const isHR = me?.role === "hr";
  const { data: employees = [], isLoading } = useEmployees({ include_inactive: showInactive });
  const { data: departments = [] } = useDepartments();
  const { data: organisations = [] } = useOrganisations();

  // "This week" attendance — fetch reports across the current calendar week
  // (Mon → today) and tag each employee with the latest day-of-week index
  // they're caught up to.  Denominator is always 5 (full Mon-Fri week);
  // numerator is which weekday they've reached (Mon=1 ... Fri=5).
  const week = useMemo(() => getWeekRange(), []);
  const weekTotal = 5;
  const { data: weekReports = [] } = useReports({ start: week.start, end: week.end });
  const submissionsByUser = useMemo(() => {
    // We display "latest workday index reached this week" — so an employee
    // who submitted today (Tuesday, day-2) shows 2/2 even if they skipped
    // Monday.  Submitting today moves them up to the current day's count;
    // missing today caps them at their last submission's day index.
    const maxDowByUser = {};
    for (const r of weekReports) {
      const dow = new Date(r.date + "T00:00:00").getDay();
      if (dow === 0 || dow === 6) continue; // skip Sat/Sun
      const dayIdx = dow; // Mon=1 ... Fri=5
      if (dayIdx > (maxDowByUser[r.user_id] || 0)) {
        maxDowByUser[r.user_id] = dayIdx;
      }
    }
    const counts = {};
    for (const [uid, idx] of Object.entries(maxDowByUser)) {
      counts[uid] = Math.min(idx, weekTotal);
    }
    return counts;
  }, [weekReports, weekTotal]);

  // "This month" attendance — fetch reports for the current calendar month
  // (1st → end of month) and count distinct weekdays each employee filed on.
  // Denominator is the total Mon-Fri count for the whole calendar month
  // (not capped at today) so the cell shows e.g. "5 / 22 (Jun)".
  const monthInfo = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-indexed
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0); // last day of current month
    const iso = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let workdays = 0;
    for (let d = 1; d <= last.getDate(); d += 1) {
      const dow = new Date(y, m, d).getDay();
      if (dow !== 0 && dow !== 6) workdays += 1;
    }
    return {
      start: iso(first),
      end: iso(last),
      workdays,
      label: first.toLocaleString(undefined, { month: "short" }),
    };
  }, []);
  const { data: monthReports = [] } = useReports({
    start: monthInfo.start,
    end: monthInfo.end,
  });
  const monthSubmissionsByUser = useMemo(() => {
    // Count distinct weekday dates per user (multiple submissions same day
    // collapse to one).  Saturdays / Sundays are excluded so the ratio
    // stays out of `<total>` (which is Mon-Fri only).
    const dayKeysByUser = {};
    for (const r of monthReports) {
      const dow = new Date(r.date + "T00:00:00").getDay();
      if (dow === 0 || dow === 6) continue;
      const set = (dayKeysByUser[r.user_id] = dayKeysByUser[r.user_id] || new Set());
      set.add(r.date);
    }
    const counts = {};
    for (const [uid, s] of Object.entries(dayKeysByUser)) {
      counts[uid] = s.size;
    }
    return counts;
  }, [monthReports]);


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
      // Primary: department name (A→Z, empty depts pinned to the bottom).
      // Secondary: employee full name within the same department.
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
          {isHR && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOrgModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Organisations
              </button>
              <button
                onClick={() => setDeptModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Add Department
              </button>
              <button
                onClick={() => setEmpModal({ mode: "add" })}
                className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-orange-700"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Add Employee
              </button>
            </div>
          )}
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
            placeholder="Search name, organisation, department, reporting manager, email…"
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
            <option key={o.id} value={o.name}>{o.name}</option>
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

      {isHR && (
        <label className="flex items-center gap-2 text-[11px] text-zinc-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
          />
          Show deactivated employees
        </label>
      )}

      {/* Table — columns match the Excel: Organisation | S. No. | Name | Department | Reporting Manager | Date of Joining */}
      <Table maxHeight={600}>
        <Table.Head>
          <Table.Row>
            <Table.Th>Organisation</Table.Th>
            <Table.Th className="w-16 text-center">S. No.</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Department</Table.Th>
            <Table.Th>Reporting Manager</Table.Th>
            <Table.Th>Date of Joining</Table.Th>
            <Table.Th className="whitespace-nowrap text-center">This Week</Table.Th>
            <Table.Th className="whitespace-nowrap text-center">This Month</Table.Th>
            <Table.Th />
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {isLoading ? (
            <Table.Empty colSpan={9} message="Loading employees…" />
          ) : filtered.length === 0 ? (
            <Table.Empty colSpan={9} message={query || deptFilter !== "all" || orgFilter !== "all" ? "No employees match the current filters." : "No employees found."} />
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
                    {emp.date_of_joining ? formatPrettyWithDay(emp.date_of_joining) : "—"}
                  </Table.Td>
                  <Table.Td className="align-top text-center">
                    <WeekBadge count={submissionsByUser[emp.id] || 0} total={weekTotal} />
                  </Table.Td>
                  <Table.Td className="align-top text-center">
                    <MonthBadge
                      count={monthSubmissionsByUser[emp.id] || 0}
                      total={monthInfo.workdays}
                      label={monthInfo.label}
                    />
                  </Table.Td>
                  <Table.Td className="align-top text-right">
                    <div className="flex items-center justify-end gap-2">
                      {emp.is_active === false && (
                        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-zinc-200">
                          Deactivated
                        </span>
                      )}
                      {isHR && (
                        <button
                          onClick={() => setEmpModal({ mode: "edit", employee: emp })}
                          className="text-[11px] font-medium text-zinc-600 hover:text-orange-700"
                        >
                          Edit
                        </button>
                      )}
                      <Link
                        href={`/dashboard/employee/${emp.id}`}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600 hover:text-orange-700"
                      >
                        View →
                      </Link>
                    </div>
                  </Table.Td>
                </Table.Row>
              );
            })
          )}
        </Table.Body>
      </Table>

      {empModal && (
        <EmployeeFormModal
          mode={empModal.mode}
          employee={empModal.employee}
          departments={departments}
          organisations={organisations}
          onClose={() => setEmpModal(null)}
        />
      )}

      {deptModalOpen && (
        <DepartmentFormModal
          mode="add"
          onClose={() => setDeptModalOpen(false)}
        />
      )}

      {orgModalOpen && (
        <OrganisationsModal
          organisations={organisations}
          employees={employees}
          onClose={() => setOrgModalOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------- bits ---------- */

const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20";

const labelClass = "block text-[10px] font-medium uppercase tracking-wider text-zinc-500";

function EmployeeFormModal({ mode, employee, departments, organisations = [], onClose }) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState(() => ({
    first_name: employee?.first_name || "",
    last_name: employee?.last_name || "",
    email: employee?.email || "",
    department: employee?.department?.slug || "",
    title: employee?.title || "",
    contact_number: employee?.contact_number || "",
    role: employee?.role || "employee",
    is_team_head: Boolean(employee?.is_team_head),
    team_head_dept: employee?.team_head_dept || "",
    organisation: employee?.organisation || "",
    reporting_manager: employee?.reporting_manager || "",
    date_of_joining: employee?.date_of_joining || "",
    password: "",
    is_active: employee?.is_active !== false,
  }));

  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const deactivate = useDeactivateEmployee();
  const reactivate = useReactivateEmployee();
  const pending = create.isPending || update.isPending || deactivate.isPending || reactivate.isPending;

  function up(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  async function save(e) {
    e?.preventDefault();
    const payload = { ...form };
    if (!payload.password) delete payload.password; // only send if HR set one
    if (!payload.date_of_joining) delete payload.date_of_joining;
    if (!payload.last_name) payload.last_name = "";
    try {
      if (isEdit) {
        await update.mutateAsync({ id: employee.id, ...payload });
      } else {
        delete payload.is_active;
        await create.mutateAsync(payload);
      }
      onClose();
    } catch {
      /* toast already fired */
    }
  }

  async function handleDeactivate() {
    if (!employee) return;
    if (!confirm(`Deactivate ${fullName(employee)}? They won't be able to log in.`)) return;
    try {
      await deactivate.mutateAsync(employee.id);
      onClose();
    } catch {}
  }

  async function handleReactivate() {
    if (!employee) return;
    try {
      await reactivate.mutateAsync(employee.id);
      onClose();
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-orange-50 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-700">
              {isEdit ? "Edit employee" : "Add employee"}
            </p>
            <h2 className="mt-0.5 text-base font-semibold text-zinc-900">
              {isEdit ? fullName(employee) : "New employee"}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-900">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-auto p-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>First name *</label>
            <input className={`mt-1 ${inputClass}`} value={form.first_name} onChange={(e) => up("first_name", e.target.value)} required />
          </div>
          <div>
            <label className={labelClass}>Last name</label>
            <input className={`mt-1 ${inputClass}`} value={form.last_name} onChange={(e) => up("last_name", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Email *</label>
            <input type="email" className={`mt-1 ${inputClass}`} value={form.email} onChange={(e) => up("email", e.target.value)} required />
          </div>
          <div>
            <label className={labelClass}>Department</label>
            <select className={`mt-1 ${inputClass}`} value={form.department} onChange={(e) => up("department", e.target.value)}>
              <option value="">— No department —</option>
              {departments.map((d) => (
                <option key={d.slug} value={d.slug}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Role</label>
            <select className={`mt-1 ${inputClass}`} value={form.role} onChange={(e) => up("role", e.target.value)}>
              <option value="employee">Employee</option>
              <option value="hr">HR / Admin</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Title</label>
            <input className={`mt-1 ${inputClass}`} value={form.title} onChange={(e) => up("title", e.target.value)} placeholder="e.g. Logistics Executive" />
          </div>
          <div>
            <label className={labelClass}>Contact number</label>
            <input className={`mt-1 ${inputClass}`} value={form.contact_number} onChange={(e) => up("contact_number", e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Organisation</label>
            <select
              className={`mt-1 ${inputClass}`}
              value={form.organisation || ""}
              onChange={(e) => up("organisation", e.target.value)}
            >
              <option value="">— None —</option>
              {organisations.map((o) => (
                <option key={o.id} value={o.name}>{o.name}</option>
              ))}
              {/* If the existing value isn't in the canonical list (e.g. an
                  older employee with a typo'd org), still show it so the
                  field can be persisted without forcing a change. */}
              {form.organisation && !organisations.some((o) => o.name === form.organisation) && (
                <option value={form.organisation}>{form.organisation} (legacy)</option>
              )}
            </select>
            <p className="mt-1 text-[10px] text-zinc-500">
              Manage the list via the &ldquo;Organisations&rdquo; button on All Employees.
            </p>
          </div>
          <div>
            <label className={labelClass}>Reporting manager</label>
            <input className={`mt-1 ${inputClass}`} value={form.reporting_manager} onChange={(e) => up("reporting_manager", e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Date of joining</label>
            <input type="date" className={`mt-1 ${inputClass}`} value={form.date_of_joining || ""} onChange={(e) => up("date_of_joining", e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>
              {isEdit ? "Reset password (leave blank to keep)" : "Password (blank → firstname@ornate)"}
            </label>
            <input type="text" className={`mt-1 ${inputClass}`} value={form.password} onChange={(e) => up("password", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-xs text-zinc-700">
              <input
                type="checkbox"
                checked={Boolean(form.is_team_head)}
                onChange={(e) => up("is_team_head", e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
              />
              <span>
                <span className="font-medium">Team head</span>
                <span className="ml-1 text-[10px] text-zinc-500">
                  — can submit daily reports on behalf of any colleague in the managed department
                </span>
              </span>
            </label>
          </div>
          {form.is_team_head && (
            <div className="sm:col-span-2">
              <label className={labelClass}>Manages department</label>
              <select
                className={`mt-1 ${inputClass}`}
                value={form.team_head_dept}
                onChange={(e) => up("team_head_dept", e.target.value)}
              >
                <option value="">
                  Their own department ({departments.find((d) => d.slug === form.department)?.name || "—"})
                </option>
                {departments
                  .filter((d) => d.slug !== form.department)
                  .map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.name}
                    </option>
                  ))}
              </select>
              <p className="mt-1 text-[10px] text-zinc-500">
                Lets a Sales Head sit in &ldquo;Sales Head&rdquo; while filing
                reports for the Sales team. Leave as default for normal team
                heads who manage their own department.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-3">
          <div>
            {isEdit && (form.is_active === false ? (
              <button
                type="button"
                onClick={handleReactivate}
                disabled={pending}
                className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                Reactivate
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={pending}
                className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                Deactivate
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
              {pending ? "Saving…" : isEdit ? "Save changes" : "Create employee"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function OrganisationsModal({ organisations, employees, onClose }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const create = useCreateOrganisation();
  const update = useUpdateOrganisation();
  const del = useDeleteOrganisation();

  // Count how many employees reference each organisation by name — used
  // to show a usage hint and block delete when an org is still in use.
  const usageByName = useMemo(() => {
    const counts = {};
    for (const e of employees) {
      const n = (e.organisation || "").trim();
      if (!n) continue;
      counts[n] = (counts[n] || 0) + 1;
    }
    return counts;
  }, [employees]);

  async function handleCreate(e) {
    e.preventDefault();
    const n = newName.trim();
    if (!n) return;
    try {
      await create.mutateAsync({ name: n, color: "zinc" });
      setNewName("");
    } catch {}
  }

  function startEdit(org) {
    setEditingId(org.id);
    setEditName(org.name);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }
  async function saveEdit() {
    const n = editName.trim();
    if (!n) return;
    try {
      await update.mutateAsync({ id: editingId, name: n });
      cancelEdit();
    } catch {}
  }
  async function handleDelete(org) {
    const inUse = usageByName[org.name] || 0;
    if (inUse > 0) {
      alert(`Can't delete "${org.name}" — ${inUse} employee(s) still belong to this organisation. Reassign them first.`);
      return;
    }
    if (!confirm(`Delete organisation "${org.name}"?`)) return;
    try {
      await del.mutateAsync(org.id);
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-orange-50 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-700">Manage</p>
            <h2 className="mt-0.5 text-base font-semibold text-zinc-900">Organisations</h2>
            <p className="text-[11px] text-zinc-600">Add, rename, or delete. Renames don&rsquo;t update employees automatically.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-900">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Add new */}
        <form onSubmit={handleCreate} className="flex items-center gap-2 border-b border-zinc-100 bg-stone-50/60 px-4 py-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Organisation name"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={!newName.trim() || create.isPending}
            className="shrink-0 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {create.isPending ? "Adding…" : "Add"}
          </button>
        </form>

        {/* Existing list */}
        <div className="flex-1 overflow-auto">
          {organisations.length === 0 ? (
            <p className="px-4 py-6 text-center text-[11px] text-zinc-500">
              No organisations yet. Add the first one above.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {organisations.map((org) => {
                const usage = usageByName[org.name] || 0;
                const isEditing = editingId === org.id;
                return (
                  <li key={org.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[12px]">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                          if (e.key === "Escape") cancelEdit();
                        }}
                        autoFocus
                        className="flex-1 rounded-md border border-orange-300 bg-white px-2 py-1 text-xs outline-none focus:border-orange-500"
                      />
                    ) : (
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-zinc-900">{org.name}</p>
                        <p className="text-[10px] text-zinc-500">
                          {usage === 0 ? "Unused" : `${usage} employee${usage === 1 ? "" : "s"}`}
                        </p>
                      </div>
                    )}
                    <div className="flex shrink-0 items-center gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={saveEdit}
                            disabled={update.isPending || !editName.trim()}
                            className="rounded-md bg-orange-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(org)}
                            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(org)}
                            disabled={usage > 0 || del.isPending}
                            title={usage > 0 ? `In use by ${usage} employee(s)` : "Delete"}
                            className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-zinc-200 bg-zinc-50 px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function DepartmentFormModal({ onClose }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [color, setColor] = useState("zinc");
  const create = useCreateDepartment();

  // Auto-generate slug from name in camelCase as the user types — but only if
  // they haven't manually edited the slug field.
  const [slugTouched, setSlugTouched] = useState(false);
  function onNameChange(v) {
    setName(v);
    if (!slugTouched) {
      const auto = v
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .split(/\s+/)
        .filter(Boolean)
        .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
        .join("");
      setSlug(auto);
    }
  }

  async function save(e) {
    e.preventDefault();
    try {
      await create.mutateAsync({ slug, name, color, report_fields: [] });
      onClose();
    } catch {}
  }

  const colors = ["indigo", "amber", "emerald", "rose", "sky", "zinc"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-orange-50 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-700">New department</p>
            <h2 className="mt-0.5 text-base font-semibold text-zinc-900">Add Department</h2>
            <p className="text-[11px] text-zinc-600">You can configure the report fields later from the department detail page.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-900">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div>
            <label className={labelClass}>Name *</label>
            <input className={`mt-1 ${inputClass}`} value={name} onChange={(e) => onNameChange(e.target.value)} required placeholder="e.g. Quality Assurance" />
          </div>
          <div>
            <label className={labelClass}>Slug *</label>
            <input
              className={`mt-1 ${inputClass} font-mono`}
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
              required
              placeholder="qualityAssurance"
            />
            <p className="mt-1 text-[10px] text-zinc-500">URL-safe identifier (letters / digits / underscores / hyphens). Used in URLs and field keys.</p>
          </div>
          <div>
            <label className={labelClass}>Color</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${
                    color === c ? "border-zinc-900 bg-zinc-50 text-zinc-900" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${dotBg(c)}`} />
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100">
            Cancel
          </button>
          <button type="submit" disabled={create.isPending || !name || !slug} className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
            {create.isPending ? "Creating…" : "Create department"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PlusIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 5v14M5 12h14" />
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

function WeekBadge({ count, total = 5 }) {
  // Color reflects completeness vs the elapsed week so far:
  // perfect attendance is always green regardless of which day it is.
  const tone =
    total === 0 ? "bg-zinc-100 text-zinc-500 ring-zinc-200"
    : count >= total ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : count >= total - 1 && total >= 2 ? "bg-amber-50 text-amber-800 ring-amber-200"
    : count > 0 ? "bg-rose-50 text-rose-700 ring-rose-200"
    : "bg-zinc-100 text-zinc-500 ring-zinc-200";
  return (
    <span
      title={`${count} of ${total} working day${total === 1 ? "" : "s"} submitted so far this week`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tone}`}
    >
      {count} / {total}
    </span>
  );
}

function MonthBadge({ count, total, label }) {
  // Same colour ladder as WeekBadge but scaled to the calendar month:
  // green when fully caught up, amber when one workday short, rose
  // otherwise.  The month abbreviation sits above the count so it's clear
  // which calendar month the "<filled> / <total>" ratio refers to.
  const tone =
    total === 0 ? "bg-zinc-100 text-zinc-500 ring-zinc-200"
    : count >= total ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : count >= total - 1 && total >= 2 ? "bg-amber-50 text-amber-800 ring-amber-200"
    : count > 0 ? "bg-rose-50 text-rose-700 ring-rose-200"
    : "bg-zinc-100 text-zinc-500 ring-zinc-200";
  return (
    <span
      title={`${count} of ${total} working day${total === 1 ? "" : "s"} submitted in ${label}`}
      className={`inline-flex flex-col items-center rounded-md px-2 py-0.5 text-[11px] font-semibold leading-tight ring-1 ${tone}`}
    >
      <span className="text-[9px] font-medium uppercase tracking-wide opacity-80">
        {label}
      </span>
      <span>{count} / {total}</span>
    </span>
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
