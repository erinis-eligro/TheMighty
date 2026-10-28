'use client';

import { motion } from 'framer-motion';
import { useGameStore, type Card as CardType, type Player as PlayerType } from '@/store/useGameStore';

type CardProps = {
  card: CardType;
  selectable: boolean;
  onSelect: (cardId: string) => void;
};

const SUIT_ICON: Record<string, string> = {
  SPADE: '♠',
  DIAMOND: '◆',
  HEART: '♥',
  CLUB: '♣',
  JOKER: '🃏',
};

const SUIT_COLOR: Record<string, string> = {
  SPADE: '#000000',
  DIAMOND: '#e53e3e',
  HEART: '#e53e3e',
  CLUB: '#000000',
  JOKER: '#6366f1',
};

export function Card({ card, selectable, onSelect }: CardProps) {
  const { playerId, turnPlayerId } = useGameStore.getState();
  const isMyTurn = turnPlayerId === playerId;
  const isHidden = card.hidden || false;
  const suitColor = card.isJoker ? '#6366f1' : SUIT_COLOR[card.suit] ?? '#000000';

  const handleClick = () => {
    if (selectable && isMyTurn) onSelect(card.id);
  };

  return (
    <motion.button
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
      disabled={!selectable || !isMyTurn || isHidden}
      onClick={handleClick}
      className={`
        relative w-20 h-28 rounded-xl shadow-lg border-2
        ${isHidden ? 'bg-[#CBD5E1] border-[#94A3B8]' : 'bg-white border-transparent'}
        ${selectable && isMyTurn && !isHidden ? 'border-[#8B5CF6] ring-2 ring-[#8B5CF6] scale-110' : ''}
        flex flex-col items-center justify-between p-2 transition-all duration-200
        ${!selectable || !isMyTurn ? 'opacity-60 pointer-events-none' : 'opacity-100 cursor-pointer'}
      `}
    >
      {isHidden ? (
        <div className="w-full h-full rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
          <span className="text-4xl">🂠</span>
        </div>
      ) : (
        <>
          <div className="absolute top-2 left-2 text-xs font-bold" style={{ color: suitColor }}>
            {SUIT_ICON[card.suit]}
          </div>
          <div className="absolute top-2 right-2 text-xs font-bold transform rotate-180" style={{ color: suitColor }}>
            {SUIT_ICON[card.suit]}
          </div>
          <div className="text-2xl font-bold" style={{ color: suitColor }}>
            {card.isJoker ? '🃏' : card.rank}
          </div>
          <div className="absolute bottom-2 left-2 text-xs font-bold transform rotate-180" style={{ color: suitColor }}>
            {SUIT_ICON[card.suit]}
          </div>
          <div className="absolute bottom-2 right-2 text-xs font-bold" style={{ color: suitColor }}>
            {SUIT_ICON[card.suit]}
          </div>
        </>
      )}
    </motion.button>
  );
}
