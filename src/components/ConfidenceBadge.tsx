export type ConfidenceTier = 'strong' | 'review' | 'low';

export function getConfidenceTier(score: number): ConfidenceTier {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'review';
  return 'low';
}

const TIER_STYLES: Record<ConfidenceTier, string> = {
  strong: 'text-black border-black',
  review: 'text-neutral-500 border-neutral-400',
  low: 'text-neutral-400 border-neutral-300',
};

const TIER_LABELS: Record<ConfidenceTier, string> = {
  strong: 'Strong Visual Match',
  review: 'Review Recommended',
  low: 'Low Confidence',
};

export default function ConfidenceBadge({ score }: { score: number }) {
  const tier = getConfidenceTier(score);

  return (
    <span className={`inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-widest border px-1.5 py-0.5 ${TIER_STYLES[tier]}`}>
      {TIER_LABELS[tier]}
      <span className="opacity-60">{score}%</span>
    </span>
  );
}

export function LikelihoodBadge({ label, value }: { label: string; value: string | null }) {
  if (!value || value === 'unknown') return null;

  const styles: Record<string, string> = {
    very_high: 'text-black border-black',
    high: 'text-neutral-700 border-neutral-500',
    medium: 'text-neutral-500 border-neutral-400',
    low: 'text-neutral-400 border-neutral-300',
    very_low: 'text-neutral-300 border-neutral-200',
  };

  const display: Record<string, string> = {
    very_high: 'Very High',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    very_low: 'Very Low',
  };

  return (
    <span className={`inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-widest border px-1.5 py-0.5 ${styles[value] ?? styles.medium}`}>
      {label}: {display[value] ?? value}
    </span>
  );
}
