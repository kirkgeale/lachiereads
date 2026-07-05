import { cn } from "@/lib/utils";
import type { SessionCard } from "@/lib/types";

interface Props {
  card: SessionCard;
  stageLabel?: string;
}

export function ItemCard({ card, stageLabel }: Props) {
  const isSentence = card.meta?.kind === "sentence";
  const isLong = card.display.length > 12;
  const displaySize = isSentence ? "text-4xl md:text-5xl" : isLong ? "text-5xl md:text-6xl" : "text-8xl md:text-9xl";
  const upper = card.display.toUpperCase();
  const lower = card.display.toLowerCase();
  const showPair = !isSentence && upper !== lower;
  const sentenceDisplay = isSentence
    ? card.display.replace(/\b([a-z])/g, (m) => m.toUpperCase())
    : card.display;

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-8">
      {stageLabel && (
        <span className="text-xs uppercase tracking-widest text-muted-foreground">{stageLabel}</span>
      )}
      <div className="w-full min-h-[16rem] flex flex-col items-center justify-center gap-3 rounded-[2rem] bg-card border border-border/60 shadow-sm px-6 py-10">
        <div className={cn("font-display font-semibold text-center text-primary leading-tight", displaySize)}>
          {isSentence ? sentenceDisplay.toUpperCase() : upper}
        </div>
        {showPair && (
          <div className="text-2xl md:text-3xl font-display text-muted-foreground/70 leading-none tracking-wide">
            {lower}
          </div>
        )}
      </div>
      {card.sound_label && (
        <div className="text-center">
          <div className="text-lg text-muted-foreground italic">Sound: {card.sound_label}</div>
          {card.example_word && (
            <div className="text-sm text-muted-foreground mt-1">e.g. {card.example_word}</div>
          )}
        </div>
      )}
      {card.interference && (
        <div className="w-full rounded-2xl bg-[hsl(200_40%_92%)] border border-[hsl(200_35%_78%)] px-5 py-4 text-[hsl(200_35%_25%)]">
          <div className="text-xs uppercase tracking-wider mb-1 opacity-70">Heads-up</div>
          <div className="text-base">
            In Swedish this often says <b>{card.interference.swedish_value}</b> — in English it says <b>{card.interference.english_value}</b>.
          </div>
          <div className="text-sm mt-1 opacity-80">Try it: <i>{card.interference.example_word}</i></div>
        </div>
      )}
    </div>
  );
}
