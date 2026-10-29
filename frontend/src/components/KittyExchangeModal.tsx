'use client';

import { useState } from 'react';
import { Card } from './Card';
import { SuitIcon, girudaLabel } from './SuitIcon';
import { useGameStore, type BidGiruda, type Card as CardType } from '@/store/useGameStore';

const KITTY_SIZE = 3;
const GIRUDA_CHANGE_RAISE = 2;
const MAX_BID = 20;
const GIRUDAS: BidGiruda[] = ['SPADE', 'DIAMOND', 'HEART', 'CLUB', 'NO_GIRUDA'];

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_ORDER = ['SPADE', 'DIAMOND', 'HEART', 'CLUB', 'JOKER'];
const byStrength = (a: CardType, b: CardType) =>
  SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);

/** The president picks up the kitty (hand 10 + kitty 3), discards 3 and confirms/changes the giruda. */
export function KittyExchangeModal() {
  const phase = useGameStore((s) => s.phase);
  const isPresident = useGameStore((s) => s.ownerPlayerId !== '' && s.ownerPlayerId === s.playerId);
  const hand = useGameStore((s) => s.players.find((p) => p.id === s.playerId)?.hand);
  const kitty = useGameStore((s) => s.kitty);
  const bidGiruda = useGameStore((s) => s.highestBid?.giruda ?? 'NO_GIRUDA');
  const bidScore = useGameStore((s) => s.highestBid?.score ?? 0);
  const exchangeKitty = useGameStore((s) => s.exchangeKitty);

  const [discard, setDiscard] = useState<string[]>([]);
  const [giruda, setGiruda] = useState<BidGiruda | null>(null);
  const [raised, setRaised] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (phase !== 'KITTY_EXCHANGE' || !isPresident || !hand) return null;

  const finalGiruda = giruda ?? bidGiruda;
  const changed = finalGiruda !== bidGiruda;
  const minRaise = bidScore + GIRUDA_CHANGE_RAISE;
  const raiseImpossible = changed && minRaise > MAX_BID;
  const finalScore = changed ? Math.max(raised ?? minRaise, minRaise) : bidScore;
  const cards = [...hand, ...kitty].sort(byStrength);
  const kittyIds = new Set(kitty.map((c) => c.id));
  const ready = discard.length === KITTY_SIZE && !raiseImpossible && !busy;

  const toggle = (id: string) =>
    setDiscard((d) => (d.includes(id) ? d.filter((x) => x !== id) : d.length < KITTY_SIZE ? [...d, id] : d));

  const confirm = async () => {
    setBusy(true);
    await exchangeKitty({
      discardCardIds: discard,
      ...(changed ? { giruda: finalGiruda, bidScore: finalScore } : {}),
    });
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 overflow-auto">
      <div role="dialog" aria-label="바닥패 교환" className="bg-white rounded-2xl shadow-2xl p-6 max-w-5xl w-full space-y-4">
        <div>
          <h2 className="text-xl font-bold text-pastel-text">바닥패 교환</h2>
          <p className="text-sm text-pastel-muted">
            바닥패 3장이 손패에 합쳐졌습니다. 버릴 카드 {KITTY_SIZE}장을 선택하세요. ({discard.length}/{KITTY_SIZE})
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2 pt-3">
          {cards.map((card) => (
            <div key={card.id} className="relative">
              {kittyIds.has(card.id) && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 text-[10px] bg-pastel-accent text-white px-1.5 rounded-full">
                  바닥패
                </span>
              )}
              <Card card={card} selectable selected={discard.includes(card.id)} onSelect={toggle} />
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-sm text-pastel-muted">
            기루다 (현재 {bidScore}점 <SuitIcon giruda={bidGiruda} />) — 바꾸면 최소 {minRaise}점으로 올려야 합니다.
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            {GIRUDAS.map((g) => (
              <button
                key={g}
                type="button"
                aria-label={girudaLabel(g)}
                aria-pressed={finalGiruda === g}
                onClick={() => {
                  setGiruda(g);
                  setRaised(null);
                }}
                className={`w-14 py-2 rounded-xl border text-xl ${
                  finalGiruda === g ? 'border-pastel-accentHover bg-purple-50 ring-2 ring-pastel-accent' : 'border-pastel-border'
                }`}
              >
                <SuitIcon giruda={g} />
              </button>
            ))}
            {changed && !raiseImpossible && (
              <label className="flex items-center gap-2 text-sm ml-2">
                올릴 점수
                <select
                  value={finalScore}
                  onChange={(e) => setRaised(Number(e.target.value))}
                  className="rounded-lg border border-pastel-border px-2 py-1"
                >
                  {Array.from({ length: MAX_BID - minRaise + 1 }, (_, i) => minRaise + i).map((s) => (
                    <option key={s} value={s}>
                      {s}점
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {raiseImpossible && <p className="text-xs text-red-600">점수를 더 올릴 수 없어 기루다를 바꿀 수 없습니다.</p>}
        </div>

        <button
          type="button"
          disabled={!ready}
          onClick={confirm}
          className="w-full py-3 rounded-xl bg-pastel-accentHover text-white font-semibold disabled:opacity-40"
        >
          {changed ? `기루다 변경(${finalScore}점) 후 ` : ''}선택한 {KITTY_SIZE}장 버리기
        </button>
      </div>
    </div>
  );
}
