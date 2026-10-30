'use client';

import { motion } from 'framer-motion';
import { SuitGlyph } from './SuitIcon';
import { useGameStore, type Card as CardType, type Player as PlayerType } from '@/store/useGameStore';

type CardProps = {
  card: CardType;
  selectable: boolean;
  /** Marks the card as picked by the user (e.g. kitty discard); independent of `selectable`. */
  selected?: boolean;
  /** Display-only card (e.g. on the trick board): no hover, no dimming, never clickable. */
  inert?: boolean;
  /** Grayed out: the card cannot be played now. */
  dimmed?: boolean;
  /** When set, a card that is not selectable stays clickable and reports the click (to explain why it is blocked). */
  onBlockedSelect?: (cardId: string) => void;
  onSelect: (cardId: string) => void;
  /** `hand`: responsive hand size (default). `fill`: stretch to the parent box (e.g. trick board). */
  size?: 'hand' | 'fill';
};

const SUIT_COLOR_CLASS: Record<string, string> = {
  SPADE: 'text-suit-black',
  DIAMOND: 'text-suit-red',
  HEART: 'text-suit-red',
  CLUB: 'text-suit-black',
  JOKER: 'text-suit-joker',
};

const SIZE_CLASS = {
  hand: 'w-card-w-sm h-card-h-sm md:w-card-w md:h-card-h lg:w-card-w-lg lg:h-card-h-lg',
  fill: 'w-full h-full',
};

function CornerIndex({ card, suitColor, compact, className }: { card: CardType; suitColor: string; compact: boolean; className: string }) {
  const rankClass = compact ? 'text-xs' : 'text-sm md:text-lg';
  const suitClass = compact ? 'h-2.5 w-2.5' : 'h-3 w-3 md:h-4 md:w-4';
  return (
    <div className={`absolute flex flex-col items-center leading-none font-extrabold pointer-events-none ${suitColor} ${className}`}>
      {card.isJoker ? (
        <span className={compact ? 'text-xs' : 'text-sm md:text-lg'}>🃏</span>
      ) : (
        <>
          <span className={rankClass}>{card.rank}</span>
          <SuitGlyph suit={card.suit} className={`${suitClass} mt-0.5`} />
        </>
      )}
    </div>
  );
}

export function Card({ card, selectable, selected = false, inert = false, dimmed = false, onBlockedSelect, onSelect, size = 'hand' }: CardProps) {
  const isMyTurn = useGameStore((s) => s.players[s.currentTurnIndex]?.id === s.playerId);
  const isHidden = card.hidden || false;
  const suitColor = card.isJoker ? SUIT_COLOR_CLASS.JOKER : SUIT_COLOR_CLASS[card.suit] ?? 'text-suit-black';

  const compact = size === 'fill';
  // `r(base, md)`: board cards keep the compact look at every breakpoint, hand cards grow from `md`.
  const r = (base: string, md: string) => (compact ? base : `${base} ${md}`);

  const active = !inert && selectable && isMyTurn && !isHidden;
  const blockedClickable = !inert && !active && !isHidden && onBlockedSelect !== undefined;

  const handleClick = () => {
    if (active) onSelect(card.id);
    else if (blockedClickable) onBlockedSelect?.(card.id);
  };

  return (
    <motion.button
      whileHover={active ? { y: -4, scale: 1.02 } : undefined}
      whileTap={active || blockedClickable ? { scale: 0.95 } : undefined}
      disabled={inert || (!active && !blockedClickable)}
      aria-disabled={!inert && !active}
      onClick={handleClick}
      className={`
        relative ${SIZE_CLASS[size]} shrink-0 rounded-xl shadow-lg border-2 touch-manipulation
        ${isHidden ? 'bg-pastel-cardBack border-pastel-cardBackBorder' : 'bg-white border-transparent'}
        ${active ? 'border-pastel-accentHover ring-2 ring-pastel-accentHover scale-110' : ''}
        ${selected ? '!border-pastel-pink ring-4 ring-pastel-pink' : ''}
        flex flex-col items-center justify-between ${r('p-1', 'md:p-2')} transition-all duration-200
        ${active ? 'opacity-100 cursor-pointer' : dimmed ? 'opacity-50 grayscale' : 'opacity-100'}
        ${blockedClickable ? 'cursor-not-allowed' : ''}
        ${!active && !blockedClickable ? 'pointer-events-none' : ''}
      `}
    >
      {isHidden ? (
        <div className="w-full h-full rounded-xl bg-gradient-to-br from-pastel-accentHover to-pastel-sky flex items-center justify-center">
          <span className={r('text-2xl', 'md:text-4xl')}>🂠</span>
        </div>
      ) : (
        <>
          {/* Center: large suit, sized relative to the card so it scales with every card size. */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {card.isJoker ? (
              <span className={`${r('text-3xl', 'md:text-5xl')} leading-none`}>🃏</span>
            ) : (
              <SuitGlyph suit={card.suit} className={`aspect-square w-auto ${compact ? 'h-[42%]' : 'h-[46%]'} ${suitColor}`} />
            )}
          </div>
          {/* Corner indexes: rank + small suit, bottom-right rotated 180deg like a real playing card. */}
          <CornerIndex card={card} suitColor={suitColor} compact={compact} className={`top-0.5 left-1 ${r('', 'md:top-1 md:left-1.5')}`} />
          <CornerIndex card={card} suitColor={suitColor} compact={compact} className={`bottom-0.5 right-1 rotate-180 ${r('', 'md:bottom-1 md:right-1.5')}`} />
        </>
      )}
    </motion.button>
  );
}
