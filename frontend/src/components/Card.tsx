'use client';

import { motion } from 'framer-motion';
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

const SUIT_ICON: Record<string, string> = {
  SPADE: '♠',
  DIAMOND: '◆',
  HEART: '♥',
  CLUB: '♣',
  JOKER: '🃏',
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
          <div className={`absolute top-1 left-1 ${r('', 'md:top-2 md:left-2')} ${r('text-[10px]', 'md:text-xs')} font-bold ${suitColor}`}>
            {SUIT_ICON[card.suit]}
          </div>
          <div className={`absolute top-1 right-1 ${r('', 'md:top-2 md:right-2')} ${r('text-[10px]', 'md:text-xs')} font-bold transform rotate-180 ${suitColor}`}>
            {SUIT_ICON[card.suit]}
          </div>
          <div className={`${r('text-lg', 'md:text-2xl')} font-bold ${suitColor}`}>
            {card.isJoker ? '🃏' : card.rank}
          </div>
          <div className={`absolute bottom-1 left-1 ${r('', 'md:bottom-2 md:left-2')} ${r('text-[10px]', 'md:text-xs')} font-bold transform rotate-180 ${suitColor}`}>
            {SUIT_ICON[card.suit]}
          </div>
          <div className={`absolute bottom-1 right-1 ${r('', 'md:bottom-2 md:right-2')} ${r('text-[10px]', 'md:text-xs')} font-bold ${suitColor}`}>
            {SUIT_ICON[card.suit]}
          </div>
        </>
      )}
    </motion.button>
  );
}
