'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/store/useGameStore';

export default function LobbyPage() {
  const { socket, isConnected } = useGameStore();
  const store = useGameStore.getState();

  useEffect(() => {
    if (!socket) {
      store.connect();
    }
  }, [socket]);

  return (
    <div className="min-h-screen bg-[#F7F5FA] flex flex-col items-center justify-center p-6">
      <div
        className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-md border border-[#E5E7EB] animate-in fade-in slide-in-from-bottom-4 duration-500"
      >
        <h1 className="text-3xl font-bold text-center text-[#1F2937] mb-1 tracking-tight">마이티 (Mighty)</h1>
        <p className="text-center text-[#6B7280] mb-8">한국 전통 트릭테이킹 카드 게임</p>

        <div className="space-y-3">
          <button
            onClick={() => {
              const name = prompt('닉네임을 입력하세요') || '플레이어';
              socket?.emit('create_room', { username: name }, (data: any) => {
                if (data?.roomId) {
                  store.setRoom(data.roomId, data.playerId, name);
                }
              });
            }}
            disabled={!isConnected}
            className="w-full py-4 bg-[#8B5CF6] text-white rounded-xl font-semibold hover:bg-[#7C3AED] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
          >
            방 만들기 (주공)
          </button>
          <button
            onClick={() => {
              const room = prompt('방 코드를 입력하세요');
              const name = prompt('닉네임을 입력하세요') || '플레이어';
              if (!socket || !room) return;
              socket.emit('join_room', { roomId: room, username: name }, (data: any) => {
                if (data?.roomId) {
                  store.setRoom(data.roomId, data.playerId, name);
                }
              });
            }}
            disabled={!isConnected}
            className="w-full py-4 bg-white text-[#8B5CF6] border-2 border-[#8B5CF6] rounded-xl font-semibold hover:bg-[#8B5CF6]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            방에 입장하기
          </button>
        </div>

        {store.roomId && (
          <div className="mt-6 pt-6 border-t border-[#E5E7EB]">
            <p className="text-sm text-[#6B7280] mb-1">방 ID:
              <span className="font-mono font-bold text-[#1F2937] block">{store.roomId}</span>
            </p>
            <p className="text-xs text-[#9CA3AF]">당신: {store.username}</p>
            <button
              onClick={() => {
                socket?.emit('start_game', { roomId: store.roomId });
              }}
              className="mt-3 w-full py-2 bg-[#10B981] text-white rounded-lg text-sm font-semibold hover:bg-[#059669] transition-colors"
            >
              게임 시작
            </button>
          </div>
        )}

        {!isConnected && (
          <div className="mt-4 p-3 bg-[#FEE2E2] rounded-lg text-xs text-[#991B1B]">
            백엔드 연결 실패. NestJS 서버(http://localhost:3001)를 확인하세요.
          </div>
        )}
        {store.error && (
          <div className="mt-4 p-3 bg-[#FEE2E2] rounded-lg text-xs text-[#991B1B]">{store.error}</div>
        )}
      </div>
    </div>
  );
}
