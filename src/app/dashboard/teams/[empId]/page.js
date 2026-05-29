"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  formatPretty,
  fullName,
  getReportFields,
  todayISO,
} from "@/lib/data";
import { useEmployee, useMe, useReports, useSubmitReport } from "@/lib/queries";

const buildEmpty = (fields) =>
  Object.fromEntries(fields.map((f) => [f.key, ""]));

export default function TeamMemberReportPage() {
  const params = useParams();
  const router = useRouter();
  const empId = Number(params.empId);

  const { data: me } = useMe();
  const { data: employee, isLoading: empLoading } = useEmployee(empId);
  const { data: empReports = [] } = useReports({ employee: empId });
  const submit = useSubmitReport();

  const [date, setDate] = useState(todayISO());
  const [form, setForm] = useState({});

  const fields = useMemo(
    () => (employee ? getReportFields(employee.department) : []),
    [employee]
  );
  const EMPTY = useMemo(() => buildEmpty(fields), [fields]);

  // Auto-fill the form with the existing report when the picked date already
  // has one — same UX as My Daily Report.
  useEffect(() => {
    if (!employee || fields.length === 0) return;
    const existing = empReports.find((r) => r.date === date);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(existing ? { ...EMPTY, ...existing.data } : EMPTY);
  }, [date, employee, empReports, fields, EMPTY]);

  if (empLoading || !me) return null;

  // Authorisation guard — only HR or a team-head whose MANAGED department
  // matches the target's department can submit reports on behalf of someone
  // else.  Managed dept is `team_head_dept` (slug) when set, otherwise the
  // team head's own department.  Mirrors the backend check.
  const isHR = me.role === "hr";
  const managedSlug = me.team_head_dept || me.department?.slug || null;
  const inManagedDept =
    managedSlug != null && employee?.department?.slug === managedSlug;
  const allowed = isHR || (me.is_team_head && inManagedDept);

  if (!employee) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900">
        <h2 className="text-sm font-semibold">Employee not found</h2>
        <p className="mt-1 text-xs">No employee with id {params.empId}.</p>
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900">
        <h2 className="text-sm font-semibold">Not authorised</h2>
        <p className="mt-1 text-xs">
          You can only file reports for colleagues in your own department.
        </p>
      </div>
    );
  }

  const existingForDate = empReports.find((r) => r.date === date);
  const isLeaveDay = existingForDate?.data?.__leave__ === "1";

  function update(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const cleaned = {};
    let hasAnyContent = false;
    fields.forEach((f) => {
      const v = (form[f.key] || "").trim();
      cleaned[f.key] = v;
      if (v) hasAnyContent = true;
    });
    if (!hasAnyContent) {
      // Re-use the same UX: at least one field needs a value.
      alert("Please fill in at least one field before submitting.");
      return;
    }
    try {
      // Pass user_id so the backend writes against the colleague's row.
      await submit.mutateAsync({ date, data: cleaned, user_id: empId });
      // After success, route back to Teams so the team head sees the
      // updated "Today" / "Reports this week" counters.
      router.push("/dashboard/teams");
    } catch {
      /* toast already fired by the mutation onError */
    }
  }

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Link href="/dashboard/teams" className="hover:text-orange-700">Teams</Link>
        <span>/</span>
        <span className="text-zinc-700">{fullName(employee)}</span>
      </nav>

      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="leading-tight">
            <h1 className="text-base font-semibold tracking-tight text-zinc-900">
              Submitting on behalf of{" "}
              <span className="text-orange-700">{fullName(employee)}</span>
            </h1>
            <p className="text-[11px] text-zinc-600">
              {employee.department?.name || "—"} · {employee.title || ""} · {employee.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="date" className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Date
            </label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayISO()}
              className="rounded-md border border-orange-200 bg-white px-2.5 py-1 text-xs outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
            />
          </div>
        </div>
      </header>

      {existingForDate && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          {isLeaveDay ? (
            <span>
              <strong>{fullName(employee)} was on leave this day.</strong> Save anyway
              to overwrite the leave with a regular report, or pick a different date.
            </span>
          ) : (
            <span>
              <strong>A report already exists for this date.</strong> Submitting will
              overwrite the existing values for {fullName(employee)}.
            </span>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="overflow-hidden rounded-lg border border-orange-100 surface-card">
        <div className="flex items-center gap-2 border-b border-orange-100 bg-brand-strip px-4 py-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-orange-600 text-white">
            <DocIcon className="h-3.5 w-3.5" />
          </span>
          <p className="text-xs font-semibold text-zinc-900">
            Report for <span className="text-orange-700">{formatPretty(date)}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 divide-y divide-zinc-100 bg-stone-50/40 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {fields.length === 0 ? (
            <div className="col-span-full p-4 text-center text-[12px] text-zinc-500">
              This department hasn&rsquo;t configured any report fields yet — ask HR to set them up.
            </div>
          ) : (
            fields.map((field, i) => (
              <Field
                key={field.key}
                index={i}
                label={field.label}
                value={form[field.key] || ""}
                onChange={(v) => update(field.key, v)}
              />
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-orange-100 bg-brand-strip px-4 py-3">
          <p className="text-[11px] text-zinc-600">
            Filing as <strong>{fullName(me)}</strong> on behalf of <strong>{fullName(employee)}</strong>.
          </p>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/teams"
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submit.isPending || fields.length === 0}
              className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-orange-700 disabled:opacity-60"
            >
              {submit.isPending ? "Saving…" : existingForDate ? "Save changes" : "Submit report"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, index = 0 }) {
  return (
    <div className="bg-white p-4 transition hover:bg-stone-50/60">
      <label className="flex items-center gap-2 text-xs font-medium text-zinc-700">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-orange-50 text-[10px] font-semibold text-orange-700 ring-1 ring-orange-100">
          {index + 1}
        </span>
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={`Add ${label.toLowerCase()}…`}
        className="mt-1.5 block w-full resize-y rounded-md border border-zinc-200 bg-stone-50/60 px-2.5 py-1.5 text-xs leading-relaxed text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500/20"
      />
    </div>
  );
}

function DocIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}
