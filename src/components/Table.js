"use client";

/**
 * Reusable Table with a sticky header — only the body scrolls.
 *
 * Usage:
 *   <Table maxHeight={360}>
 *     <Table.Head>
 *       <Table.Row>
 *         <Table.Th>Date</Table.Th>
 *         <Table.Th>Employee</Table.Th>
 *       </Table.Row>
 *     </Table.Head>
 *     <Table.Body>
 *       {rows.map((r) => (
 *         <Table.Row key={r.id}>
 *           <Table.Td>{r.date}</Table.Td>
 *           <Table.Td>{r.employee}</Table.Td>
 *         </Table.Row>
 *       ))}
 *     </Table.Body>
 *   </Table>
 */

export function Table({ children, maxHeight = 360, className = "" }) {
  const h = typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight;
  return (
    <div className={`overflow-hidden rounded-lg border border-zinc-200 bg-white ${className}`}>
      <div className="overflow-auto" style={{ maxHeight: h }}>
        <table className="min-w-full text-xs">{children}</table>
      </div>
    </div>
  );
}

function Head({ children }) {
  return (
    <thead className="sticky top-0 z-10 bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 shadow-[inset_0_-1px_0_rgb(228_228_231)]">
      {children}
    </thead>
  );
}

function Body({ children, empty, colSpan = 1 }) {
  return (
    <tbody className="divide-y divide-zinc-100">
      {children ||
        (empty ? (
          <tr>
            <td colSpan={colSpan} className="px-3 py-10 text-center text-xs text-zinc-500">
              {empty}
            </td>
          </tr>
        ) : null)}
    </tbody>
  );
}

function Row({ children, className = "", ...props }) {
  return (
    <tr className={`hover:bg-zinc-50 ${className}`} {...props}>
      {children}
    </tr>
  );
}

function Th({ children, className = "", ...props }) {
  return <th className={`px-3 py-2.5 ${className}`} {...props}>{children}</th>;
}

function Td({ children, className = "", ...props }) {
  return <td className={`px-3 py-2.5 align-middle ${className}`} {...props}>{children}</td>;
}

function Empty({ message, colSpan = 1 }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-xs text-zinc-500">
        {message}
      </td>
    </tr>
  );
}

Table.Head = Head;
Table.Body = Body;
Table.Row = Row;
Table.Th = Th;
Table.Td = Td;
Table.Empty = Empty;
