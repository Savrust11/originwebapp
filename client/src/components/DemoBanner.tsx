import { Eye, X } from "lucide-react";
import { isDemoMode, exitDemoMode } from "@/lib/demo";

export default function DemoBanner() {
  if (!isDemoMode()) return null;

  const handleExit = () => {
    exitDemoMode();
    window.location.href = "/";
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[150] flex items-center justify-center gap-2 bg-purple-600 text-white px-3 py-1.5 text-xs font-bold shadow-md"
      data-testid="banner-demo"
    >
      <Eye className="w-3.5 h-3.5 shrink-0" />
      <span>デモモード（閲覧用・記録は保存されません）</span>
      <button
        onClick={handleExit}
        className="ml-2 flex items-center gap-0.5 rounded-full bg-white/20 px-2 py-0.5 active:scale-95 transition-transform"
        data-testid="button-demo-exit"
      >
        <X className="w-3 h-3" />
        終了
      </button>
    </div>
  );
}
