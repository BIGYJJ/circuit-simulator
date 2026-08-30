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
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const visible = vectors.filter(vector => !hidden[vector.probeId]);
  const start = page * PAGE;
  const end = Math.min(rows, start + PAGE);
  const bodyRows = Math.max(0, end - start);
  return (
    <section aria-label="结果表">
      <p data-testid="result-table-range">{rows === 0 ? "0–0 / 0" : `${start + 1}–${end} / ${rows}`}</p>
      <p data-testid="result-table-body-count">{String(bodyRows)}</p>
      <button type="button" data-testid="result-table-first" disabled={page <= 0} onClick={() => setPage(0)}>
        首页
      </button>
      <button type="button" disabled={page <= 0} onClick={() => setPage(page - 1)}>
        上一页
      </button>
      <button type="button" data-testid="result-table-middle" onClick={() => setPage(Math.floor((pages - 1) / 2))}>
        中间页
      </button>
      <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
        下一页
      </button>
      <button type="button" data-testid="result-table-last" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>
        末页
      </button>
      {vectors.map(vector => (
        <label key={vector.id}>
          <input
            type="checkbox"
            data-testid={`result-col-${vector.probeId}`}
            checked={!hidden[vector.probeId]}
            onChange={() => setHidden(current => ({ ...current, [vector.probeId]: !current[vector.probeId] }))}
          />
          {vector.label}
        </label>
      ))}
      <table data-testid="result-table">
        <caption>{`运行 ${run.runId}`}</caption>
        <thead>
          <tr>
            <th>{axis?.label ?? "axis"}</th>
            {visible.map(vector => (
              <th key={vector.id}>{vector.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: bodyRows }, (_, offset) => {
            const index = start + offset;
            return (
              <tr key={index} data-testid="result-table-row">
                <td>{formatResultCell(axis?.values[index])}</td>
                {visible.map(vector => (
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
