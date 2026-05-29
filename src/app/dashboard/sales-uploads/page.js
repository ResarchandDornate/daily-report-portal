"use client";

import { useMemo, useRef, useState } from "react";
import { formatPretty, shiftDays, todayISO } from "@/lib/data";
import {
  useDeleteSalesSheet,
  useDownloadSalesSheet,
  useMe,
  useSalesUploads,
  useUploadSalesSheet,
} from "@/lib/queries";

export default function SalesUploadsPage() {
  const { data: me } = useMe();
  const isHR = me?.role === "hr";
  const canUpload =
    isHR || ["insideSales", "salesService"].includes(me?.department?.slug);

  const { data: uploads = [], isLoading } = useSalesUploads();
  const upload = useUploadSalesSheet();
  const remove = useDeleteSalesSheet();
  const download = useDownloadSalesSheet();

  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [periodType, setPeriodType] = useState("weekly");
  const [periodStart, setPeriodStart] = useState(shiftDays(todayISO(), -6));
  const [periodEnd, setPeriodEnd] = useState(todayISO());
  const [note, setNote] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  async function submitUpload(e) {
    e.preventDefault();
    if (!file) return;
    try {
      await upload.mutateAsync({
        file,
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        note,
      });
      setFile(null);
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
    } catch {}
  }

  async function handleDownload(id, filename) {
    try {
      // Mutation streams the bytes through FastAPI and triggers a browser-side
      // download.  No URL handling needed here.
      await download.mutateAsync({ id, filename });
    } catch {}
  }

  async function handleDelete(id) {
    if (!confirm("Delete this upload? The file will be removed from storage.")) return;
    try {
      await remove.mutateAsync(id);
    } catch {}
  }

  const sorted = useMemo(
    () =>
      [...uploads].sort((a, b) =>
        (b.uploaded_at || "").localeCompare(a.uploaded_at || ""),
      ),
    [uploads],
  );

  if (!me) return null;

  if (!canUpload && !isHR) {
    return (
      <div className="rounded-md border border-zinc-200 bg-white p-4 text-xs text-zinc-600">
        This page is for Inside Sales employees and HR only.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-lg border border-sky-100 bg-linear-to-br from-sky-50 via-cyan-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-700 ring-1 ring-sky-200">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            Inside Sales
          </span>
          <div className="leading-tight">
            <h1 className="text-base font-semibold tracking-tight text-zinc-900">Sales Calling Sheets</h1>
            <p className="text-[11px] text-zinc-600">
              Upload the weekly / monthly calling Excel. {isHR ? "HR sees every employee's uploads." : "Only you and HR can see your uploads."}
            </p>
          </div>
        </div>
      </header>

      {canUpload && (
        <form onSubmit={submitUpload} className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Upload new sheet</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="sm:col-span-2">
              <label className={labelClass}>Excel file *</label>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs file:mr-2 file:rounded file:border-0 file:bg-sky-600 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-white hover:file:bg-sky-700"
                required
              />
              {file && (
                <p className="mt-1 text-[10px] text-zinc-500">
                  {file.name} · {(file.size / 1024).toFixed(1)} KB
                </p>
              )}
            </div>
            <div>
              <label className={labelClass}>Period</label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value)}
                className={`mt-1 ${inputClass}`}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="adhoc">Ad-hoc</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>From</label>
              <input
                type="date"
                value={periodStart}
                max={periodEnd}
                onChange={(e) => setPeriodStart(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div>
              <label className={labelClass}>To</label>
              <input
                type="date"
                value={periodEnd}
                min={periodStart}
                max={todayISO()}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-5">
              <label className={labelClass}>Note (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Week 19 sheet — includes Pune + Indore leads"
                className={`mt-1 ${inputClass}`}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={!file || upload.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UploadIcon className="h-3.5 w-3.5" />
              {upload.isPending ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-900">
            {isHR ? "All uploads" : "My uploads"}{" "}
            <span className="text-[11px] font-normal text-zinc-500">({sorted.length})</span>
          </h2>
        </div>
        <div className="divide-y divide-zinc-100">
          {isLoading && (
            <p className="px-4 py-6 text-center text-xs text-zinc-500">Loading…</p>
          )}
          {!isLoading && sorted.length === 0 && (
            <p className="px-4 py-10 text-center text-xs text-zinc-500">
              No uploads yet. Drop in this week&rsquo;s calling sheet above.
            </p>
          )}
          {sorted.map((u) => {
            const summary = u.parsed_summary || {};
            const headers = Array.isArray(summary.headers) ? summary.headers : [];
            const preview = Array.isArray(summary.preview_rows) ? summary.preview_rows : [];
            const total = summary.row_count || 0;
            const open = expandedId === u.id;
            return (
              <div key={u.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-xs font-semibold text-zinc-900">
                        {u.original_filename}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        u.period_type === "weekly" ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
                        : u.period_type === "monthly" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                        : "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200"
                      }`}>
                        {u.period_type}
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        {u.period_start && u.period_end
                          ? `${formatPretty(u.period_start)} → ${formatPretty(u.period_end)}`
                          : "no period set"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-zinc-600">
                      {isHR && u.user_name && <span className="font-medium text-zinc-800">{u.user_name} · </span>}
                      Uploaded {new Date(u.uploaded_at).toLocaleString("en-IN")} ·{" "}
                      {(u.file_size_bytes / 1024).toFixed(1)} KB · {total} rows
                    </p>
                    {u.note && <p className="mt-1 text-[11px] text-zinc-700">📝 {u.note}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setExpandedId(open ? null : u.id)}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      {open ? "Hide preview" : "Preview"}
                    </button>
                    <button
                      onClick={() => handleDownload(u.id, u.original_filename)}
                      disabled={download.isPending}
                      className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                    >
                      {download.isPending ? "Downloading…" : "Download"}
                    </button>
                    {(isHR || u.user_id === me.id) && (
                      <button
                        onClick={() => handleDelete(u.id)}
                        className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {open && headers.length > 0 && (
                  <div className="mt-3 overflow-x-auto rounded-md border border-zinc-200">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr>
                          {headers.map((h, i) => {
                            const { value, style } = _readCell(h, /*defaultBg=*/"#f4f4f5");
                            return (
                              <th
                                key={i}
                                style={style}
                                className="whitespace-nowrap border-b border-r border-zinc-200 px-2 py-1 text-left font-semibold last:border-r-0"
                              >
                                {value || `Col ${i + 1}`}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => {
                              const { value, style } = _readCell(cell);
                              return (
                                <td
                                  key={ci}
                                  style={style}
                                  className="whitespace-nowrap border-b border-r border-zinc-100 px-2 py-1 last:border-r-0"
                                >
                                  {value === "" || value == null ? "" : String(value)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {total > preview.length && (
                      <p className="border-t border-zinc-100 bg-zinc-50 px-2 py-1 text-[10px] text-zinc-500">
                        Showing first {preview.length} rows · {total - preview.length} more in the full file
                      </p>
                    )}
                  </div>
                )}
                {open && headers.length === 0 && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                    Couldn&rsquo;t parse this Excel for preview. Download the file to view it.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20";
const labelClass = "block text-[10px] font-medium uppercase tracking-wider text-zinc-500";

/* Turn an Excel cell payload into `{value, style}` for the preview table.
 *
 * The backend may send a cell as either:
 *   - a plain primitive (number / string / "")        — legacy uploads
 *   - an object {v, bg, fg} where bg/fg are 'RRGGBB'  — new format with colors
 *
 * `defaultBg` lets the caller specify a fallback (used for header cells so
 * the row gets a subtle stripe even if Excel didn't paint it).
 */
function _readCell(cell, defaultBg) {
  if (cell !== null && typeof cell === "object" && "v" in cell) {
    const style = {};
    if (cell.bg) style.backgroundColor = `#${cell.bg}`;
    else if (defaultBg) style.backgroundColor = defaultBg;
    if (cell.fg) style.color = `#${cell.fg}`;
    return { value: cell.v, style };
  }
  return {
    value: cell,
    style: defaultBg ? { backgroundColor: defaultBg } : undefined,
  };
}

function UploadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}
