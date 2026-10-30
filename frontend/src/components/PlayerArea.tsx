'use client';

import { motion } from 'framer-motion';
import { CardChip } from './SuitIcon';
import { sortHand } from '@/lib/cards';
import { useGameStore, type Player as PlayerType } from '@/store/useGameStore';

type PlayerAreaProps = {
  player: PlayerType;
  isCurrentTurn: boolean;
};

/** Seat placement from `md` up; on mobile every area is a plain flow item (AI row / my status bar). */
const SEAT_CLASS: Record<string, string> = {
  top: 'md:absolute md:top-0 md:left-1/2 md:-translate-x-1/2',
  left: 'md:absolute md:top-1/3 md:left-0',
  right: 'md:absolute md:top-1/3 md:right-0',
  center: 'md:absolute md:top-2 md:right-4',
  bottom: 'md:absolute md:bottom-0 md:left-0',
};

export function PlayerArea({ player, isCurrentTurn }: PlayerAreaProps) {
  const giruda = useGameStore((st) => st.giruda);
  const seatClass = SEAT_CLASS[player.seat] ?? '';

  return (
    <div className={`min-w-0 flex justify-center pointer-events-none ${seatClass}`}>
    <motion.div
      animate={{ scale: isCurrentTurn ? 1.05 : 1 }}
      transition={{ duration: 0.2 }}
      className="min-w-0 flex flex-col items-center gap-1 md:gap-2"
    >
      <div
        className={`flex max-w-full items-center gap-1 md:gap-2 bg-white/80 backdrop-blur px-2 md:px-3 py-1 rounded-full shadow-sm border ${
          isCurrentTurn ? 'border-pastel-accentHover ring-2 ring-pastel-accent' : 'border-pastel-border'
        }`}
      >
        <span className="truncate text-xs font-semibold">{player.username}</span>
        {player.isAi && <span className="text-[10px] bg-pastel-accentHover text-white px-1.5 rounded">AI</span>}
        <span className="text-xs font-bold" aria-label="남은 카드 수">{player.handCount}</span>
      </div>
      <div className="text-xs text-pastel-muted">
        {player.score}점
        <span className="md:hidden"> · {player.collectedScoreCards.length}장</span>
      </div>
      {player.collectedScoreCards.length > 0 && (
        <div className="hidden md:flex flex-wrap justify-center gap-0.5 max-w-40" aria-label="획득한 점수 카드">
          {sortHand(player.collectedScoreCards, giruda).map((c) => (
            <CardChip key={c.id} card={c} />
          ))}
        </div>
      )}
      <div className="flex gap-1">
        {player.isOwner && (
          <span className="text-[10px] bg-pastel-warn text-pastel-warnText font-bold px-2 py-0.5 rounded-full">주공</span>
        )}
        {player.isFriend && (
          <span className="text-[10px] bg-pastel-ok text-pastel-okText font-bold px-2 py-0.5 rounded-full">프렌드</span>
        )}
      </div>
    </motion.div>
    </div>
  );
}
