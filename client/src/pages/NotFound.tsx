import { AlertCircle } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-background text-foreground">
      <section className="w-full max-w-lg mx-4 p-8 text-center border border-border rounded-lg bg-card">
        <AlertCircle className="mx-auto mb-6 h-16 w-16 text-destructive" aria-hidden="true" />
        <h1 className="text-4xl font-bold mb-2">404</h1>
        <p className="text-muted-foreground mb-8">页面不存在，或已被移动。</p>
        <button type="button" onClick={() => setLocation("/")}>
          返回首页
        </button>
      </section>
    </main>
  );
}
