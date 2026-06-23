"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatPretty, todayISO } from "@/lib/data";
import {
  useCreateExpense,
  useDecideExpense,
  useDeleteExpense,
  useExpenses,
  useMe,
} from "@/lib/queries";
import { Table } from "@/components/Table";

// Hardcoded server-side: TARINI + SMITA + any HR can approve.  Mirrored here
// for the helper-text banner only — the API still gates the decision call.
const APPROVER_LABEL = "Tarini & Smita";

// Order is intentional — matches HR's preferred sequence on the form, NOT
// alphabetical.  Reorder here whenever the business wants it changed.
const EXPENSE_TYPES = [
  { value: "travel",           label: "Travel" },
  { value: "fuel",             label: "Fuel" },
  { value: "material",         label: "Material" },
  { value: "hotel",            label: "Hotel" },
  { value: "officereimburse",  label: "Office Reimburse" },
  { value: "others",           label: "Others" },
];

// Top-level travel choices.  "other" opens a second sub-dropdown for the
// less-common modes (bus / auto / metro).
const TRAVEL_TYPES = [
  { value: "car",    label: "Car" },
  { value: "bike",   label: "Bike" },
  { value: "cab",    label: "Cab" },
  { value: "rapido", label: "Rapido" },
  { value: "other",  label: "Others" },
];

const TRAVEL_SUBTYPES = [
  { value: "bus",   label: "Bus" },
  { value: "auto",  label: "Auto" },
  { value: "metro", label: "Metro" },
];

// Per-km reimbursement rate (₹) for vehicles where the company pays by
// distance.  0 = no preset, employee fills in.
const PER_KM_RATES = {
  car:    10,
  bike:   5,
  cab:    0,
  rapido: 0,
};

const KM_BASED_TYPES = new Set(["car", "bike", "cab", "rapido"]);

const MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi",  label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank Transfer" },
  { value: "other", label: "Other" },
];

const APPROVER_EMAILS = new Set([
  "tarini@ornatesolar.com",
  "smita@ornatesolar.com",
]);

export default function ExpensePage() {
  const { data: me } = useMe();
  const isAdmin = useMemo(() => {
    if (!me) return false;
    if (me.role === "hr") return true;
    return APPROVER_EMAILS.has((me.email || "").trim().toLowerCase());
  }, [me]);

  const { data: expenses = [], isLoading } = useExpenses();
  const createExpense = useCreateExpense();
  const decideExpense = useDecideExpense();
  const deleteExpense = useDeleteExpense();

  const [openModal, setOpenModal] = useState(null); // null | expense row

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-700 ring-1 ring-orange-200">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              Expenses
            </span>
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight text-zinc-900">
                {isAdmin ? "Expense approvals" : "My Expenses"}
              </h1>
              <p className="text-[11px] text-zinc-600">
                {isAdmin
                  ? `Review and decide expense claims submitted across the company.`
                  : `Submit an expense — it goes to ${APPROVER_LABEL} for approval.`}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Employee form — admins can also submit. */}
      <ExpenseForm onSubmit={async (payload) => {
        try {
          await createExpense.mutateAsync(payload);
        } catch {
          /* toast fired by hook */
        }
      }} submitting={createExpense.isPending} />

      {/* Expense table */}
      <ExpenseTable
        rows={expenses}
        isLoading={isLoading}
        isAdmin={isAdmin}
        onOpen={(row) => setOpenModal(row)}
      />

      {openModal && (
        <ExpenseModal
          row={openModal}
          isAdmin={isAdmin}
          onClose={() => setOpenModal(null)}
          onDecide={async (decision, note) => {
            try {
              await decideExpense.mutateAsync({ id: openModal.id, decision, note });
              setOpenModal(null);
            } catch {}
          }}
          onDelete={async () => {
            if (!confirm(`Delete this expense? This cannot be undone.`)) return;
            try {
              await deleteExpense.mutateAsync(openModal.id);
              setOpenModal(null);
            } catch {}
          }}
          decidePending={decideExpense.isPending}
          deletePending={deleteExpense.isPending}
        />
      )}
    </div>
  );
}

function ExpenseForm({ onSubmit, submitting }) {
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState("cash");
  const [expenseType, setExpenseType] = useState("material");
  // Two-level travel selection.  travelType holds the top-level pick
  // (car / bike / cab / rapido / other).  travelSubtype is only used
  // when travelType === "other"; its value (bus / auto / metro) is what
  // actually gets sent to the API as the final travel_type.
  const [travelType, setTravelType] = useState("");
  const [travelSubtype, setTravelSubtype] = useState("");
  // Distance + rate inputs, only relevant for car / bike / cab / rapido.
  // Defaults fill in from PER_KM_RATES when travelType changes.
  const [kilometers, setKilometers] = useState("");
  const [ratePerKm, setRatePerKm] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [bills, setBills] = useState([]);        // File[]
  const [previews, setPreviews] = useState([]);  // { name, url|null }[]

  // Reset every travel-only field when switching away from travel.
  useEffect(() => {
    if (expenseType !== "travel") {
      if (travelType) setTravelType("");
      if (travelSubtype) setTravelSubtype("");
      if (kilometers) setKilometers("");
      if (ratePerKm) setRatePerKm("");
    }
  }, [expenseType]); // eslint-disable-line react-hooks/exhaustive-deps

  // When travel type changes, pre-fill rate (Bike ₹5, Car ₹10; Cab/Rapido
  // stay editable from 0), clear the distance, and reset the sub-type if
  // we've moved away from "Others".
  useEffect(() => {
    if (KM_BASED_TYPES.has(travelType)) {
      setRatePerKm(String(PER_KM_RATES[travelType] ?? 0));
      setKilometers("");
    } else {
      setRatePerKm("");
      setKilometers("");
    }
    if (travelType !== "other" && travelSubtype) {
      setTravelSubtype("");
    }
  }, [travelType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-compute amount = km × rate whenever either changes.  Users can
  // still type a custom amount afterwards; the next km/rate change will
  // re-overwrite it (that's the trade-off for keeping the auto-fill simple).
  useEffect(() => {
    if (!KM_BASED_TYPES.has(travelType)) return;
    const km = parseFloat(kilometers);
    const rate = parseFloat(ratePerKm);
    if (Number.isFinite(km) && Number.isFinite(rate) && km >= 0 && rate >= 0) {
      const computed = Math.round(km * rate);
      setAmount(String(computed));
    }
  }, [kilometers, ratePerKm, travelType]);

  // Build object-URL previews for any image bills.  PDFs / other files
  // render as a name-only card with no `url`.  Cleaned up on unmount or
  // whenever the selection changes.
  useEffect(() => {
    if (!bills.length) { setPreviews([]); return; }
    const next = bills.map((f) => ({
      name: f.name,
      url: f.type?.startsWith("image/") ? URL.createObjectURL(f) : null,
    }));
    setPreviews(next);
    return () => {
      for (const p of next) {
        if (p.url) URL.revokeObjectURL(p.url);
      }
    };
  }, [bills]);

  function addFiles(fileList) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    if (!incoming.length) return;
    // De-dup by (name, size) so picking the same file twice doesn't
    // attach it twice.
    setBills((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      // Cap at 10 to match the server limit; warn if dropped.
      if (merged.length > 10) {
        toast.error("Max 10 bills per expense — extras were dropped.");
        return merged.slice(0, 10);
      }
      return merged;
    });
  }

  function removeBillAt(idx) {
    setBills((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const amt = parseInt(amount, 10);
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Amount must be a non-negative number.");
      return;
    }
    let finalTravelType = "";
    if (expenseType === "travel") {
      if (!travelType) {
        toast.error("Pick a travel type (car, bike, cab, rapido, or others).");
        return;
      }
      if (travelType === "other") {
        if (!travelSubtype) {
          toast.error("Pick the sub-mode (bus, auto, metro).");
          return;
        }
        finalTravelType = travelSubtype;
      } else {
        finalTravelType = travelType;
      }
    }

    // Audit prefix on km-based travel — gives the approver a clear breakdown
    // of how the amount was derived (km × rate).
    let finalRemarks = remarks.trim();
    if (KM_BASED_TYPES.has(travelType) && kilometers && ratePerKm) {
      const audit = `${kilometers} km × ₹${ratePerKm}/km = ₹${amt}`;
      finalRemarks = finalRemarks ? `${audit} — ${finalRemarks}` : audit;
    }

    onSubmit({
      date,
      mode,
      expense_type: expenseType,
      travel_type: finalTravelType,
      amount: amt,
      remarks: finalRemarks,
      bills,
    }).then(() => {
      // Reset form on success — keep date so multiple same-day submissions
      // are fast.
      setAmount("");
      setRemarks("");
      setBills([]);
      setKilometers("");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-zinc-200 bg-white p-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-zinc-900">New expense</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Date">
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value || todayISO())}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Payment Mode">
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Expense Type">
          <select
            value={expenseType}
            onChange={(e) => setExpenseType(e.target.value)}
            className={inputClass}
            required
          >
            {EXPENSE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        {expenseType === "travel" && (
          <Field label="Travel Type">
            <select
              value={travelType}
              onChange={(e) => setTravelType(e.target.value)}
              className={inputClass}
              required
            >
              <option value="">Select…</option>
              {TRAVEL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
        )}
        {expenseType === "travel" && travelType === "other" && (
          <Field label="Sub-mode">
            <select
              value={travelSubtype}
              onChange={(e) => setTravelSubtype(e.target.value)}
              className={inputClass}
              required
            >
              <option value="">Select…</option>
              {TRAVEL_SUBTYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
        )}
        {expenseType === "travel" && KM_BASED_TYPES.has(travelType) && (
          <>
            <Field label="Distance (km)">
              <input
                type="number"
                min={0}
                step="0.1"
                value={kilometers}
                onChange={(e) => setKilometers(e.target.value)}
                placeholder="0"
                className={inputClass}
                required
              />
            </Field>
            <Field label="Rate (₹ / km)">
              <input
                type="number"
                min={0}
                step="0.5"
                value={ratePerKm}
                onChange={(e) => setRatePerKm(e.target.value)}
                placeholder="0"
                className={inputClass}
                required
              />
            </Field>
          </>
        )}
        <Field label="Amount (₹)">
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className={inputClass}
            required
          />
        </Field>
        <Field label="Bills / Receipts (up to 10 — image or PDF)">
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={(e) => {
              addFiles(e.target.files);
              // Reset the input so the same file can be re-picked after
              // being removed.
              e.target.value = "";
            }}
            className={`${inputClass} cursor-pointer file:mr-2 file:rounded-sm file:border-0 file:bg-orange-100 file:px-2 file:py-0.5 file:text-[11px] file:font-medium file:text-orange-800 hover:file:bg-orange-200`}
          />
          {previews.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {previews.map((p, idx) => (
                <div
                  key={`${p.name}-${idx}`}
                  className="group relative h-16 w-16 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
                  title={p.name}
                >
                  {p.url ? (
                    <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-zinc-500">
                      PDF
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeBillAt(idx)}
                    className="absolute right-0.5 top-0.5 rounded-full bg-zinc-900/70 px-1.5 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Remove ${p.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {bills.length > 0 && (
            <p className="mt-1 text-[10px] text-zinc-500">
              {bills.length} file{bills.length === 1 ? "" : "s"} selected — click ✕ on a thumbnail to remove.
            </p>
          )}
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Remarks">
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              placeholder="What was this for?"
              className={`${inputClass} resize-y`}
            />
          </Field>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Submit expense"}
        </button>
      </div>
    </form>
  );
}

function ExpenseTable({ rows, isLoading, isAdmin, onOpen }) {
  return (
    <Table maxHeight={520}>
      <Table.Head>
        <Table.Row>
          <Table.Th>Date</Table.Th>
          {isAdmin && <Table.Th>Employee</Table.Th>}
          <Table.Th>Type</Table.Th>
          <Table.Th>Mode</Table.Th>
          <Table.Th className="text-right">Amount</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Remarks</Table.Th>
          <Table.Th />
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {isLoading ? (
          <Table.Empty colSpan={isAdmin ? 8 : 7} message="Loading expenses…" />
        ) : rows.length === 0 ? (
          <Table.Empty
            colSpan={isAdmin ? 8 : 7}
            message={isAdmin ? "No expenses to review yet." : "You haven't submitted any expenses yet."}
          />
        ) : (
          rows.map((r) => (
            <Table.Row
              key={r.id}
              onClick={() => onOpen(r)}
              className="cursor-pointer hover:bg-zinc-50"
            >
              <Table.Td className="whitespace-nowrap">{formatPretty(r.date)}</Table.Td>
              {isAdmin && (
                <Table.Td>
                  <div className="font-medium text-zinc-900">{r.user_name || "—"}</div>
                  {r.user_department && (
                    <div className="text-[10px] text-zinc-500">{r.user_department}</div>
                  )}
                </Table.Td>
              )}
              <Table.Td>
                <span className="capitalize">{r.expense_type}</span>
                {r.travel_type && (
                  <span className="text-[10px] text-zinc-500"> · {r.travel_type}</span>
                )}
              </Table.Td>
              <Table.Td className="capitalize">{r.mode || "—"}</Table.Td>
              <Table.Td className="text-right tabular-nums font-medium">
                ₹{(r.amount || 0).toLocaleString("en-IN")}
              </Table.Td>
              <Table.Td>
                <StatusPill status={r.status} />
              </Table.Td>
              <Table.Td className="max-w-[260px] truncate text-zinc-600" title={r.remarks}>
                {r.remarks || "—"}
              </Table.Td>
              <Table.Td className="text-right">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600">
                  Open →
                </span>
              </Table.Td>
            </Table.Row>
          ))
        )}
      </Table.Body>
    </Table>
  );
}

function StatusPill({ status }) {
  const cls =
    status === "approved" ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : status === "rejected" ? "bg-rose-50 text-rose-700 ring-rose-200"
    : "bg-amber-50 text-amber-800 ring-amber-200";
  const label = status === "approved" ? "Approved"
    : status === "rejected" ? "Rejected"
    : "Pending";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${cls}`}>
      {label}
    </span>
  );
}

function ExpenseModal({ row, isAdmin, onClose, onDecide, onDelete, decidePending, deletePending }) {
  // billUrls[i] = blob URL for row.bills[i] once fetched, or null while loading.
  const [billUrls, setBillUrls] = useState([]);
  const [openBillIndex, setOpenBillIndex] = useState(-1);  // -1 = closed

  // Fetch each attached bill in parallel as Blob URLs so previews + the
  // full-screen viewer load without exposing the storage backend.  All URLs
  // are revoked on unmount / when the expense changes.
  useEffect(() => {
    const bills = row?.bills || [];
    if (!bills.length) { setBillUrls([]); return; }
    let cancelled = false;
    const created = new Array(bills.length).fill(null);
    setBillUrls(new Array(bills.length).fill(null));
    (async () => {
      const { api } = await import("@/lib/api");
      await Promise.all(bills.map(async (b, idx) => {
        try {
          const resp = await api.get(`/api/expenses/${row.id}/bill/${idx}`, {
            responseType: "blob",
          });
          if (cancelled) return;
          created[idx] = URL.createObjectURL(resp.data);
        } catch {
          /* leave null — card still renders by filename */
        }
      }));
      if (!cancelled) setBillUrls([...created]);
    })();
    return () => {
      cancelled = true;
      for (const u of created) {
        if (u) URL.revokeObjectURL(u);
      }
    };
  }, [row]);

  if (!row) return null;
  const bills = row.bills || [];
  function billKind(filename) {
    const isImage = /\.(jpg|jpeg|png|webp|heic)$/i.test(filename || "");
    const isPdf   = /\.pdf$/i.test(filename || "");
    return { isImage, isPdf };
  }
  const openBill = openBillIndex >= 0 ? bills[openBillIndex] : null;
  const openBillUrl = openBillIndex >= 0 ? billUrls[openBillIndex] : null;
  const openBillKind = openBill ? billKind(openBill.filename) : { isImage: false, isPdf: false };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 bg-orange-50 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Expense details</h3>
            <p className="text-[11px] text-zinc-500">
              {row.user_name} · {formatPretty(row.date)} · ₹{(row.amount || 0).toLocaleString("en-IN")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-4 text-[12px] sm:grid-cols-3">
            <KV k="Status"><StatusPill status={row.status} /></KV>
            <KV k="Type">
              <span className="capitalize">{row.expense_type}</span>
              {row.travel_type && (
                <span className="ml-1 text-zinc-500">({row.travel_type})</span>
              )}
            </KV>
            <KV k="Mode" className="capitalize">{row.mode || "—"}</KV>
            <KV k="Department">{row.user_department || "—"}</KV>
            <KV k="Submitted">{formatPretty(row.created_at?.slice?.(0, 10) || row.date)}</KV>
            {row.decided_at && (
              <KV k="Decided by">{row.decided_by_name || "—"}</KV>
            )}
          </div>

          <KV k="Remarks" full className="mt-3">
            {row.remarks || <span className="text-zinc-400">—</span>}
          </KV>

          {row.decision_note && (
            <KV k={`${row.status === "approved" ? "Approver" : "Reviewer"} note`} full className="mt-2">
              {row.decision_note}
            </KV>
          )}

          {/* Bills section — one card per attached file; click any to open. */}
          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Attached bills {bills.length > 0 && (
                <span className="text-zinc-400">({bills.length})</span>
              )}
            </div>
            {bills.length > 0 ? (
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {bills.map((b, idx) => {
                  const { isImage, isPdf } = billKind(b.filename);
                  const url = billUrls[idx];
                  return (
                    <button
                      type="button"
                      key={`${b.filename}-${idx}`}
                      onClick={() => setOpenBillIndex(idx)}
                      className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-left hover:border-orange-300 hover:bg-orange-50"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-zinc-200">
                        {isImage && url ? (
                          <img src={url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xl">{isPdf ? "📄" : "📎"}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-zinc-900">
                          {b.filename || `Bill ${idx + 1}`}
                        </div>
                        <div className="text-[11px] text-orange-700">Click to preview</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] text-zinc-500">No bills attached.</p>
            )}
          </div>

        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 bg-stone-50 px-4 py-3">
          <button
            type="button"
            onClick={onDelete}
            disabled={deletePending}
            className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
          >
            {deletePending ? "Deleting…" : "Delete"}
          </button>
          {isAdmin && row.status === "pending" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onDecide("rejected", "")}
                disabled={decidePending}
                className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {decidePending ? "…" : "Reject"}
              </button>
              <button
                type="button"
                onClick={() => onDecide("approved", "")}
                disabled={decidePending}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {decidePending ? "…" : "Approve"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bill preview sub-modal — opens for whichever bill card was clicked.
          Supports prev/next navigation when an expense has multiple bills. */}
      {openBillIndex >= 0 && openBill && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/70 p-4"
          onClick={() => setOpenBillIndex(-1)}
        >
          <div
            className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-lg bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute left-2 top-2 z-10 max-w-[60%] truncate rounded-md bg-zinc-900/60 px-2 py-1 text-xs font-medium text-white">
              {openBill.filename || `Bill ${openBillIndex + 1}`}
              {bills.length > 1 && (
                <span className="ml-1.5 opacity-80">
                  ({openBillIndex + 1} of {bills.length})
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpenBillIndex(-1)}
              className="absolute right-2 top-2 z-10 rounded-md bg-zinc-900/60 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-900/80"
            >
              Close
            </button>
            {bills.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setOpenBillIndex((i) => (i - 1 + bills.length) % bills.length)}
                  className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-zinc-900/60 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-900/80"
                  aria-label="Previous bill"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setOpenBillIndex((i) => (i + 1) % bills.length)}
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-zinc-900/60 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-900/80"
                  aria-label="Next bill"
                >
                  ›
                </button>
              </>
            )}
            {openBillUrl ? (
              openBillKind.isPdf ? (
                <iframe src={openBillUrl} className="h-[80vh] w-[80vw]" title="Bill" />
              ) : (
                <img src={openBillUrl} alt="Bill" className="max-h-[85vh] max-w-[90vw] object-contain" />
              )
            ) : (
              <div className="p-6 text-sm text-zinc-600">Loading…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function KV({ k, children, full = false, className = "" }) {
  return (
    <div className={`${full ? "col-span-full" : ""} ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {k}
      </div>
      <div className="mt-0.5 text-xs text-zinc-900">{children}</div>
    </div>
  );
}

const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20";
