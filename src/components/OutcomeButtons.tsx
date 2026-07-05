import { cn } from "@/lib/utils";
import type { Outcome } from "@/lib/types";
import { Check, RotateCcw, MessageCircle, X } from "lucide-react";

interface Props {
  onOutcome: (o: Outcome) => void;
  disabled?: boolean;
}

export function OutcomeButtons({ onOutcome, disabled }: Props) {
  const btn =
    "flex flex-col items-center justify-center gap-1 py-4 rounded-2xl text-sm md:text-base font-medium transition-all active:scale-95 disabled:opacity-40";
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <button
          aria-label="Got it"
          onClick={() => onOutcome("got_it")}
          disabled={disabled}
          className={cn(btn, "bg-[hsl(100_30%_82%)] text-[hsl(130_35%_25%)] hover:bg-[hsl(100_30%_76%)]")}
        >
          <Check className="w-6 h-6" strokeWidth={2.5} />
          <span>Got it</span>
        </button>
        <button
          aria-label="Self-corrected"
          onClick={() => onOutcome("self_corrected")}
          disabled={disabled}
          className={cn(btn, "bg-[hsl(170_35%_82%)] text-[hsl(180_40%_22%)] hover:bg-[hsl(170_35%_76%)]")}
        >
          <RotateCcw className="w-6 h-6" strokeWidth={2.5} />
          <span>Self-corrected</span>
        </button>
        <button
          aria-label="Prompted"
          onClick={() => onOutcome("prompted")}
          disabled={disabled}
          className={cn(btn, "bg-[hsl(40_60%_88%)] text-[hsl(30_50%_35%)] hover:bg-[hsl(40_60%_82%)]")}
        >
          <MessageCircle className="w-6 h-6" strokeWidth={2.5} />
          <span>Prompted</span>
        </button>
        <button
          aria-label="Missed"
          onClick={() => onOutcome("missed")}
          disabled={disabled}
          className={cn(btn, "bg-[hsl(20_40%_92%)] text-[hsl(5_55%_45%)] hover:bg-[hsl(20_40%_88%)]")}
        >
          <X className="w-6 h-6" strokeWidth={2.5} />
          <span>Missed</span>
        </button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground text-center leading-snug px-2">
        <b>Got it</b>: first try, unaided. <b>Self-corrected</b>: said wrong, then fixed it themselves.
        <b> Prompted</b>: needed a hint (e.g. "what's that sound in English?"). <b>Missed</b>: couldn't read it.
      </p>
    </div>
  );
}
