import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#080a09] px-5 text-[#f1f3eb]">
      <section className="max-w-md border border-white/10 bg-[#111312] p-8 shadow-2xl" aria-labelledby="not-found-title">
        <AlertCircle className="mb-5 h-12 w-12 text-[#fa785e]" aria-hidden="true" />
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-[#c7f43d]">FLUXLAB / 404</p>
        <h1 id="not-found-title" className="mb-3 text-3xl font-bold">找不到此工作区</h1>
        <p className="mb-7 leading-6 text-[#b9c0b6]">该路径不存在，或已在现代化迁移中被重新组织。</p>
        <button type="button" onClick={handleGoHome} className="inline-flex items-center gap-2 border border-[#c7f43d] bg-[#c7f43d] px-4 py-2.5 font-semibold text-[#101307] transition-transform duration-150 active:scale-[.97]">
          <Home className="h-4 w-4" aria-hidden="true" />
          返回项目
        </button>
      </section>
    </main>
  );
}
