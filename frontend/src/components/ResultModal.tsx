'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore, type PlayerRole, type Player as PlayerType } from '@/store/useGameStore';
import { sortHand } from '@/lib/cards';
import { CardChip, SuitIcon, girudaLabel } from './SuitIcon';

export const ROLE_LABEL: Record<PlayerRole, string> = {
  OWNER: '주공',
  FRIEND: '프렌드',
  OPPOSER: '야당',
};

function CardChips({ players, giruda }: { players: PlayerType[]; giruda: string }) {
  const cards = sortHand(
    players.flatMap((p) => p.collectedScoreCards),
    giruda,
  );
  if (cards.length === 0) return <p className="text-xs text-pastel-muted">획득한 점수 카드가 없습니다.</p>;
  return (
    <div className="flex flex-wrap gap-0.5" aria-label="획득한 점수 카드">
      {cards.map((c) => (
        <CardChip key={c.id} card={c} />
      ))}
    </div>
  );
}

/** Game-over dialog: outcome for the human, roles, scores per team, and the "play again" / "lobby" choices. */
export function ResultModal() {
  const router = useRouter();
  const result = useGameStore((s) => s.result);
  const players = useGameStore((s) => s.players);
  const playerId = useGameStore((s) => s.playerId);
  const username = useGameStore((s) => s.username);
  const createRoom = useGameStore((s) => s.createRoom);
  const leaveRoom = useGameStore((s) => s.leaveRoom);
  const [busy, setBusy] = useState(false);

  const goLobby = () => {
    leaveRoom();
    router.push('/lobby');
  };

  const playAgain = async () => {
    if (busy || !username) return;
    setBusy(true);
    try {
      // Drop the finished room first, then deal a fresh one for the same nickname.
      leaveRoom();
      if (await createRoom(username)) router.push(`/game/${useGameStore.getState().roomId}`);
      else router.push('/lobby');
    } finally {
      setBusy(false);
    }
  };

  const myRole = result?.players.find((p) => p.playerId === playerId)?.role;
  // The owner team wins together; the opposition wins when the owner team misses the bid.
  const iWon = result && myRole ? (myRole === 'OPPOSER' ? !result.isWin : result.isWin) : null;
  const nameOf = (id: string | null) => players.find((p) => p.id === id)?.username;
  const teamPlayers = (ownerTeam: boolean) =>
    players.filter((p) => (result?.players.find((r) => r.playerId === p.id)?.role !== 'OPPOSER') === ownerTeam);

  return (
    <div role="dialog" aria-modal="true" aria-label="게임 결과" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl p-6 md:p-8 w-full max-w-md max-h-[90vh] overflow-y-auto text-center shadow-2xl">
        {result ? (
          <>
            <h2 className={`text-3xl font-bold mb-1 ${iWon ? 'text-pastel-okText' : iWon === false ? 'text-pastel-dangerText' : 'text-pastel-text'}`}>
              {iWon === null ? '게임 종료' : iWon ? '승리!' : '패배'}
            </h2>
            <p className="text-sm text-pastel-muted mb-4">
              {result.isWin ? '주공팀 승리' : '야당팀 승리'}
              {myRole && <span> · 내 역할 <span className="font-bold text-pastel-text">{ROLE_LABEL[myRole]}</span></span>}
            </p>

            <div className="grid grid-cols-3 gap-2 mb-4 text-sm">
              <div className="rounded-xl bg-pastel-bg p-2">
                <span className="block text-xs text-pastel-muted">비딩 점수</span>
                <span className="font-bold text-pastel-text">{result.bidScore}점</span>
              </div>
              <div className="rounded-xl bg-pastel-bg p-2">
                <span className="block text-xs text-pastel-muted">주공팀 획득</span>
                <span className="font-bold text-pastel-text">{result.teamPoints}점</span>
              </div>
              <div className="rounded-xl bg-pastel-bg p-2" title={girudaLabel(result.giruda)}>
                <span className="block text-xs text-pastel-muted">기루다</span>
                <span className="font-bold text-pastel-text text-lg leading-tight">
                  <SuitIcon giruda={result.giruda} />
                </span>
              </div>
            </div>

            <div className="space-y-3 mb-6 text-left">
              <section className="rounded-xl border border-pastel-border p-3">
                <h3 className="text-sm font-bold text-pastel-text mb-1">
                  주공팀 <span className="text-pastel-muted font-normal">({result.teamPoints}장)</span>
                </h3>
                <p className="text-xs text-pastel-muted mb-2">
                  주공 {nameOf(result.ownerPlayerId) ?? '-'} · 프렌드 {nameOf(result.friendPlayerId) ?? '없음'}
                </p>
                <CardChips players={teamPlayers(true)} giruda={result.giruda} />
              </section>
              <section className="rounded-xl border border-pastel-border p-3">
                <h3 className="text-sm font-bold text-pastel-text mb-1">
                  야당팀 <span className="text-pastel-muted font-normal">({result.opponentPoints}장)</span>
                </h3>
                <p className="text-xs text-pastel-muted mb-2">
                  {teamPlayers(false).map((p) => p.username).join(', ')}
                </p>
                <CardChips players={teamPlayers(false)} giruda={result.giruda} />
              </section>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-pastel-text mb-2">게임 종료</h2>
            <p className="text-pastel-muted mb-6">결과를 확인하세요.</p>
          </>
        )}

        <div className="flex gap-2">
          <button
            onClick={playAgain}
            disabled={busy || !username}
            className="flex-1 py-3 bg-pastel-accentHover text-white rounded-xl font-semibold hover:bg-pastel-accentDeep disabled:opacity-50 transition-colors"
          >
            {busy ? '준비 중...' : '다시 하기'}
          </button>
          <button
            onClick={goLobby}
            disabled={busy}
            className="flex-1 py-3 bg-white text-pastel-accentHover border-2 border-pastel-accentHover rounded-xl font-semibold hover:bg-pastel-bg disabled:opacity-50 transition-colors"
          >
            로비로
          </button>
        </div>
      </div>
    </div>
  );
}
