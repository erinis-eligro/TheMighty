'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Card } from './Card';
import { useGameStore, type Card as CardType, type Player as PlayerType, type Trick as TrickType } from '@/store/useGameStore';

const SEAT_OFFSET: Record<string, { left: string; top: string }> = {
  bottom: { left: '50%', top: '55%' },
  top: { left: '50%', top: '-15%' },
  left: { left: '-15%', top: '50%' },
  right: { left: '65%', top: '50%' },
  center: { left: '45%', top: '40%' },
};

export function TrickBoard() {
  const currentTrick = useGameStore((s) => s.currentTrick);
  const trickHistory = useGameStore((s) => s.trickHistory);
  const players = useGameStore((s) => s.players);
  const currentPlayer = useGameStore((s) => s.players[s.currentTurnIndex]);
  const isMyTurn = useGameStore((s) => s.players[s.currentTurnIndex]?.id === s.playerId);

  return (
    <div className="relative w-full h-[320px] flex items-center justify-center">
      <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[#F3F4F6]/60 border-2 border-dashed border-[#CBD5E1] w-[460px] h-[280px]">
        {currentTrick && currentTrick.cards.length > 0 ? (
          currentTrick.cards.map((play, i: number) => {
            const player = players.find((p: PlayerType) => p.id === play.playerId);
            const off = SEAT_OFFSET[player?.seat ?? 'bottom'] ?? SEAT_OFFSET.bottom;
            const indexOffset = (i - 2) * 22;
            return (
              <motion.div
                key={play.card.id}
                animate={{ x: indexOffset, y: -10, rotate: i * 2 }}
                className="absolute"
                style={{ left: off.left, top: off.top, transform: `translateX(${indexOffset}px)` }}
              >
                <Card card={play.card} selectable={false} onSelect={() => {}} />
              </motion.div>
            );
          })
        ) : (
          <div className="text-[#9CA3AF] text-sm">카드를 기다리는 중...</div>
        )}
      </div>

      <AnimatePresence>
        {trickHistory.slice(-3).map((t: TrickType, idx: number) => {
          const winner = players.find((p: PlayerType) => p.id === t.winnerPlayerId);
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute bottom-4 text-xs font-medium text-[#6B7280] flex items-center gap-1"
              style={{ right: `${40 + idx * 44}px` }}
            >
              {winner ? (
                <>
                  <span className="font-bold text-[#1F2937]">{winner.username}</span> 승
                </>
              ) : null}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {isMyTurn && currentPlayer && (
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-[#8B5CF6] text-white px-5 py-2 rounded-full shadow-lg text-sm font-semibold animate-pulse whitespace-nowrap">
          당신의 턴입니다
        </div>
      )}
    </div>
  );
}
