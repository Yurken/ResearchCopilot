import { FlaskConical, Gauge, OctagonX, Scale } from "lucide-react";
import type { LearningPath } from "@research-copilot/types";

export default function HypothesisValidationPlan({ plan }: { plan: NonNullable<LearningPath["hypothesis_validation"]> }) {
  return (
    <section className="rounded-2xl border border-apple-blue/15 bg-apple-blue/5 p-4" data-testid="hypothesis-validation-plan">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-primary"><FlaskConical className="h-4 w-4 text-apple-blue" />假设验证计划</p>
      <p className="mt-2 text-xs leading-5 text-ink-secondary">{plan.hypothesis}</p>
      <PlanList title="验证任务" values={plan.tasks} />
      <PlanList title="对照方案" values={[plan.control_plan]} icon={Scale} />
      <PlanList title="判定指标" values={plan.decision_metrics} icon={Gauge} />
      <PlanList title="停止条件" values={plan.stop_conditions} icon={OctagonX} />
      <PlanList title="证据边界" values={plan.evidence_boundary} />
    </section>
  );
}

function PlanList({ title, values, icon: Icon = FlaskConical }: { title: string; values: string[]; icon?: typeof FlaskConical }) {
  if (values.filter(Boolean).length === 0) return null;
  return <div className="mt-3 text-xs text-ink-secondary"><p className="flex items-center gap-1 font-semibold"><Icon className="h-3.5 w-3.5" />{title}</p><ul className="mt-1 space-y-1 pl-4">{values.filter(Boolean).map((value) => <li key={value} className="list-disc leading-5">{value}</li>)}</ul></div>;
}
