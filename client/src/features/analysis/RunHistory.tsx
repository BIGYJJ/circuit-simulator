import type { RunRecord, SuccessfulRunRecord } from "../../simulation/contracts";

interface RunHistoryProps {
  records: RunRecord[];
  selectedId: string | null;
  compareId: string | null;
  onSelect: (record: SuccessfulRunRecord) => void;
  onCompare: (record: SuccessfulRunRecord | null) => void;
}

export default function RunHistory({ records, selectedId, compareId, onSelect, onCompare }: RunHistoryProps) {
  return (
    <section className="workspace-history" aria-label="运行历史">
      <h2>运行历史</h2>
      <ul>
        {records.map(record => {
          const selectable = record.status === "success";
          return (
            <li key={record.runId}>
              <button
                type="button"
                data-testid={`run-row-${record.runId}`}
                disabled={!selectable}
                onClick={() => {
                  if (record.status === "success") onSelect(record);
                }}
              >
                {`${record.status} · ${record.runId.slice(0, 8)} · ${record.analysis.kind}`}
              </button>
              {selectable ? (
                <button
                  type="button"
                  data-testid={`compare-run-${record.runId}`}
                  onClick={() => {
                    if (record.status === "success") onCompare(compareId === record.runId ? null : record);
                  }}
                >
                  {compareId === record.runId ? "取消比较" : "设为比较"}
                </button>
              ) : null}
              {selectedId === record.runId ? <span>已选</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
