'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Card } from './Card';
import { SuitIcon } from './SuitIcon';
import { useGameStore, type Player as PlayerType, type Trick as TrickType } from '@/store/useGameStore';

type Seat = PlayerType['seat'];

/** Card position (px from the board centre) per seat; the board cards are drawn at 70% size. */
const SEAT_OFFSET: Record<Seat, { x: number; y: number }> = {
  bottom: { x: 0, y: 75 },
  top: { x: -30, y: -75 },
  left: { x: -100, y: 0 },
  right: { x: 100, y: 0 },
  center: { x: 65, y: -80 },
};

/** Where a card comes from / goes to: the seat's position pushed out past the board edge. */
function farOffset(seat: Seat) {
  const { x, y } = SEAT_OFFSET[seat];
  return { x: x * 2.6, y: seat === 'bottom' ? 230 : y * 2.6 };
}

const cardVariants = {
  // A played card flies in from the seat of the player who played it.
  enter: (seat: Seat) => ({ ...farOffset(seat), opacity: 0, scale: 0.5 }),
  show: (seat: Seat) => ({ ...SEAT_OFFSET[seat], opacity: 1, scale: 1 }),
  // After the 1.5s hold (server TRICK_RESOLVED) the five cards are swept towards the winner.
  collect: (winnerSeat: Seat) => ({ ...farOffset(winnerSeat), opacity: 0, scale: 0.4, transition: { duration: 0.5 } }),
};

export function TrickBoard() {
  const currentTrick = useGameStore((s) => s.currentTrick);
  const trickHistory = useGameStore((s) => s.trickHistory);
  const players = useGameStore((s) => s.players);
  const leadSuit = useGameStore((s) => s.leadSuit);
  const isJokerCallActive = useGameStore((s) => s.isJokerCallActive);
  const phase = useGameStore((s) => s.phase);
  const currentPlayer = useGameStore((s) => s.players[s.currentTurnIndex]);
  const isMyTurn = useGameStore((s) => s.players[s.currentTurnIndex]?.id === s.playerId);

  const seatOf = (playerId?: string): Seat => players.find((p) => p.id === playerId)?.seat ?? 'bottom';
  // Still the winner of the last trick when `currentTrick` is already cleared, so the exit sweep knows where to go.
  const winnerSeat = seatOf(trickHistory[trickHistory.length - 1]?.winnerPlayerId);

  return (
    <div className="relative w-full h-[320px] flex items-center justify-center">
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[460px] h-[280px] max-w-full rounded-2xl bg-pastel-bg/60 border-2 border-dashed border-pastel-border">
        {(!currentTrick || currentTrick.cards.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center text-pastel-muted text-sm">카드를 기다리는 중...</div>
        )}

        {/* Lead suit of this trick, and the joker call while it is in force. */}
        {currentTrick && (leadSuit || isJokerCallActive) && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
            {leadSuit && (
              <span className="bg-white rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm border border-pastel-border">
                리드 <SuitIcon giruda={leadSuit} className="text-base align-middle" />
              </span>
            )}
            {isJokerCallActive && (
              <span className="bg-pastel-warn text-pastel-warnText rounded-full px-2.5 py-0.5 text-xs font-bold">조커콜!</span>
            )}
          </div>
        )}

        <div className="absolute left-1/2 top-1/2 w-0 h-0">
          <AnimatePresence custom={winnerSeat}>
            {currentTrick?.cards.map((play, i) => {
              const seat = seatOf(play.playerId);
              return (
                <motion.div
                  key={play.card.id}
                  custom={seat}
                  variants={cardVariants}
                  initial="enter"
                  animate="show"
                  exit="collect"
                  transition={{ type: 'spring', stiffness: 220, damping: 24 }}
                  className="absolute -left-10 -top-14"
                  style={{ zIndex: i, rotate: (i - 2) * 3 }}
                >
                  <div className="origin-center scale-[0.7]">
                    <Card card={play.card} selectable={false} inert onSelect={() => {}} />
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
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
              className="absolute bottom-4 text-xs font-medium text-pastel-muted flex items-center gap-1"
              style={{ right: `${40 + idx * 44}px` }}
            >
              {winner ? (
                <>
                  <span className="font-bold text-pastel-text">{winner.username}</span> 승
                </>
              ) : null}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {phase === 'TRICK_RESOLVED' && currentTrick?.winnerPlayerId && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-pastel-ok text-pastel-okText px-4 py-1 rounded-full text-sm font-semibold">
          {players.find((p) => p.id === currentTrick.winnerPlayerId)?.username} 님이 트릭을 가져갑니다
        </div>
      )}

      {isMyTurn && currentPlayer && phase === 'TRICK_PLAYING' && (
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-pastel-accentHover text-white px-5 py-2 rounded-full shadow-lg text-sm font-semibold animate-pulse whitespace-nowrap">
          당신의 턴입니다
        </div>
      )}
    </div>
  );
}
