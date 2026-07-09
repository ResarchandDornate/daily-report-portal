"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  formatPretty,
  formatPrettyWithDay,
  fullName,
  getReportFields,
  todayISO,
} from "@/lib/data";
import { useApplyLeave, useMe, useReports, useSubmitReport } from "@/lib/queries";
import { Table } from "@/components/Table";

const buildEmpty = (fields) =>
  Object.fromEntries(fields.map((f) => [f.key, ""]));

export default function MyReportPage() {
  const [date, setDate] = useState(todayISO());
  const [form, setForm] = useState({});
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  // Submit success/failure is communicated via toast (sonner) at the app root,
  // so we no longer track an `errorMsg` or `saved` flag here.

  const { data: me } = useMe();
  const { data: myReports = [] } = useReports(
    me ? { employee: me.id } : {},
  );
  const submit = useSubmitReport();
  const applyLeave = useApplyLeave();

  const fields = useMemo(
    () => (me ? getReportFields(me.department) : []),
    [me]
  );
  const EMPTY = useMemo(() => buildEmpty(fields), [fields]);

  const sortedReports = useMemo(
    () => [...myReports].sort((a, b) => b.date.localeCompare(a.date)),
    [myReports]
  );

  // After a successful submit we want the form to visually clear so the user
  // sees "saved → blank slate" instead of staring at the values they just
  // submitted.  The reports query re-fetches right after submit and would
  // otherwise repopulate the form via the effect below — so we record the
  // submitted date in a ref and have the effect skip exactly one auto-fill
  // cycle for that date.  When the user later navigates back to that date
  // (or any other date with existing data), normal auto-fill resumes.
  const skipFillForDate = useRef(null);

  useEffect(() => {
    if (!me || fields.length === 0) return;
    if (skipFillForDate.current === date) {
      skipFillForDate.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(EMPTY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsEditingExisting(false);
      return;
    }
    const existing = myReports.find((r) => r.date === date);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(existing ? { ...EMPTY, ...existing.data } : EMPTY);
  }, [date, me, myReports, fields, EMPTY]);

  // Whenever the picked date changes, exit edit mode — the new date may
  // already have a report whose lock the user hasn't opted to bypass yet.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsEditingExisting(false);
  }, [date]);

  function update(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!me) return;
    const cleaned = {};
    let hasAnyContent = false;
    fields.forEach((f) => {
      const v = (form[f.key] || "").trim();
      cleaned[f.key] = v;
      if (v) hasAnyContent = true;
    });
    // Don't submit an entirely empty report — at least one field must have
    // content.  If the employee is on leave, they should use Apply Leave; for
    // a normal report, blank-everything is almost always a mistake.
    if (!hasAnyContent) {
      toast.error("Please fill in at least one field before submitting.");
      return;
    }
    // Success / failure both fire toasts via useSubmitReport's onSuccess/onError.
    try {
      await submit.mutateAsync({ date, data: cleaned });
      // Tell the auto-fill effect to leave the form blank for this date this
      // one time — the user just submitted and wants a clean slate.
      skipFillForDate.current = date;
      setForm(EMPTY);
      // If they were editing an existing report, exit edit mode so the form
      // re-locks after the save.
      setIsEditingExisting(false);
    } catch {
      // Toast already fired in the mutation's onError.
    }
  }

  function clearForm() {
    setForm(EMPTY);
  }

  if (!me) return null;

  const dept = me.department;
  const roleLabel = me.role === "hr" ? "HR" : dept?.name;

  const lastIdx = fields.length - 1;
  const lastIsOdd = fields.length % 2 === 1 && fields.length > 1;

  // Lock the form when a report already exists for this date AND the user
  // isn't HR.  Employees can edit by clicking the "Edit report" button below,
  // which flips `isEditingExisting` and unlocks the fields.  HR users have the
  // form open by default for their own past reports (same as before).
  const existingForDate = myReports.find((r) => r.date === date);
  const isLeaveDay = existingForDate?.data?.__leave__ === "1";
  const isLocked =
    !!existingForDate && me.role !== "hr" && !isEditingExisting;

  // When the picked date is a past day with NO report yet, show a friendly
  // "you're filling in a missed report" banner so employees realise they can
  // backdate without needing HR.
  const isPastDate = date < todayISO();
  const isBackdating = isPastDate && !existingForDate;

  // Is at least one field filled?  Submit is disabled until this is true.
  const hasAnyContent = fields.some(
    (f) => (form[f.key] || "").trim() !== "",
  );

  return (
    <div className="space-y-5">
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight text-zinc-900">My Daily Report</h1>
              <p className="text-[11px] text-zinc-600">
                <span className="font-medium text-zinc-800">{fullName(me)}</span> · {roleLabel} · {me.title}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-2">
              <label htmlFor="date" className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Date
              </label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                // HR / admin: no max — they can pick ANY date (past or
                // future) so they can backfill missed days or pre-create
                // reports.  Regular employees stay capped at today.
                max={me?.role === "hr" ? undefined : todayISO()}
                className="rounded-md border border-orange-200 bg-white px-2.5 py-1 text-xs outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
              />
            </div>
            <p className="text-[10px] text-zinc-500">
              {me?.role === "hr"
                ? "Admin: pick any date — past or future."
                : "Forgot a day? Pick a past date to fill it in."}
            </p>
          </div>
        </div>
      </header>

      {isBackdating && (
        <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] text-sky-900">
          <CalendarIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-700" />
          <div>
            <p className="font-semibold">
              Filling in a missed report for {formatPretty(date)}.
            </p>
            <p className="mt-0.5 text-[11px] text-sky-800">
              No report was submitted that day. Fill the fields below and click Submit — you only get one chance per date, so make sure it&rsquo;s complete before submitting.
            </p>
          </div>
        </div>
      )}

      {isLocked && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <div className="flex-1">
            <p className="font-semibold">
              {isLeaveDay ? "You were on leave this day." : "Already submitted for this date."}
            </p>
            <p className="mt-0.5 text-[11px] text-amber-800">
              Need to update it? Click <span className="font-semibold">Edit report</span> below to make changes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsEditingExisting(true)}
            className="shrink-0 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            Edit report
          </button>
        </div>
      )}

      {isEditingExisting && existingForDate && (
        <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-900">
          <PencilIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-700" />
          <div className="flex-1">
            <p className="font-semibold">Editing your existing report.</p>
            <p className="mt-0.5 text-[11px] text-orange-800">
              Click <span className="font-semibold">Save changes</span> to update, or <span className="font-semibold">Cancel</span> to keep the existing version.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              // Restore the original values and re-lock the form.
              setForm({ ...EMPTY, ...existingForDate.data });
              setIsEditingExisting(false);
            }}
            className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="overflow-hidden rounded-lg border border-orange-100 surface-card">
        <div className="flex items-center gap-2 border-b border-orange-100 bg-brand-strip px-4 py-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-orange-600 text-white">
            <DocIcon className="h-3.5 w-3.5" />
          </span>
          <p className="text-xs font-semibold text-zinc-900">
            Report for <span className="text-orange-700">{formatPretty(date)}</span>
            {isLocked && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200">
                <LockIcon className="h-2.5 w-2.5" /> Locked
              </span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 divide-y divide-zinc-100 bg-stone-50/40 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {fields.map((field, i) => (
            <Field
              key={field.key}
              index={i}
              label={field.label}
              value={form[field.key] || ""}
              onChange={(v) => update(field.key, v)}
              disabled={isLocked}
              span={lastIsOdd && i === lastIdx ? "lg:col-span-2 lg:border-t lg:border-zinc-100" : ""}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-orange-100 bg-brand-strip px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-600">
            <InfoIcon className="h-3.5 w-3.5 text-orange-600" />
            {isLocked
              ? "Only HR can edit a submitted report."
              : "Reports save to the server. You can submit only once per date — HR can edit later if needed."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLeaveOpen(true)}
              disabled={isLocked}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PalmIcon className="h-3.5 w-3.5" />
              Apply Leave
            </button>
            <button
              type="button"
              onClick={clearForm}
              disabled={isLocked}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={submit.isPending || isLocked || !hasAnyContent}
              title={!hasAnyContent ? "Fill at least one field before submitting" : undefined}
              className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-orange-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submit.isPending
                ? "Saving…"
                : isEditingExisting
                ? "Save changes"
                : "Submit report"}
            </button>
          </div>
        </div>
      </form>

      {leaveOpen && (
        <LeaveModal
          defaultStart={date}
          pending={applyLeave.isPending}
          onClose={() => setLeaveOpen(false)}
          onSubmit={async ({ startDate, days, reason }) => {
            try {
              await applyLeave.mutateAsync({
                start_date: startDate,
                days,
                reason,
              });
              setLeaveOpen(false);
            } catch {
              // toast already fired
            }
          }}
        />
      )}

      {/* History */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900">My past submissions</h2>
        <Table maxHeight={420}>
          <Table.Head>
            <Table.Row>
              <Table.Th className="w-12 text-center">#</Table.Th>
              <Table.Th className="min-w-27.5 whitespace-nowrap">Date</Table.Th>
              {fields.map((f) => (
                <Table.Th key={f.key} className="min-w-60">{f.label}</Table.Th>
              ))}
              <Table.Th className="w-20 whitespace-nowrap text-right">Actions</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {sortedReports.length === 0 ? (
              <Table.Empty colSpan={3 + fields.length} message="No reports yet. Fill in the form above to get started." />
            ) : (
              sortedReports.map((r, i) => {
                // Leave rows collapse into a single red "Absent" cell so the
                // employee doesn't see their own "On Leave" repeated across
                // every field column.
                const isLeave = r.data?.__leave__ === "1";
                return (
                <Table.Row key={r.id}>
                  <Table.Td className="text-center align-top font-medium text-zinc-500">{i + 1}</Table.Td>
                  <Table.Td className="whitespace-nowrap align-top font-medium text-zinc-800">
                    {formatPrettyWithDay(r.date)}
                  </Table.Td>
                  {isLeave ? (
                    <Table.Td colSpan={fields.length} className="align-top">
                      <span className="font-bold text-rose-600">Absent</span>
                    </Table.Td>
                  ) : (
                    fields.map((f) => (
                      <Table.Td key={f.key} className="min-w-60 align-top text-zinc-700">
                        {r.data?.[f.key] || "—"}
                      </Table.Td>
                    ))
                  )}
                  <Table.Td className="align-top text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setDate(r.date);
                        setIsEditingExisting(true);
                        // Scroll the form into view so the user sees the
                        // edit banner + fields right away.
                        if (typeof window !== "undefined") {
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 hover:bg-orange-100"
                    >
                      <PencilIcon className="h-3 w-3" />
                      Edit
                    </button>
                  </Table.Td>
                </Table.Row>
                );
              })
            )}
          </Table.Body>
        </Table>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, span = "", index = 0, disabled = false }) {
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
        disabled={disabled}
        placeholder={disabled ? "" : `Add ${label.toLowerCase()}…`}
        className={`mt-1.5 block w-full resize-y rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs leading-relaxed outline-none transition placeholder:text-zinc-400 focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500/20 ${
          disabled
            ? "cursor-not-allowed bg-zinc-100 text-zinc-600"
            : "bg-stone-50/60 text-zinc-900"
        }`}
      />
    </div>
  );
}

function CalendarIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </svg>
  );
}

function LockIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function PencilIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function LeaveModal({ defaultStart, pending, onClose, onSubmit }) {
  const [startDate, setStartDate] = useState(defaultStart || todayISO());
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (days < 1) return;
    onSubmit({ startDate, days: Number(days), reason: reason.trim() });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">Leave</p>
            <h2 className="mt-0.5 text-base font-semibold text-zinc-900">Apply for Leave</h2>
            <p className="text-[11px] text-zinc-600">
              We&rsquo;ll mark every day in the range as &quot;On Leave&quot; in your daily reports.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-900"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18 18 6" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                From
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Days
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Reason
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Family function, medical, personal…"
              className="mt-1 block w-full resize-y rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || days < 1}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {pending ? "Applying…" : `Apply ${Number(days) || 0} day(s)`}
          </button>
        </div>
      </form>
    </div>
  );
}

function PalmIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 22V12" />
      <path d="M12 12c0-3 2-5 5-5s4 2 3 4" />
      <path d="M12 12c0-3-2-5-5-5s-4 2-3 4" />
      <path d="M12 12c-1-3-4-4-7-2" />
      <path d="M12 12c1-3 4-4 7-2" />
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
