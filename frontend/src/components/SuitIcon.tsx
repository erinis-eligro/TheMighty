import type { BidGiruda } from '@/store/useGameStore';

export const SUIT_SYMBOL: Record<string, string> = {
  SPADE: '♠',
  DIAMOND: '◆',
  HEART: '♥',
  CLUB: '♣',
};

const SUIT_LABEL: Record<string, string> = {
  SPADE: '스페이드',
  DIAMOND: '다이아',
  HEART: '하트',
  CLUB: '클로버',
  NO_GIRUDA: '노기루다',
};

export function girudaLabel(giruda: string): string {
  return SUIT_LABEL[giruda] ?? giruda;
}

/** Suit symbol (red/dark), or a round "no trump" badge for NO_GIRUDA. */
export function SuitIcon({ giruda, className = '' }: { giruda: BidGiruda | string; className?: string }) {
  if (giruda === 'NO_GIRUDA') {
    return (
      <span
        title="노기루다"
        aria-label="노기루다"
        className={`inline-flex items-center justify-center w-[1.4em] h-[1.4em] rounded-full bg-pastel-accent text-white text-[0.7em] font-bold align-middle ${className}`}
      >
        ∅
      </span>
    );
  }
  const red = giruda === 'DIAMOND' || giruda === 'HEART';
  return (
    <span
      title={girudaLabel(giruda)}
      aria-label={girudaLabel(giruda)}
      className={`${red ? 'text-suit-red' : 'text-suit-black'} ${className}`}
    >
      {SUIT_SYMBOL[giruda] ?? '?'}
    </span>
  );
}
