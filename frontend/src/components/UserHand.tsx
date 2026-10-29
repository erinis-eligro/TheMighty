'use client';

import { useEffect, useState } from 'react';
import { Card } from './Card';
import { SuitIcon, SUIT_SYMBOL } from './SuitIcon';
import { sortHand } from '@/lib/cards';
import { useGameStore, type Card as CardType, type Suit } from '@/store/useGameStore';

const LEAD_SUITS: Suit[] = ['SPADE', 'DIAMOND', 'HEART', 'CLUB'];
const TOTAL_TRICKS = 10;

/** A card the player clicked that needs one more decision before it is sent. */
type Pending = { card: CardType; kind: 'JOKER_SUIT' | 'JOKER_CALL' };

/** Touch screens have no hover: a card is first raised by a tap and only sent by tapping it again. */
function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    setCoarse(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

export function UserHand() {
  const phase = useGameStore((s) => s.phase);
  const playableCardIds = useGameStore((s) => s.playableCardIds);
  const playCard = useGameStore((s) => s.playCard);
  const setError = useGameStore((s) => s.setError);
  const player = useGameStore((s) => s.players.find((p) => p.id === s.playerId));
  const isMyTurn = useGameStore((s) => s.players[s.currentTurnIndex]?.id === s.playerId);
  const giruda = useGameStore((s) => s.giruda);
  const leadSuit = useGameStore((s) => s.leadSuit);
  const isJokerCallActive = useGameStore((s) => s.isJokerCallActive);
  const jokerCallCard = useGameStore((s) => s.jokerCallCard);
  const currentTrick = useGameStore((s) => s.currentTrick);
  const currentTrickNumber = useGameStore((s) => s.currentTrickNumber);
  const [pending, setPending] = useState<Pending | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const coarse = useCoarsePointer();
  const isMyTurnNow = phase === 'TRICK_PLAYING' && isMyTurn;

  // The raised card is only valid while it is still my turn to play; drop it otherwise.
  useEffect(() => {
    if (!isMyTurnNow) setArmedId(null);
  }, [isMyTurnNow]);

  if (!player) return null;

  const trickPlaying = phase === 'TRICK_PLAYING';
  const myPlay = trickPlaying && isMyTurn;
  const isLeading = currentTrick === null;
  const hand = sortHand(player.hand, giruda);
  const isCallCard = (c: CardType) => !!jokerCallCard && c.suit === jokerCallCard.suit && c.rank === jokerCallCard.rank;

  const send = async (cardId: string, extra: { jokerCall?: boolean; jokerLeadSuit?: Suit } = {}) => {
    setPending(null);
    await playCard({ cardId, ...extra });
  };

  const handleSelect = (cardId: string) => {
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return;
    if (coarse && armedId !== cardId) {
      setPending(null);
      setArmedId(cardId);
      return;
    }
    setArmedId(null);
    // The server validates everything; these prompts only collect the extra choices of a leader.
    if (isLeading && card.isJoker && currentTrickNumber !== TOTAL_TRICKS) {
      setPending({ card, kind: 'JOKER_SUIT' });
    } else if (isLeading && isCallCard(card)) {
      setPending({ card, kind: 'JOKER_CALL' });
    } else {
      void send(cardId);
    }
  };

  // Explains (display only) why a card is greyed out; the server stays the judge of legality.
  const handleBlocked = (cardId: string) => {
    if (!trickPlaying) return;
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return;
    if (!isMyTurn) return setError('아직 당신의 차례가 아닙니다.');
    if (isJokerCallActive && jokerCallCard && !isCallCard(card) && player.hand.some(isCallCard)) {
      return setError(`조커콜! ${SUIT_SYMBOL[jokerCallCard.suit]}${jokerCallCard.rank} 카드를 내야 합니다.`);
    }
    if (!isLeading && leadSuit) return setError(`${SUIT_SYMBOL[leadSuit]} 무늬를 따라 내야 합니다.`);
    if (isLeading && card.isJoker) return setError('첫 트릭에서는 조커로 시작할 수 없습니다.');
    if (isLeading && card.suit === giruda) return setError('첫 트릭에서는 기루다로 시작할 수 없습니다.');
    setError('지금은 낼 수 없는 카드입니다.');
  };

  return (
    <div className="relative w-full">
      {pending && (
        <div
          role="dialog"
          aria-label={pending.kind === 'JOKER_SUIT' ? '조커 무늬 선택' : '조커콜 선언'}
          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-40 bg-white rounded-2xl shadow-xl border border-pastel-border p-4 flex flex-col items-center gap-3"
        >
          {pending.kind === 'JOKER_SUIT' ? (
            <>
              <p className="text-sm font-semibold text-pastel-text">조커로 시작할 무늬를 고르세요</p>
              <div className="flex gap-2">
                {LEAD_SUITS.map((suit) => (
                  <button
                    key={suit}
                    onClick={() => void send(pending.card.id, { jokerLeadSuit: suit })}
                    className="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-pastel-bg hover:bg-pastel-accent/30 text-2xl border border-pastel-border"
                  >
                    <SuitIcon giruda={suit} />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-pastel-text">
                조커콜 카드({SUIT_SYMBOL[pending.card.suit]}{pending.card.rank})입니다. 조커콜을 선언할까요?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => void send(pending.card.id, { jokerCall: true })}
                  className="px-4 py-2 rounded-xl bg-pastel-accentHover text-white text-sm font-semibold"
                >
                  조커콜 선언
                </button>
                <button
                  onClick={() => void send(pending.card.id)}
                  className="px-4 py-2 rounded-xl bg-pastel-bg border border-pastel-border text-sm font-semibold text-pastel-text"
                >
                  그냥 내기
                </button>
              </div>
            </>
          )}
          <button onClick={() => setPending(null)} className="text-xs text-pastel-muted">
            취소
          </button>
        </div>
      )}
      {/*
        Mobile: cards overlap like a fan and the row scrolls sideways when it still does not fit.
        md and up: a centred, loosely overlapping row.
      */}
      <div
        data-testid="user-hand"
        className="w-full overflow-x-auto overscroll-x-contain snap-x snap-mandatory px-2 pt-6 pb-3 md:px-4 md:pt-8 md:pb-6"
      >
        <div className="mx-auto flex w-max items-end">
          {hand.map((card: CardType) => {
            const playable = !card.hidden && playableCardIds.includes(card.id);
            return (
              <div
                key={card.id}
                className={`snap-center -ml-fan-overlap md:-ml-fan-overlap-md lg:-ml-fan-overlap-lg first:ml-0 hover:z-10 ${
                  armedId === card.id ? 'z-10 -translate-y-3' : ''
                } transition-transform`}
              >
                <Card
                  card={card}
                  selectable={myPlay && playable}
                  dimmed={myPlay && !playable}
                  selected={armedId === card.id}
                  onBlockedSelect={trickPlaying ? handleBlocked : undefined}
                  onSelect={handleSelect}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
