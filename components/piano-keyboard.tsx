"use client";

import { useEffect, useRef } from "react";
import {
  PATTERN_MIDIS,
  PIANO_KEYS,
  WHITE_KEY_COUNT,
  computerLabel,
  type Highlight,
} from "@/lib/blues";
import { cn } from "@/lib/utils";

interface PianoKeyboardProps {
  highlights: Highlight[];
  pressed: ReadonlySet<number>;
  strayMidi: number | null;
  scrollRequest: { midi: number; nonce: number };
  onPress: (midi: number) => void;
  onRelease: (midi: number) => void;
}

export function PianoKeyboard({
  highlights,
  pressed,
  strayMidi,
  scrollRequest,
  onPress,
  onRelease,
}: PianoKeyboardProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const byMidi = new Map(highlights.map((note) => [note.midi, note]));
  const whites = PIANO_KEYS.filter((key) => !key.black);
  const blacks = PIANO_KEYS.filter((key) => key.black);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(
      `[data-midi="${scrollRequest.midi}"]`,
    );
    if (!target) return;
    const rootRect = root.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const delta =
      targetRect.left -
      rootRect.left -
      (root.clientWidth - targetRect.width) / 2;
    root.scrollBy({ left: delta, behavior: "smooth" });
  }, [scrollRequest]);

  return (
    <div
      ref={scrollerRef}
      className="overflow-x-auto rounded-2xl bg-[#1c1915] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
    >
      <div className="relative h-52 w-full min-w-[42rem]">
        <div className="flex h-full">
          {whites.map((key) => {
            const highlight = byMidi.get(key.midi);
            const pattern = PATTERN_MIDIS.has(key.midi);
            return (
              <button
                key={key.midi}
                type="button"
                data-midi={key.midi}
                aria-label={keyLabel(key.ru, key.letter, key.computer)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onPress(key.midi);
                }}
                onPointerUp={() => onRelease(key.midi)}
                onPointerCancel={() => onRelease(key.midi)}
                className={cn(
                  "relative flex h-full min-w-11 flex-1 flex-col items-center justify-end overflow-hidden rounded-b-md border border-[#d9d0c1] bg-[#fffdf8] pb-2 text-[#241c16] shadow-[0_2px_0_#cfc4b2] select-none",
                  pressed.has(key.midi) && "translate-y-px bg-[#f3ead8]",
                  strayMidi === key.midi && "ring-2 ring-[#a33b28]",
                )}
              >
                {key.midi === 48 || key.midi === 60 ? (
                  <span className="mb-0.5 h-1 w-4 rounded-full bg-[#7c4a03]" />
                ) : null}
                <span className="flex items-center gap-1">
                  {highlight ? (
                    <span
                      className="grid size-5 place-items-center rounded-full text-[11px] font-semibold text-white"
                      style={{ background: `var(--${highlight.tone})` }}
                    >
                      {highlight.finger}
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold">{key.letter}</span>
                </span>
                <span className="text-[11px] leading-4 text-[#5c5348]">
                  {key.ru}
                </span>
                {pattern && key.computer ? (
                  <span className="mt-0.5 font-mono text-[10px] text-[#8a8175]">
                    {computerLabel(key.computer)}
                  </span>
                ) : (
                  <span className="mt-0.5 h-3" />
                )}
                {highlight ? (
                  <span
                    className="absolute inset-x-1 bottom-1 h-1.5 rounded-full"
                    style={{ background: `var(--${highlight.tone})` }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        {blacks.map((key) => {
          const highlight = byMidi.get(key.midi);
          const pattern = PATTERN_MIDIS.has(key.midi);
          const width = (0.62 / WHITE_KEY_COUNT) * 100;
          const left =
            ((key.whiteIndex + 1) / WHITE_KEY_COUNT) * 100 - width / 2;
          return (
            <button
              key={key.midi}
              type="button"
              data-midi={key.midi}
              aria-label={keyLabel(key.ru, key.letter, key.computer)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                onPress(key.midi);
              }}
              onPointerUp={() => onRelease(key.midi)}
              onPointerCancel={() => onRelease(key.midi)}
              style={{ left: `${left}%`, width: `${width}%` }}
              className={cn(
                "absolute top-0 z-10 flex h-[58%] flex-col items-center justify-end overflow-hidden rounded-b-md bg-[#1a1714] px-0.5 pb-1.5 text-[#f4efe4] shadow-[0_8px_10px_rgba(0,0,0,0.35)] select-none",
                pressed.has(key.midi) && "h-[56%] bg-[#2a2622]",
                strayMidi === key.midi && "ring-2 ring-[#f0a090]",
              )}
            >
              {highlight ? (
                <span
                  className="mb-1 grid size-5 place-items-center rounded-full text-[10px] font-semibold text-white"
                  style={{ background: `var(--${highlight.tone})` }}
                >
                  {highlight.finger}
                </span>
              ) : null}
              {pattern ? (
                <>
                  <span className="text-[9px] leading-none">{key.ru}</span>
                  {key.computer ? (
                    <span className="mt-0.5 font-mono text-[9px] leading-none text-[#d9d0c1]">
                      {computerLabel(key.computer)}
                    </span>
                  ) : null}
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function keyLabel(
  ru: string,
  letter: string,
  computer?: { ru: string; en: string },
): string {
  const keys = computer ? `, клавиша ${computerLabel(computer)}` : "";
  return `${ru}, ${letter}${keys}`;
}
