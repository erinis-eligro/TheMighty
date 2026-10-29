'use client';

import { Card } from './Card';
import { useGameStore, type Card as CardType } from '@/store/useGameStore';

export function UserHand() {
  const playerId = useGameStore((s) => s.playerId);
  const roomId = useGameStore((s) => s.roomId);
  const phase = useGameStore((s) => s.phase);
  const playableCardIds = useGameStore((s) => s.playableCardIds);
  const socket = useGameStore((s) => s.socket);
  const player = useGameStore((s) => s.players.find((p) => p.id === s.playerId));
  const isMyTurn = useGameStore((s) => s.players[s.currentTurnIndex]?.id === s.playerId);

  if (!player) return null;

  const selectable = phase === 'TRICK_PLAYING' && isMyTurn;

  const handleSelect = (cardId: string) => {
    if (!socket) return;
    socket.emit('play_card', { roomId, playerId, cardId });
  };

  return (
    <div className="relative w-full h-40 flex items-end justify-center gap-1 px-4 pb-6">
      {player.hand.map((card: CardType) => (
        <Card
          key={card.id}
          card={card}
          selectable={selectable && !card.hidden && playableCardIds.includes(card.id)}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}
