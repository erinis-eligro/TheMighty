'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { createGameSocket } from '@/lib/socket';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const store = useGameStore;
    let socket: any;
    try {
      socket = createGameSocket();
    } catch {
      return;
    }

    store.setState({ socket });

    socket.on('connect', () => store.setState({ isConnected: true }));
    socket.on('disconnect', () => store.setState({ isConnected: false }));
    socket.on('connect_error', (err: Error) => store.setState({ error: err.message }));

    socket.on('room_created', (data: any) => {
      store.setState({ roomId: data.roomId, playerId: data.playerId, phase: 'LOBBY' });
    });

    socket.on('player_joined', (data: any) => {
      store.setState({ players: data.players });
    });

    socket.on('state_sync', (data: any) => {
      store.setState({
        roomId: data.roomId,
        phase: data.phase,
        turnPlayerId: data.turnPlayerId,
        currentTrick: data.currentTrick,
        tricks: data.tricks,
        kitty: data.kitty,
        giruda: data.giruda,
        ownerPlayerId: data.ownerPlayerId,
        friendPlayerId: data.friendPlayerId,
        currentBid: data.currentBid,
        bidLeader: data.bidLeader,
        players: data.players.map((p: any) => ({
          id: p.id,
          username: p.username,
          seat: p.seat,
          isAi: p.isAi,
          hand: p.hidden ? p.hand.map((c: any) => ({ ...c, hidden: true })) : p.hand,
          handCount: p.handCount,
          trickScore: p.trickScore,
          isFriend: p.isFriend,
          isOwner: p.isOwner,
          bid: p.bid,
        })),
      });
    });

    socket.on('bid_placed', (data: any) => {
      store.setState({ currentBid: data.bid ?? 0, bidLeader: data.bidLeader });
    });

    socket.on('turn_complete', (data: any) => {
      const cur = store.getState();
      if (data.trick) cur.addTrick(data.trick);
      store.setState({ turnPlayerId: data.winnerPlayerId });
    });

    socket.on('game_end', (data: any) => {
      store.setState({ phase: 'ENDED' });
    });

    socket.on('player_left', (data: any) => {
      store.setState((s: any) => ({ players: s.players.filter((p: any) => p.id !== data.playerId) }));
    });

    socket.on('game_error', (data: any) => {
      store.setState({ error: data.message ?? data });
    });

    return () => {
      socket.disconnect();
      store.setState({ socket: null, isConnected: false });
    };
  }, []);

  return <>{children}</>;
}
