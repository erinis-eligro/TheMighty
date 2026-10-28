'use client';

import { useEffect } from 'react';
import { useGameStore, type Player as PlayerType } from '@/store/useGameStore';
import { PlayerArea } from '@/components/PlayerArea';
import { TrickBoard } from '@/components/TrickBoard';
import { UserHand } from '@/components/UserHand';

export default function GamePage({ params }: { params: { roomId: string } }) {
  const { socket, roomId, playerId, players, phase, currentBid, isConnected, setPhase, setPlayers, setTurn, setCurrentTrick } = useGameStore();
  const store = useGameStore.getState();

  useEffect(() => {
    if (!socket) return;

    socket.on('deal_complete', (data: any) => {
      setPhase('BIDDING');
      setPlayers(data.players);
      store.setTurn(data.players[0]?.id ?? '');
    });

    socket.on('game_started', (data: any) => {
      setPlayers(data.players);
    });

    socket.on('bid_placed', (data: any) => {
      store.setBid(data.bid ?? 0, data.bidLeader);
      setPlayers(data.players);
    });

    socket.on('turn_complete', (data: any) => {
      if (data.trick) {
        store.addTrick(data.trick);
        setTurn(data.winnerPlayerId);
      }
    });

    socket.on('state_sync', (data: any) => {
      setPlayers(data.players);
      setTurn(data.turnPlayerId);
      setCurrentTrick(data.currentTrick);
      setPhase(data.phase);
      if (data.kitty) store.setKitty(data.kitty);
      if (data.giruda) store.setGiruda(data.giruda);
      store.setBid(data.currentBid, data.bidLeader);
    });

    socket.on('game_end', (data: any) => {
      setPhase('ENDED');
      alert(`게임 종료! ${data.isWin ? '승리' : '패배'} (팀점수 ${data.teamPoints} / 비딩 ${data.bidScore})`);
    });

    socket.emit('start_game', { roomId });

    return () => {
      socket.off('deal_complete');
      socket.off('game_started');
      socket.off('bid_placed');
      socket.off('card_played');
      socket.off('turn_complete');
      socket.off('state_sync');
      socket.off('game_end');
    };
  }, [socket, roomId, setPhase, setPlayers, setTurn, setCurrentTrick, store]);

  if (!isConnected) {
    return <div className="min-h-screen flex items-center justify-center">연결 중...</div>;
  }

  const turnPlayerId = useGameStore.getState().turnPlayerId;

  return (
    <div className="min-h-screen bg-[#F7F5FA] p-4">
      <header className="flex items-center justify-between mb-6 px-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#8B5CF6] flex items-center justify-center text-white font-bold">M</div>
          <div>
            <h1 className="text-lg font-bold text-[#1F2937]">마이티</h1>
            <p className="text-xs text-[#6B7280]">방 {roomId}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="bg-white px-3 py-1.5 rounded-lg shadow-sm border border-[#E5E7EB]">
            <span className="text-[#6B7280] text-xs block">비딩 점수</span>
            <span className="font-bold text-[#1F2937]">{currentBid}점</span>
          </div>
          <div className="bg-white px-3 py-1.5 rounded-lg shadow-sm border border-[#E5E7EB]">
            <span className="text-[#6B7280] text-xs block">기루다</span>
            <span className="font-bold text-[#1F2937]">{store.giruda}</span>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${phase === 'BIDDING' ? 'bg-[#FEF3C7] text-[#92400E]' : phase === 'PLAYING' ? 'bg-[#D1FAE5] text-[#047857]' : 'bg-[#E5E7EB] text-[#6B7280]'}`}>
            {phase === 'BIDDING' ? '비딩 중' : phase === 'PLAYING' ? '플레이 중' : phase === 'ENDED' ? '종료' : '대기'}
          </span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto relative h-[600px]">
        {players.map((p: PlayerType) => (
          <PlayerArea key={p.id} player={p} isCurrentTurn={p.id === turnPlayerId} />
        ))}
        <TrickBoard />
      </div>

      <UserHand />

      {phase === 'ENDED' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-2xl">
            <h2 className="text-2xl font-bold text-[#1F2937] mb-2">게임 종료</h2>
            <p className="text-[#6B7280] mb-6">결과를 확인하세요.</p>
            <button
              onClick={() => {
                store.setPhase('LOBBY');
                store.setPlayers([]);
                location.reload();
              }}
              className="w-full py-3 bg-[#8B5CF6] text-white rounded-xl font-semibold hover:bg-[#7C3AED] transition-colors"
            >
              로비로 돌아가기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
