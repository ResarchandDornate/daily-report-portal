"use client";

import { useEffect, useMemo, useState } from "react";
import {
  REPORT_FIELDS,
  departmentById,
  formatPretty,
  loadCurrentUser,
  loadReports,
  todayISO,
  upsertReport,
} from "@/lib/data";
import { Table } from "@/components/Table";

const EMPTY = {
  workDone: "",
  workInProgress: "",
  upcomingPriorities: "",
  challenges: "",
  otherUpdate: "",
};

export default function MyReportPage() {
  const [user, setUser] = useState(null);
  const [reports, setReports] = useState([]);
  const [date, setDate] = useState(todayISO());
  const [form, setForm] = useState(EMPTY);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setUser(loadCurrentUser());
    setReports(loadReports());
  }, []);

  const myReports = useMemo(
    () =>
      user
        ? [...reports]
            .filter((r) => r.employeeId === user.id)
            .sort((a, b) => b.date.localeCompare(a.date))
        : [],
    [reports, user]
  );

  useEffect(() => {
    if (!user) return;
    const existing = reports.find((r) => r.employeeId === user.id && r.date === date);
    setForm(existing ? { ...EMPTY, ...existing } : EMPTY);
    setSaved(false);
  }, [date, user, reports]);

  function update(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
    setSaved(false);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!user) return;
    const entry = {
      id: `${user.id}-${date}`,
      employeeId: user.id,
      date,
      ...form,
      submittedAt: new Date().toISOString(),
    };
    const updated = upsertReport(entry);
    setReports(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function clearForm() {
    setForm(EMPTY);
  }

  if (!user) return null;

  const dept = departmentById(user.department);
  const roleLabel = user.role === "hr" ? "HR" : dept?.name;

  return (
    <div className="space-y-5">
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-700 ring-1 ring-orange-200">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              My Report
            </span> */}
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight text-zinc-900">My Daily Report</h1>
              <p className="text-[11px] text-zinc-600">
                <span className="font-medium text-zinc-800">{user.name}</span> · {roleLabel} · {user.title}
              </p>
            </div>
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

      <form onSubmit={handleSubmit} className="overflow-hidden rounded-lg border border-orange-100 surface-card">
        {/* Branded form header */}
        <div className="flex items-center gap-2 border-b border-orange-100 bg-brand-strip px-4 py-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-orange-600 text-white">
            <DocIcon className="h-3.5 w-3.5" />
          </span>
          <p className="text-xs font-semibold text-zinc-900">
            Report for <span className="text-orange-700">{formatPretty(date)}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 divide-y divide-zinc-100 bg-stone-50/40 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {REPORT_FIELDS.map((field, i) => (
            <Field
              key={field.key}
              index={i}
              label={field.label}
              value={form[field.key]}
              onChange={(v) => update(field.key, v)}
              span={i === 4 ? "lg:col-span-2 lg:border-t lg:border-zinc-100" : ""}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-orange-100 bg-brand-strip px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-600">
            <InfoIcon className="h-3.5 w-3.5 text-orange-600" />
            Reports save locally to your browser. Submitting overwrites any previous entry for this date.
          </p>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                <CheckIcon className="h-3 w-3" />
                Saved
              </span>
            )}
            <button
              type="button"
              onClick={clearForm}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Clear
            </button>
            <button
              type="submit"
              className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-orange-700"
            >
              Submit report
            </button>
          </div>
        </div>
      </form>

      {/* History */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900">My past submissions</h2>
        <Table maxHeight={420}>
          <Table.Head>
            <Table.Row>
              <Table.Th className="w-12 text-center">#</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th>Work Done</Table.Th>
              <Table.Th>In Progress</Table.Th>
              <Table.Th>Priorities</Table.Th>
              <Table.Th>Challenges</Table.Th>
              <Table.Th>Other</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {myReports.length === 0 ? (
              <Table.Empty colSpan={7} message="No reports yet. Fill in the form above to get started." />
            ) : (
              myReports.map((r, i) => (
                <Table.Row key={r.id}>
                  <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                  <Table.Td className="whitespace-nowrap align-top font-medium text-zinc-800">
                    {formatPretty(r.date)}
                  </Table.Td>
                  <Table.Td className="align-top text-zinc-700">{r.workDone || "—"}</Table.Td>
                  <Table.Td className="align-top text-zinc-700">{r.workInProgress || "—"}</Table.Td>
                  <Table.Td className="align-top text-zinc-700">{r.upcomingPriorities || "—"}</Table.Td>
                  <Table.Td className="align-top text-zinc-700">{r.challenges || "—"}</Table.Td>
                  <Table.Td className="align-top text-zinc-700">{r.otherUpdate || "—"}</Table.Td>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, span = "", index = 0 }) {
  return (
    <div className={`bg-white p-4 transition hover:bg-stone-50/60 ${span}`}>
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

function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L9 11.6l6.3-6.3a1 1 0 0 1 1.4 0Z" />
    </svg>
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

function InfoIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
