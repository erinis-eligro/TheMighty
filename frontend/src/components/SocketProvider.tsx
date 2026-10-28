'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/store/useGameStore';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const store = useGameStore;
    let socket: any;
    try {
      socket = require('socket.io-client').io(BACKEND_URL, {
        transports: ['websocket', 'polling'],
      });
    } catch {
      return;
    }

    store.setState({ socket });

    socket.on('connect', () => store.setState({ isConnected: true }));
    socket.on('disconnect', () => store.setState({ isConnected: false }));
    socket.on('connect_error', (err: Error) => store.setState({ error: err.message }));

    socket.on('room_created', (data: any) => {
      store.setState({ roomId: data.roomId, playerId: data.playerId, phase: 'READY' });
    });

    socket.on('player_joined', (data: any) => {
      store.setState({ players: data.players });
    });

    socket.on('state_sync', (data: any) => {
      store.setState({
        roomId: data.roomId,
        phase: data.phase,
        currentTurnIndex: data.currentTurnIndex,
        turnPlayerId: data.turnPlayerId,
        currentTrick: data.currentTrick,
        trickHistory: data.trickHistory,
        currentTrickNumber: data.currentTrickNumber,
        leadSuit: data.leadSuit,
        isJokerCallActive: data.isJokerCallActive,
        kitty: data.kitty,
        giruda: data.giruda,
        ownerPlayerId: data.ownerPlayerId,
        presidentIndex: data.presidentIndex,
        friendDeclaration: data.friendDeclaration,
        friendIndex: data.friendIndex,
        friendPlayerId: data.friendPlayerId,
        passCount: data.passCount,
        currentBid: data.currentBid,
        highestBid: data.highestBid,
        bidLeader: data.bidLeader,
        players: data.players.map((p: any) => ({
          id: p.id,
          username: p.username,
          seat: p.seat,
          isAi: p.isAi,
          hand: p.hidden ? p.hand.map((c: any) => ({ ...c, hidden: true })) : p.hand,
          handCount: p.handCount,
          collectedScoreCards: p.collectedScoreCards,
          score: p.score,
          isFriend: p.isFriend,
          isOwner: p.isOwner,
          bid: p.bid,
          hasPassed: p.hasPassed,
        })),
      });
    });

    socket.on('bid_placed', (data: any) => {
      store.setState({ currentBid: data.bid ?? 0, bidLeader: data.bidLeader });
    });

    socket.on('turn_complete', (data: any) => {
      const cur = store.getState();
      if (data.trick) cur.addTrick(data.trick);
      store.setState({
        turnPlayerId: data.winnerPlayerId,
        ...(typeof data.trick?.winnerIndex === 'number' ? { currentTurnIndex: data.trick.winnerIndex } : {}),
      });
    });

    socket.on('game_end', (data: any) => {
      store.setState({ phase: 'GAME_OVER' });
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
