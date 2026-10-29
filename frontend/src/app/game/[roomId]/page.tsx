'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore, type FriendDeclaration, type GamePhase, type Player as PlayerType } from '@/store/useGameStore';
import { PlayerArea } from '@/components/PlayerArea';
import { TrickBoard } from '@/components/TrickBoard';
import { UserHand } from '@/components/UserHand';
import { BiddingPanel } from '@/components/BiddingPanel';
import { KittyExchangeModal } from '@/components/KittyExchangeModal';
import { FriendSelectionPanel } from '@/components/FriendSelectionPanel';
import { SuitIcon, SUIT_SYMBOL } from '@/components/SuitIcon';

const FRIEND_LABEL: Record<FriendDeclaration['type'], string> = {
  NO_FRIEND: '노프렌드',
  FIRST_TRICK: '초구 프렌드',
  MIGHTY: '마이티 프렌드',
  JOKER: '조커 프렌드',
  CARD: '카드 프렌드',
};

function friendText(d: FriendDeclaration): string {
  if (d.type !== 'CARD') return FRIEND_LABEL[d.type];
  return `${SUIT_SYMBOL[d.suit]}${d.rank} 프렌드`;
}

const PHASE_LABEL: Record<GamePhase, string> = {
  READY: '대기',
  DEALING: '카드 분배',
  BIDDING: '비딩 중',
  KITTY_EXCHANGE: '바닥패 교환',
  FRIEND_SELECTION: '프렌드 선택',
  TRICK_PLAYING: '플레이 중',
  TRICK_RESOLVED: '트릭 결과',
  ROUND_SCORING: '점수 계산',
  GAME_OVER: '종료',
};

export default function GamePage({ params }: { params: { roomId: string } }) {
  const router = useRouter();
  const socket = useGameStore((s) => s.socket);
  const roomId = useGameStore((s) => s.roomId);
  const players = useGameStore((s) => s.players);
  const phase = useGameStore((s) => s.phase);
  const highestBid = useGameStore((s) => s.highestBid);
  const giruda = useGameStore((s) => s.giruda);
  const ownerPlayerId = useGameStore((s) => s.ownerPlayerId);
  const friendPlayerId = useGameStore((s) => s.friendPlayerId);
  const friendRevealed = useGameStore((s) => s.friendRevealed);
  const friendDeclaration = useGameStore((s) => s.friendDeclaration);
  const turnPlayerId = useGameStore((s) => s.turnPlayerId);
  const result = useGameStore((s) => s.result);
  const turnPlayer = useGameStore((s) => s.players[s.currentTurnIndex]);
  const isConnected = useGameStore((s) => s.isConnected);
  const error = useGameStore((s) => s.error);
  const setError = useGameStore((s) => s.setError);
  const rejoinRoom = useGameStore((s) => s.rejoinRoom);
  const leaveRoom = useGameStore((s) => s.leaveRoom);

  // Server errors (game_error / failed acks) are shown as a toast that disappears by itself.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error, setError]);

  // Game state arrives only through the store's `state_sync` listener (server is the source of truth).
  // This page just makes sure the socket holds the seat of this room and asks the server to deal.
  useEffect(() => {
    if (!socket || !isConnected) return;
    let cancelled = false;

    const enter = async () => {
      // After a reload the store is empty: take the seat back with the stored rejoin token.
      if (!useGameStore.getState().playerId && !(await rejoinRoom(params.roomId))) {
        if (!cancelled) router.replace('/lobby');
        return;
      }
      // The server only deals once (idempotent); skip the request when the game is already running.
      if (!cancelled && useGameStore.getState().phase === 'READY') {
        socket.emit('start_game', { roomId: params.roomId });
      }
    };
    void enter();

    return () => {
      cancelled = true;
    };
  }, [socket, isConnected, params.roomId, rejoinRoom, router]);

  const owner = players.find((p) => p.id === ownerPlayerId);
  const friend = players.find((p) => p.id === friendPlayerId);
  // The giruda is final (shown in the header) once bidding is over; before that only the leading bid is known.
  const bidFixed = ownerPlayerId !== '';
  const shownGiruda = bidFixed ? giruda : (highestBid?.giruda ?? null);
  const aiThinking =
    turnPlayer?.isAi && (phase === 'KITTY_EXCHANGE' || phase === 'FRIEND_SELECTION' || phase === 'TRICK_PLAYING');

  if (!isConnected) {
    return <div className="min-h-screen flex items-center justify-center">연결 중...</div>;
  }

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
            <span className="text-[#6B7280] text-xs block">{bidFixed ? '비딩 점수' : '최고 비딩'}</span>
            <span className="font-bold text-[#1F2937]">{highestBid ? `${highestBid.score}점` : '-'}</span>
          </div>
          <div className="bg-white px-3 py-1.5 rounded-lg shadow-sm border border-[#E5E7EB]">
            <span className="text-[#6B7280] text-xs block">기루다</span>
            <span className="font-bold text-[#1F2937] text-lg leading-tight">
              {shownGiruda ? <SuitIcon giruda={shownGiruda} /> : '-'}
            </span>
          </div>
          {owner && (
            <div className="bg-white px-3 py-1.5 rounded-lg shadow-sm border border-[#E5E7EB]">
              <span className="text-[#6B7280] text-xs block">주공</span>
              <span className="font-bold text-[#1F2937]">{owner.username}</span>
            </div>
          )}
          {friendDeclaration && (
            <div className="bg-white px-3 py-1.5 rounded-lg shadow-sm border border-[#E5E7EB]">
              <span className="text-[#6B7280] text-xs block">프렌드</span>
              <span className="font-bold text-[#1F2937]">
                {friend ? friend.username : friendRevealed ? '없음' : '비공개'}
                <span className="ml-1 text-xs font-normal text-[#6B7280]">({friendText(friendDeclaration)})</span>
              </span>
            </div>
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${phase === 'BIDDING' ? 'bg-[#FEF3C7] text-[#92400E]' : phase === 'TRICK_PLAYING' ? 'bg-[#D1FAE5] text-[#047857]' : 'bg-[#E5E7EB] text-[#6B7280]'}`}>
            {PHASE_LABEL[phase]}
          </span>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] max-w-[90vw] p-3 bg-[#FEE2E2] rounded-xl shadow-lg text-sm text-[#991B1B] flex items-center justify-between"
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 font-bold" aria-label="닫기">×</button>
        </div>
      )}

      <div className="max-w-7xl mx-auto relative h-[600px]">
        {players.map((p: PlayerType) => (
          <PlayerArea key={p.id} player={p} isCurrentTurn={p.id === turnPlayerId} />
        ))}
        <TrickBoard />
        {phase === 'BIDDING' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <BiddingPanel />
          </div>
        )}
        {aiThinking && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-white/90 px-4 py-1.5 rounded-full shadow border border-[#E5E7EB] text-sm text-[#6B7280] animate-pulse whitespace-nowrap">
            {turnPlayer?.username} 님이 진행 중...
          </div>
        )}
      </div>

      <KittyExchangeModal />
      <FriendSelectionPanel />

      <UserHand />

      {phase === 'GAME_OVER' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-2xl">
            <h2 className="text-2xl font-bold text-[#1F2937] mb-2">게임 종료</h2>
            {result ? (
              <p className="text-[#6B7280] mb-6">
                {result.isWin ? '주공팀 승리' : '야당팀 승리'} (주공팀 {result.teamPoints} / 야당 {result.opponentPoints} / 비딩 {result.bidScore})
              </p>
            ) : (
              <p className="text-[#6B7280] mb-6">결과를 확인하세요.</p>
            )}
            <button
              onClick={() => {
                leaveRoom();
                router.push('/lobby');
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
