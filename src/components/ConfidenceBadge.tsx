export type ConfidenceTier = 'strong' | 'review' | 'low';

export function getConfidenceTier(score: number): ConfidenceTier {
  if (score >= 80) return 'strong';
  if (score >= 50) return 'review';
  return 'low';
}

export default function ConfidenceBadge({ score }: { score: number }) {
  const tier = getConfidenceTier(score);
  const styles: Record<ConfidenceTier, string> = {
    strong: 'text-black border-black',
    review: 'text-neutral-500 border-neutral-400',
    low: 'text-neutral-400 border-neutral-300',
  };
  const labels: Record<ConfidenceTier, string> = {
    strong: 'Strong Match',
    review: 'Review Recommended',
    low: 'Low Confidence',
  };

  return (
    <span className={`inline-flex items-center text-[9px] font-semibold uppercase tracking-widest border px-1.5 py-0.5 ${styles[tier]}`}>
      {labels[tier]}
    </span>
  );
}
