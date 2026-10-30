import type { ReactNode } from 'react';
import type { BidGiruda } from '@/store/useGameStore';

/** Text form of each suit. U+FE0E (text variation selector) keeps them from rendering as color emoji. */
export const SUIT_SYMBOL: Record<string, string> = {
  SPADE: '♠\uFE0E',
  DIAMOND: '♦\uFE0E',
  HEART: '♥\uFE0E',
  CLUB: '♣\uFE0E',
};

export const isRedSuit = (suit: string): boolean => suit === 'DIAMOND' || suit === 'HEART';

const SUIT_PATH: Record<string, ReactNode> = {
  SPADE: (
    <path d="M12 1.5C9 6 3.5 9 3.5 13.5a4.2 4.2 0 0 0 7.2 2.9c-.1 2.4-.9 3.9-2.7 5.6h8c-1.8-1.7-2.6-3.2-2.7-5.6a4.2 4.2 0 0 0 7.2-2.9C20.5 9 15 6 12 1.5z" />
  ),
  HEART: <path d="M12 22C5 16 2 12.5 2 8.5A5.2 5.2 0 0 1 12 6.2 5.2 5.2 0 0 1 22 8.5c0 4-3 7.5-10 13.5z" />,
  DIAMOND: <path d="M12 1 21.5 12 12 23 2.5 12z" />,
  CLUB: (
    <>
      <circle cx="12" cy="6.8" r="4.8" />
      <circle cx="6.4" cy="14.2" r="4.8" />
      <circle cx="17.6" cy="14.2" r="4.8" />
      <path d="M11 13h2c0 4 .9 6.6 3 9H8c2.1-2.4 3-5 3-9z" />
    </>
  ),
};

/** Inline-SVG suit shape (same look on every OS/font). Colored via `currentColor`; size it with `className` (default 1em x 1em). */
export function SuitGlyph({ suit, className = 'h-[1em] w-[1em]' }: { suit: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={`inline-block shrink-0 align-[-0.125em] ${className}`}
    >
      {SUIT_PATH[suit]}
    </svg>
  );
}

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
  return (
    <span
      title={girudaLabel(giruda)}
      role="img"
      aria-label={girudaLabel(giruda)}
      className={`${isRedSuit(giruda) ? 'text-suit-red' : 'text-suit-black'} ${className}`}
    >
      {SUIT_PATH[giruda] ? <SuitGlyph suit={giruda} /> : '?'}
    </span>
  );
}

/** Small "suit + rank" chip for collected score cards. */
export function CardChip({ card }: { card: { suit: string; rank: string; isJoker?: boolean } }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-bold leading-none bg-white rounded px-1 py-0.5 border border-pastel-border ${
        card.isJoker ? 'text-suit-joker' : isRedSuit(card.suit) ? 'text-suit-red' : 'text-suit-black'
      }`}
    >
      {card.isJoker ? '🃏' : (
        <>
          <SuitGlyph suit={card.suit} className="h-3.5 w-3.5" />
          {card.rank}
        </>
      )}
    </span>
  );
}
