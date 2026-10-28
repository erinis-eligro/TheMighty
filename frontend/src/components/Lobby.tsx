'use client';

import { motion } from 'framer-motion';
import { useGameStore } from '@/store/useGameStore';
import { emitWithAck } from '@/lib/socket';
import type { RoomAckData } from '@/types/protocol';

export function Lobby() {
  const { roomId, playerId, username, isConnected, error, setRoom, setError } = useGameStore();
  const socket = useGameStore((s) => s.socket);

  const createRoom = async () => {
    const name = prompt('닉네임을 입력하세요') || '플레이어';
    if (!socket) return;
    const res = await emitWithAck<RoomAckData>(socket, 'create_room', { username: name });
    if (res.ok) {
      setError(null);
      setRoom(res.data.roomId, res.data.playerId, name);
    } else {
      setError(res.error.message);
    }
  };

  const joinRoom = async () => {
    const room = prompt('방 코드를 입력하세요');
    const name = prompt('닉네임을 입력하세요') || '플레이어';
    if (!socket || !room) return;
    const res = await emitWithAck<RoomAckData>(socket, 'join_room', { roomId: room, username: name });
    if (res.ok) {
      setError(null);
      setRoom(res.data.roomId, res.data.playerId, name);
    } else {
      setError(res.error.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F5FA] flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-md border border-[#E5E7EB]"
      >
        <h1 className="text-3xl font-bold text-center text-[#1F2937] mb-2">마이티 (Mighty)</h1>
        <p className="text-center text-[#6B7280] mb-8">한국 전통 트릭테이킹 카드 게임</p>

        <div className="space-y-3">
          <button
            onClick={createRoom}
            disabled={!isConnected}
            className="w-full py-4 bg-[#8B5CF6] text-white rounded-xl font-semibold hover:bg-[#7C3AED] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
          >
            방 만들기 (주공)
          </button>
          <button
            onClick={joinRoom}
            disabled={!isConnected}
            className="w-full py-4 bg-white text-[#8B5CF6] border-2 border-[#8B5CF6] rounded-xl font-semibold hover:bg-[#8B5CF6]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            방에 입장하기
          </button>
        </div>

        {roomId && (
          <div className="mt-6 pt-6 border-t border-[#E5E7EB]">
            <p className="text-sm text-[#6B7280] mb-2">방 ID: <span className="font-mono font-bold text-[#1F2937]">{roomId}</span></p>
            <p className="text-xs text-[#9CA3AF]">당신: {username}</p>
          </div>
        )}

        {!isConnected && (
          <div className="mt-4 p-3 bg-[#FEE2E2] rounded-lg text-xs text-[#991B1B]">
            백엔드 연결 실패. NestJS 서버(http://localhost:3001)를 확인하세요.
          </div>
        )}
        {error && (
          <div className="mt-4 p-3 bg-[#FEE2E2] rounded-lg text-xs text-[#991B1B]">{error}</div>
        )}
      </motion.div>
    </div>
  );
}
