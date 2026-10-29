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

  const me = players.find((p) => p.seat === 'bottom');
  const aiPlayers = players.filter((p) => p.seat !== 'bottom');
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
    <div className="min-h-screen flex flex-col bg-pastel-bg p-2 md:p-4">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3 md:mb-6 px-2 md:px-4 w-full max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pastel-accentHover flex items-center justify-center text-white font-bold">M</div>
          <div>
            <h1 className="text-lg font-bold text-pastel-text">마이티</h1>
            <p className="text-xs text-pastel-muted">방 {roomId}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:gap-4 text-sm">
          <div className="bg-white px-2 py-1 md:px-3 md:py-1.5 rounded-lg shadow-sm border border-pastel-border">
            <span className="text-pastel-muted text-xs block">{bidFixed ? '비딩 점수' : '최고 비딩'}</span>
            <span className="font-bold text-pastel-text">{highestBid ? `${highestBid.score}점` : '-'}</span>
          </div>
          <div className="bg-white px-2 py-1 md:px-3 md:py-1.5 rounded-lg shadow-sm border border-pastel-border">
            <span className="text-pastel-muted text-xs block">기루다</span>
            <span className="font-bold text-pastel-text text-lg leading-tight">
              {shownGiruda ? <SuitIcon giruda={shownGiruda} /> : '-'}
            </span>
          </div>
          {owner && (
            <div className="bg-white px-2 py-1 md:px-3 md:py-1.5 rounded-lg shadow-sm border border-pastel-border">
              <span className="text-pastel-muted text-xs block">주공</span>
              <span className="font-bold text-pastel-text">{owner.username}</span>
            </div>
          )}
          {friendDeclaration && (
            <div className="bg-white px-2 py-1 md:px-3 md:py-1.5 rounded-lg shadow-sm border border-pastel-border">
              <span className="text-pastel-muted text-xs block">프렌드</span>
              <span className="font-bold text-pastel-text">
                {friend ? friend.username : friendRevealed ? '없음' : '비공개'}
                <span className="ml-1 text-xs font-normal text-pastel-muted">({friendText(friendDeclaration)})</span>
              </span>
            </div>
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${phase === 'BIDDING' ? 'bg-pastel-warn text-pastel-warnText' : phase === 'TRICK_PLAYING' ? 'bg-pastel-ok text-pastel-okText' : 'bg-pastel-border text-pastel-muted'}`}>
            {PHASE_LABEL[phase]}
          </span>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] max-w-[90vw] p-3 bg-pastel-danger rounded-xl shadow-lg text-sm text-pastel-dangerText flex items-center justify-between"
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 font-bold" aria-label="닫기">×</button>
        </div>
      )}

      {/*
        Mobile (portrait): a column - AI status row (4 across), trick board, my status bar.
        md and up: one relative board; each PlayerArea is absolutely seated around the central trick board.
      */}
      <div className="flex-1 w-full max-w-7xl mx-auto flex flex-col gap-2 md:gap-0 md:relative md:block md:h-[30rem] md:flex-none">
        <div className="grid grid-cols-4 gap-1 md:contents">
          {aiPlayers.map((p: PlayerType) => (
            <PlayerArea key={p.id} player={p} isCurrentTurn={p.id === turnPlayerId} />
          ))}
        </div>
        {/* Nothing is on the table while bidding: on mobile the bidding panel takes the board's place. */}
        <div className={phase === 'BIDDING' ? 'hidden md:contents' : 'contents'}>
          <TrickBoard />
        </div>
        {me && <PlayerArea player={me} isCurrentTurn={me.id === turnPlayerId} />}
        {phase === 'BIDDING' && (
          <div className="flex justify-center pointer-events-none md:absolute md:inset-0 md:z-30 md:items-center">
            <BiddingPanel />
          </div>
        )}
        {aiThinking && (
          <div className="self-center z-20 bg-white/90 px-4 py-1.5 rounded-full shadow border border-pastel-border text-sm text-pastel-muted animate-pulse whitespace-nowrap md:absolute md:bottom-12 md:left-1/2 md:-translate-x-1/2">
            {turnPlayer?.username} 님이 진행 중...
          </div>
        )}
      </div>

      <KittyExchangeModal />
      <FriendSelectionPanel />

      <div className="w-full max-w-7xl mx-auto">
        <UserHand />
      </div>

      {phase === 'GAME_OVER' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-2xl">
            <h2 className="text-2xl font-bold text-pastel-text mb-2">게임 종료</h2>
            {result ? (
              <p className="text-pastel-muted mb-6">
                {result.isWin ? '주공팀 승리' : '야당팀 승리'} (주공팀 {result.teamPoints} / 야당 {result.opponentPoints} / 비딩 {result.bidScore})
              </p>
            ) : (
              <p className="text-pastel-muted mb-6">결과를 확인하세요.</p>
            )}
            <button
              onClick={() => {
                leaveRoom();
                router.push('/lobby');
              }}
              className="w-full py-3 bg-pastel-accentHover text-white rounded-xl font-semibold hover:bg-pastel-accentDeep transition-colors"
            >
              로비로 돌아가기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
