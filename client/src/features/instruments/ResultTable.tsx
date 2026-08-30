import { useState } from "react";
import type { SuccessfulRunRecord } from "../../simulation/contracts";

const PAGE = 200;

interface ResultTableProps {
  run: SuccessfulRunRecord;
}

export function formatResultCell(value: number | undefined) {
  if (value === undefined) return "";
  if (value === Number.NEGATIVE_INFINITY) return "−∞";
  if (value === Number.POSITIVE_INFINITY) return "∞";
  return String(value);
}

export default function ResultTable({ run }: ResultTableProps) {
  const axis = run.snapshot.axes[0];
  const vectors = run.snapshot.vectors;
  const rows = axis?.values.length ?? 0;
  const pages = Math.max(1, Math.ceil(rows / PAGE));
  const [page, setPage] = useState(0);
  const start = page * PAGE;
  const end = Math.min(rows, start + PAGE);
  return (
    <section aria-label="结果表">
      <p data-testid="result-table-range">{`${start + 1}–${end} / ${rows}`}</p>
      <button type="button" disabled={page <= 0} onClick={() => setPage(page - 1)}>
        上一页
      </button>
      <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
        下一页
      </button>
      <table data-testid="result-table">
        <caption>{`运行 ${run.runId}`}</caption>
        <thead>
          <tr>
            <th>{axis?.label ?? "axis"}</th>
            {vectors.map(vector => (
              <th key={vector.id}>{vector.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: end - start }, (_, offset) => {
            const index = start + offset;
            return (
              <tr key={index}>
                <td>{formatResultCell(axis?.values[index])}</td>
                {vectors.map(vector => (
                  <td key={vector.id} data-testid={`cell-${vector.probeId}-${index}`}>
                    {formatResultCell(vector.values[index])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
