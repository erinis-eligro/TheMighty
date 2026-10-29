'use client';

import { useState } from 'react';
import { useGameStore, type BidGiruda } from '@/store/useGameStore';
import { SuitIcon, girudaLabel } from './SuitIcon';

const MIN_BID = 13;
const MAX_BID = 20;
const SCORES = Array.from({ length: MAX_BID - MIN_BID + 1 }, (_, i) => MIN_BID + i);
const GIRUDAS: BidGiruda[] = ['SPADE', 'DIAMOND', 'HEART', 'CLUB', 'NO_GIRUDA'];

/** Same ordering as the server: higher score wins, at equal score no-giruda beats a suit. */
const bidRank = (score: number, giruda: BidGiruda) => score * 2 + (giruda === 'NO_GIRUDA' ? 1 : 0);

/** Lowest score that beats the current highest bid with `giruda` (the server still validates). */
function lowestScore(giruda: BidGiruda, current: { score: number; giruda: BidGiruda } | null): number | null {
  return SCORES.find((s) => !current || bidRank(s, giruda) > bidRank(current.score, current.giruda)) ?? null;
}

export function BiddingPanel() {
  const players = useGameStore((s) => s.players);
  const playerId = useGameStore((s) => s.playerId);
  const highestBid = useGameStore((s) => s.highestBid);
  const isMyTurn = useGameStore((s) => s.players[s.currentTurnIndex]?.id === s.playerId);
  const turnName = useGameStore((s) => s.players[s.currentTurnIndex]?.username);
  const placeBid = useGameStore((s) => s.placeBid);

  const [score, setScore] = useState(MIN_BID);
  const [giruda, setGiruda] = useState<BidGiruda>('SPADE');
  const [busy, setBusy] = useState(false);

  const current = highestBid ? { score: highestBid.score, giruda: highestBid.giruda } : null;
  const minScore = lowestScore(giruda, current);
  const effectiveScore = minScore === null ? score : Math.max(score, minScore);
  const canBid = isMyTurn && !busy && minScore !== null;
  const leader = highestBid ? players[highestBid.bidderIndex] : undefined;

  const submit = async (action: { bid?: number; giruda?: string; pass?: boolean }) => {
    setBusy(true);
    await placeBid(action);
    setBusy(false);
  };

  return (
    <section
      aria-label="비딩"
      className="pointer-events-auto w-[22rem] max-w-full bg-white rounded-2xl shadow-xl border border-pastel-border p-4 space-y-3"
    >
      <h2 className="font-bold text-pastel-text">비딩</h2>

      <div className="text-sm text-pastel-muted">
        {highestBid && leader ? (
          <>
            현재 최고: <b className="text-pastel-text">{leader.username}</b> {highestBid.score}점{' '}
            <SuitIcon giruda={highestBid.giruda} className="text-base" />
          </>
        ) : (
          '아직 비딩한 사람이 없습니다.'
        )}
      </div>

      <ul className="grid grid-cols-5 gap-1 text-center text-xs">
        {players.map((p, i) => {
          const label = p.hasPassed ? '패스' : p.bid !== undefined ? `${p.bid}점` : '대기';
          return (
            <li
              key={p.id}
              className={`rounded-xl px-1 py-1.5 border ${
                p.hasPassed
                  ? 'bg-gray-100 border-pastel-border text-pastel-muted'
                  : highestBid?.bidderIndex === i
                    ? 'bg-pastel-warn border-pastel-warnText text-pastel-warnText font-bold'
                    : 'bg-white border-pastel-border text-pastel-text'
              }`}
            >
              <div className="truncate">{p.id === playerId ? '나' : p.username}</div>
              <div>{label}</div>
            </li>
          );
        })}
      </ul>

      {isMyTurn ? (
        <div className="space-y-3">
          <div>
            <div className="text-xs text-pastel-muted mb-1">기루다</div>
            <div className="flex gap-1">
              {GIRUDAS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGiruda(g)}
                  aria-pressed={giruda === g}
                  aria-label={girudaLabel(g)}
                  className={`flex-1 py-2 rounded-xl border text-xl ${
                    giruda === g ? 'border-pastel-accentHover bg-purple-50 ring-2 ring-pastel-accent' : 'border-pastel-border bg-white'
                  }`}
                >
                  <SuitIcon giruda={g} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-pastel-muted mb-1">점수</div>
            <div className="grid grid-cols-8 gap-1">
              {SCORES.map((s) => {
                const disabled = minScore === null || s < minScore;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    onClick={() => setScore(s)}
                    aria-pressed={effectiveScore === s}
                    className={`py-1.5 rounded-lg border text-sm font-semibold ${
                      effectiveScore === s && !disabled
                        ? 'bg-pastel-accentHover text-white border-pastel-accentHover'
                        : 'bg-white text-pastel-text border-pastel-border'
                    } disabled:opacity-30`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canBid}
              onClick={() => submit({ bid: effectiveScore, giruda })}
              className="flex-1 py-2.5 rounded-xl bg-pastel-accentHover text-white font-semibold disabled:opacity-40"
            >
              {effectiveScore}점 <SuitIcon giruda={giruda} className="!text-white" /> 비딩
            </button>
            <button
              type="button"
              disabled={!isMyTurn || busy}
              onClick={() => submit({ pass: true })}
              className="px-5 py-2.5 rounded-xl bg-gray-100 text-pastel-text font-semibold border border-pastel-border disabled:opacity-40"
            >
              패스
            </button>
          </div>
          {minScore === null && <p className="text-xs text-pastel-muted">이 기루다로는 더 높게 비딩할 수 없습니다.</p>}
        </div>
      ) : (
        <p className="text-sm text-pastel-muted animate-pulse">{turnName ?? '상대'} 님이 비딩 중...</p>
      )}
    </section>
  );
}
