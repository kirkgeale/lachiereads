import { cn } from "@/lib/utils";
import type { Outcome } from "@/lib/types";
import { Check, HelpCircle, X } from "lucide-react";

interface Props {
  onOutcome: (o: Outcome) => void;
  disabled?: boolean;
}

export function OutcomeButtons({ onOutcome, disabled }: Props) {
  const btn = "flex-1 flex flex-col items-center justify-center gap-1.5 py-6 rounded-3xl text-lg font-medium transition-all active:scale-95 disabled:opacity-40";
  return (
    <div className="flex gap-3 w-full max-w-2xl mx-auto">
      <button
        aria-label="Missed"
        onClick={() => onOutcome("missed")}
        disabled={disabled}
        className={cn(btn, "bg-[hsl(20_40%_92%)] text-[hsl(5_55%_45%)] hover:bg-[hsl(20_40%_88%)]")}
      >
        <X className="w-7 h-7" strokeWidth={2.5} />
        <span>Missed</span>
      </button>
      <button
        aria-label="Hesitated"
        onClick={() => onOutcome("hesitated")}
        disabled={disabled}
        className={cn(btn, "bg-[hsl(40_60%_88%)] text-[hsl(30_50%_35%)] hover:bg-[hsl(40_60%_82%)]")}
      >
        <HelpCircle className="w-7 h-7" strokeWidth={2.5} />
        <span>Hesitated</span>
      </button>
      <button
        aria-label="Got it"
        onClick={() => onOutcome("got_it")}
        disabled={disabled}
        className={cn(btn, "bg-[hsl(100_30%_82%)] text-[hsl(130_35%_25%)] hover:bg-[hsl(100_30%_76%)]")}
      >
        <Check className="w-7 h-7" strokeWidth={2.5} />
        <span>Got it</span>
      </button>
    </div>
  );
}
