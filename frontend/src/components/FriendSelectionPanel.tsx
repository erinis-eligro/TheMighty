'use client';

import { useState } from 'react';
import { SuitIcon, SUIT_SYMBOL } from './SuitIcon';
import { useGameStore, type Card as CardType, type FriendDeclaration, type Suit } from '@/store/useGameStore';

const SUITS: Suit[] = ['SPADE', 'DIAMOND', 'HEART', 'CLUB'];
const RANKS: CardType['rank'][] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

type Mode = 'MIGHTY' | 'CARD' | 'FIRST_TRICK' | 'NO_FRIEND' | 'JOKER';

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'MIGHTY', label: '마이티 프렌드', hint: '마이티를 가진 사람' },
  { mode: 'JOKER', label: '조커 프렌드', hint: '조커를 가진 사람' },
  { mode: 'CARD', label: '카드 지정', hint: '지정한 카드를 가진 사람' },
  { mode: 'FIRST_TRICK', label: '초구 프렌드', hint: '첫 트릭을 따는 사람' },
  { mode: 'NO_FRIEND', label: '노프렌드', hint: '혼자 플레이' },
];

export function FriendSelectionPanel() {
  const phase = useGameStore((s) => s.phase);
  const isPresident = useGameStore((s) => s.ownerPlayerId !== '' && s.ownerPlayerId === s.playerId);
  const declareFriend = useGameStore((s) => s.declareFriend);
  const [mode, setMode] = useState<Mode>('MIGHTY');
  const [suit, setSuit] = useState<Suit>('SPADE');
  const [rank, setRank] = useState<CardType['rank']>('A');
  const [busy, setBusy] = useState(false);

  if (phase !== 'FRIEND_SELECTION' || !isPresident) return null;

  const declaration: FriendDeclaration = mode === 'CARD' ? { type: 'CARD', suit, rank } : { type: mode };

  const confirm = async () => {
    setBusy(true);
    await declareFriend(declaration);
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div role="dialog" aria-label="프렌드 선택" className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full space-y-4">
        <div>
          <h2 className="text-xl font-bold text-pastel-text">프렌드 선택</h2>
          <p className="text-sm text-pastel-muted">프렌드의 정체는 조건이 충족될 때까지 공개되지 않습니다.</p>
        </div>

        <div className="grid gap-2">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              aria-pressed={mode === m.mode}
              onClick={() => setMode(m.mode)}
              className={`text-left px-4 py-2.5 rounded-xl border ${
                mode === m.mode ? 'border-pastel-accentHover bg-purple-50 ring-2 ring-pastel-accent' : 'border-pastel-border'
              }`}
            >
              <span className="font-semibold text-pastel-text">{m.label}</span>
              <span className="ml-2 text-xs text-pastel-muted">{m.hint}</span>
            </button>
          ))}
        </div>

        {mode === 'CARD' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              {SUITS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-label={SUIT_SYMBOL[s]}
                  aria-pressed={suit === s}
                  onClick={() => setSuit(s)}
                  className={`flex-1 py-2 rounded-xl border text-xl ${
                    suit === s ? 'border-pastel-accentHover bg-purple-50 ring-2 ring-pastel-accent' : 'border-pastel-border'
                  }`}
                >
                  <SuitIcon giruda={s} />
                </button>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {RANKS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={rank === r}
                  onClick={() => setRank(r)}
                  className={`py-1.5 rounded-lg border text-sm font-semibold ${
                    rank === r ? 'bg-pastel-accentHover text-white border-pastel-accentHover' : 'border-pastel-border'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={confirm}
          className="w-full py-3 rounded-xl bg-pastel-accentHover text-white font-semibold disabled:opacity-40"
        >
          {MODES.find((m) => m.mode === mode)?.label} 선언
        </button>
      </div>
    </div>
  );
}
