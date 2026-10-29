import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-pastel-bg flex flex-col items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-md border border-pastel-border text-center">
        <h1 className="text-3xl font-bold text-pastel-text mb-2">마이티 (Mighty)</h1>
        <p className="text-pastel-muted mb-8">한국 전통 트릭테이킹 카드 게임</p>
        <Link href="/lobby" className="w-full py-4 bg-pastel-accentHover text-white rounded-xl font-semibold hover:bg-pastel-accentDeep transition-colors block mb-4">
          게임 시작하기
        </Link>
      </div>
    </div>
  );
}
