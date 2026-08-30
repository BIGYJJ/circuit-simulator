import type { SuccessfulRunRecord } from "../../simulation/contracts";

interface RunComparisonProps {
  left: SuccessfulRunRecord | null;
  right: SuccessfulRunRecord | null;
}

export default function RunComparison({ left, right }: RunComparisonProps) {
  if (!left || !right) return <p>选择两次成功运行以比较。</p>;
  return (
    <section aria-label="运行比较">
      <p>{`左 ${left.runId} 修订 ${left.electricalRevision}`}</p>
      <p>{`右 ${right.runId} 修订 ${right.electricalRevision}`}</p>
      <p>{left.requestedEngine.engineBuildId === right.requestedEngine.engineBuildId ? "引擎相同" : "引擎不同"}</p>
      <p>显示插值仅用于叠加，不是权威数值。</p>
    </section>
  );
}
