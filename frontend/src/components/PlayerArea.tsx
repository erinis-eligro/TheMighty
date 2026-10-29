'use client';

import { motion } from 'framer-motion';
import { type Player as PlayerType } from '@/store/useGameStore';

type PlayerAreaProps = {
  player: PlayerType;
  isCurrentTurn: boolean;
};

const SEAT_POSITION: Record<string, { top?: string; left?: string; right?: string; bottom?: string }> = {
  top: { top: '0', left: '50%' },
  left: { top: '40%', left: '0' },
  right: { top: '40%', right: '0' },
  center: { top: '10%', right: '10%' },
};

export function PlayerArea({ player, isCurrentTurn }: PlayerAreaProps) {
  const pos = SEAT_POSITION[player.seat];
  const style: React.CSSProperties = { position: 'absolute', ...pos };

  return (
    <motion.div
      animate={{ scale: isCurrentTurn ? 1.05 : 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center gap-2 pointer-events-none"
      style={style}
    >
      <div className="flex items-center gap-2 bg-white/80 backdrop-blur px-3 py-1 rounded-full shadow-sm border border-[#E5E7EB]">
        <span className="text-xs font-semibold">{player.username}</span>
        {player.isAi && <span className="text-[10px] bg-[#8B5CF6] text-white px-1.5 rounded">AI</span>}
        <span className="text-xs font-bold">{player.handCount}</span>
      </div>
      <div className="text-xs text-[#6B7280]">{player.score}점</div>
      <div className="flex gap-1">
        {player.isOwner && (
          <span className="text-[10px] bg-pastel-warn text-pastel-warnText font-bold px-2 py-0.5 rounded-full">주공</span>
        )}
        {player.isFriend && (
          <span className="text-[10px] bg-pastel-ok text-pastel-okText font-bold px-2 py-0.5 rounded-full">프렌드</span>
        )}
      </div>
    </motion.div>
  );
}
