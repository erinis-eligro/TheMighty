'use client';

import { Card } from './Card';
import { useGameStore, type Card as CardType } from '@/store/useGameStore';

export function UserHand() {
  const { playerId, currentTurnIndex, phase, roomId, playableCardIds } = useGameStore();
  const player = useGameStore.getState().players.find((p: { id: string }) => p.id === playerId);
  const isMyTurn = useGameStore.getState().players[currentTurnIndex]?.id === playerId;

  if (!player) return null;

  const selectable = phase === 'TRICK_PLAYING' && isMyTurn;

  const handleSelect = (cardId: string) => {
    const socket = useGameStore.getState().socket;
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
