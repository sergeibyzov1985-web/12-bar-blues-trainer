"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { BluesEngine, type EngineEvent } from "@/lib/audio";
import {
  COMPUTER_KEYS,
  COUNT_WORDS,
  cellHighlights,
  hitsAt,
  chartFor,
  chordChanges,
  leftHandBar,
  loopRange,
  markFor,
  phraseForBar,
  previewNotes,
  rightHandBar,
  summarizeChorus,
  weakBars,
  type BarMark,
  type LoopMode,
  type StepId,
} from "@/lib/blues";
import { PianoKeyboard } from "@/components/piano-keyboard";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

const STEP_DEFAULTS: Record<
  StepId,
  { left: boolean; right: boolean; drums: boolean; hint: boolean }
> = {
  circle: { left: true, right: true, drums: true, hint: true },
  phrases: { left: true, right: true, drums: true, hint: true },
  piece: { left: true, right: true, drums: true, hint: true },
};

const GRADED = new Set<StepId>(["phrases", "piece"]);

const STEPS: Array<{
  id: StepId;
  kicker: string;
  nav: string;
  title: string;
  play: string;
  paragraphs: string[];
}> = [
  {
    id: "circle",
    kicker: "Урок 1",
    nav: "Круг",
    title: "Ровный круг",
    play: "Слушать круг",
    paragraphs: [
      "Двенадцать тактов, три аккорда. До — дом. Фа приходит на пятом такте. Соль в конце зовёт круг сначала. Считай вслух: раз, два, три, четыре.",
      "Левая не берёт аккорд. На такт две ноты: нижняя, как называется такт, и её пара. У до пара соль, у фа пара до, у соль пара ре. Пальцы 5 и 1, мизинец и большой.",
      "Правая все двенадцать тактов играет одно и то же: до, соль, си-бемоль, соль. Большой палец только на «раз», дальше мизинец. Си-бемоль — чёрная клавиша сразу слева от си. Руки можно выключать по одной, пока круг не соберётся.",
    ],
  },
  {
    id: "phrases",
    kicker: "Урок 2",
    nav: "Фразы",
    title: "Пауза, ответ и раннее фа",
    play: "Играть фразы",
    paragraphs: [
      "Правая на «четыре» молчит: до, соль, си-бемоль и тишина. В тактах 4 и 8 она отвечает: до, си-бемоль, соль, до. Последнее до берёт большой палец.",
      "Второй такт уже фа, не до. Левая уезжает сразу и на третьем такте возвращается. Смотри на цвет в начале круга.",
    ],
  },
  {
    id: "piece",
    kicker: "Урок 3",
    nav: "Пьеса",
    title: "Шаффл и поклон",
    play: "Сыграть пьесу",
    paragraphs: [
      "Теперь доля качается: длинная нота и короткая. Левая всё время чередует нижнюю и пару этим шагом. Правая тот же рифф, только короткие ноты сидят ближе к следующей доле.",
      "В конце третьего такта правая заранее берёт до — это затакт ответа. В тактах 9 и 10 удар только на «раз». В последнем такте обе руки ставят до и отпускают. Кнопка доигрывает пьесу один раз.",
    ],
  },
];

const TEMPOS = [
  { bpm: 60, label: "Медленно" },
  { bpm: 76, label: "Ровно" },
  { bpm: 96, label: "Бодрее" },
] as const;

type Summary = { title: string; detail: string; big: boolean };

interface Expectation {
  time: number;
  midis: number[];
  got: Set<number>;
  bar: number;
  lap: number;
}

interface LapBucket {
  hits: number;
  total: number;
  bars: Array<{ hits: number; total: number }>;
}

function emptyMarks(count = 12): BarMark[] {
  return Array.from({ length: count }, () => null);
}

export function Trainer() {
  const [step, setStep] = useState<StepId>("circle");
  const [bpm, setBpm] = useState(72);
  const [leftOn, setLeftOn] = useState(true);
  const [rightOn, setRightOn] = useState(true);
  const [drumsOn, setDrumsOn] = useState(true);
  const [hintOn, setHintOn] = useState(true);
  const [loopMode, setLoopMode] = useState<LoopMode>("all");
  const [focusBar, setFocusBar] = useState(0);
  const [loop, setLoop] = useState({ start: 0, bars: 12 });
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [countIn, setCountIn] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ bar: number; beat: number; at: number } | null>(
    null,
  );
  const [pressed, setPressed] = useState<ReadonlySet<number>>(new Set());
  const [strayMidi, setStrayMidi] = useState<number | null>(null);
  const [marks, setMarks] = useState<BarMark[]>(emptyMarks);
  const [liveHits, setLiveHits] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState({ midi: 48, nonce: 0 });

  const engineRef = useRef<BluesEngine | null>(null);
  const playingRef = useRef(false);
  const startingRef = useRef(false);
  const playToken = useRef(0);
  const heldRef = useRef(new Set<number>());
  const liveRef = useRef({
    grading: false,
    bpm: 72,
    loopStart: 0,
    loopBars: 12,
    barCount: 12,
    swing: false,
  });
  const barsRef = useRef(12);
  const matchRef = useRef<(midi: number, time: number) => string>(() => "idle");
  const resetScoreRef = useRef(() => {});
  const toggleRef = useRef(() => {});

  useEffect(() => {
    const engine = new BluesEngine();
    engineRef.current = engine;
    const expectations: Expectation[] = [];
    const laps = new Map<number, LapBucket>();
    let shownLap = -1;

    const ensureLap = (lap: number): LapBucket => {
      const size = Math.max(12, liveRef.current.barCount);
      let bucket = laps.get(lap);
      if (!bucket) {
        bucket = {
          hits: 0,
          total: 0,
          bars: Array.from({ length: size }, () => ({ hits: 0, total: 0 })),
        };
        laps.set(lap, bucket);
      } else if (bucket.bars.length < size) {
        while (bucket.bars.length < size) {
          bucket.bars.push({ hits: 0, total: 0 });
        }
      }
      return bucket;
    };

    resetScoreRef.current = () => {
      expectations.length = 0;
      laps.clear();
      shownLap = -1;
    };

    matchRef.current = (midi: number, time: number) => {
      if (!liveRef.current.grading) return "idle";
      const windowSec = liveRef.current.swing
        ? Math.min(0.2, (60 / liveRef.current.bpm) * 0.28)
        : Math.min(0.26, (60 / liveRef.current.bpm) * 0.42);
      let best: Expectation | null = null;
      let bestDt = windowSec;
      let repeat = false;
      for (const item of expectations) {
        if (time - item.time > 2) continue;
        if (!item.midis.includes(midi)) continue;
        const dt = Math.abs(time - item.time);
        if (dt > windowSec) continue;
        if (item.got.has(midi)) {
          repeat = true;
          continue;
        }
        if (dt <= bestDt) {
          best = item;
          bestDt = dt;
        }
      }
      if (!best) return repeat ? "repeat" : "miss";
      best.got.add(midi);
      const bucket = laps.get(best.lap);
      if (bucket) {
        bucket.hits += 1;
        bucket.bars[best.bar].hits += 1;
      }
      setLiveHits((hits) => hits + 1);
      return "hit";
    };

    engine.onExpect = (event) => {
      if (event.kind !== "beat" || !liveRef.current.grading) return;
      const bucket = ensureLap(event.lap);
      bucket.total += event.midis.length;
      bucket.bars[event.bar].total += event.midis.length;
      expectations.push({
        time: event.time,
        midis: event.midis,
        got: new Set(),
        bar: event.bar,
        lap: event.lap,
      });
    };

    engine.onEvent = (event: EngineEvent) => {
      if (event.kind === "done") {
        if (liveRef.current.grading) {
          const bucket = laps.get(event.lap >= 0 ? event.lap : 0) ?? laps.get(0);
          if (bucket) {
            setMarks(bucket.bars.map((bar) => markFor(bar.hits, bar.total)));
            setSummary({
              ...summarizeChorus(
                bucket.hits,
                bucket.total,
                weakBars(bucket.bars),
              ),
              big: true,
            });
          }
        }
        setPlaying(false);
        setCountIn(null);
        playingRef.current = false;
        return;
      }
      if (event.kind === "stop") {
        setPlaying(false);
        setCountIn(null);
        playingRef.current = false;
        return;
      }
      if (event.kind === "count") {
        setCountIn(event.label);
        return;
      }
      setCountIn(null);
      setCursor({ bar: event.bar, beat: event.beat, at: event.at });
      if (!liveRef.current.grading) return;

      if (event.lap !== shownLap) {
        shownLap = event.lap;
        setLiveHits(0);
      }
      if (event.beat !== 0 || event.at > 0.05) return;

      const loopStart = liveRef.current.loopStart;
      const loopBars = liveRef.current.loopBars;
      const prev =
        event.bar === loopStart
          ? event.lap === 0
            ? null
            : { lap: event.lap - 1, bar: loopStart + loopBars - 1 }
          : { lap: event.lap, bar: event.bar - 1 };

      setMarks((current) => {
        const next = [...current];
        next[event.bar] = null;
        if (prev) {
          const bucket = laps.get(prev.lap);
          if (bucket) {
            next[prev.bar] = markFor(
              bucket.bars[prev.bar].hits,
              bucket.bars[prev.bar].total,
            );
          }
        }
        return next;
      });

      if (!prev) return;
      const bucket = laps.get(prev.lap);
      if (!bucket || prev.bar !== loopStart + loopBars - 1) return;
      const full = loopStart === 0 && loopBars === liveRef.current.barCount;
      if (full) {
        setSummary({
          ...summarizeChorus(bucket.hits, bucket.total, weakBars(bucket.bars)),
          big: true,
        });
      } else {
        setSummary({
          title: "Кусок круга",
          detail: `${bucket.hits} из ${bucket.total}. Когда этот кусок перестанет путать — верни весь круг.`,
          big: false,
        });
      }
    };

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setBpm(bpm);
  }, [bpm]);

  useEffect(() => {
    engineRef.current?.setLoop(loop.start, loop.bars);
  }, [loop]);

  useEffect(() => {
    engineRef.current?.setHands({ left: leftOn, right: rightOn });
  }, [leftOn, rightOn]);

  useEffect(() => {
    engineRef.current?.setDrums(drumsOn);
  }, [drumsOn]);

  useEffect(() => {
    const chart = chartFor(step);
    const once =
      chart.once && loop.start === 0 && loop.bars === chart.bars.length;
    engineRef.current?.setStep(step, once);
    engineRef.current?.setSound(
      GRADED.has(step) ? (hintOn ? "hint" : "off") : "full",
    );
  }, [step, hintOn, loop]);

  useEffect(() => {
    if (strayMidi == null) return;
    const id = window.setTimeout(() => setStrayMidi(null), 280);
    return () => window.clearTimeout(id);
  }, [strayMidi]);

  function lookAt(midi: number) {
    setScrollRequest((current) => ({ midi, nonce: current.nonce + 1 }));
  }

  function selectStep(id: StepId) {
    const defaults = STEP_DEFAULTS[id];
    const nextChart = chartFor(id);
    engineRef.current?.stop();
    playingRef.current = false;
    startingRef.current = false;
    playToken.current += 1;
    setPlaying(false);
    setStarting(false);
    setCountIn(null);
    setCursor(null);
    setStep(id);
    setLeftOn(defaults.left);
    setRightOn(defaults.right);
    setDrumsOn(defaults.drums);
    setHintOn(defaults.hint);
    setSummary(null);
    setLoopMode("all");
    setFocusBar(0);
    setLoop({ start: 0, bars: nextChart.bars.length });
    resetRound();
    setMarks(emptyMarks(nextChart.bars.length));
    setBpm(id === "piece" ? 90 : 72);
    lookAt(60);
  }

  function resetRound() {
    resetScoreRef.current();
    setMarks(emptyMarks(barsRef.current));
    setLiveHits(0);
  }

  function chooseLoop(mode: LoopMode, bar = focusBar) {
    const current = chartFor(step);
    resetRound();
    setLoopMode(mode);
    setFocusBar(mode === "all" ? focusBar : bar);
    setLoop(loopRange(mode, bar, current.bars.length, current.phrases));
  }

  function selectBar(bar: number) {
    resetRound();
    setFocusBar(bar);
    setLoopMode("bar");
    setLoop(loopRange("bar", bar));
  }

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (playingRef.current || startingRef.current) {
      playToken.current += 1;
      playingRef.current = false;
      startingRef.current = false;
      engine.stop();
      setPlaying(false);
      setStarting(false);
      return;
    }
    const token = playToken.current + 1;
    playToken.current = token;
    startingRef.current = true;
    setStarting(true);
    setAudioError(null);
    void engine
      .whenReady()
      .then(() => {
        if (playToken.current !== token) return;
        resetScoreRef.current();
        setMarks(emptyMarks(barsRef.current));
        setLiveHits(0);
        setCursor(null);
        engine.start();
        playingRef.current = true;
        startingRef.current = false;
        setPlaying(true);
      })
      .catch(() => {
        if (playToken.current !== token) return;
        startingRef.current = false;
        setAudioError(
          "Браузер не открыл звук. Нажми ещё раз: ему нужен жест мышью или пальцем.",
        );
      })
      .finally(() => {
        if (playToken.current === token) setStarting(false);
      });
  }, []);

  useEffect(() => {
    const chart = chartFor(step);
    barsRef.current = chart.bars.length;
    liveRef.current = {
      grading: GRADED.has(step),
      bpm,
      loopStart: loop.start,
      loopBars: loop.bars,
      barCount: chart.bars.length,
      swing: step === "piece",
    };
    toggleRef.current = togglePlay;
  }, [step, bpm, loop, togglePlay]);

  function pressMidi(midi: number) {
    if (heldRef.current.has(midi)) return;
    heldRef.current.add(midi);
    setPressed(new Set(heldRef.current));
    const engine = engineRef.current;
    if (!engine) return;
    void engine
      .whenReady()
      .then(() => {
        const time = engine.playNote(midi);
        const result = matchRef.current(midi, time);
        if (result === "miss") setStrayMidi(midi);
        setAudioError(null);
      })
      .catch(() => {
        setAudioError("Браузер не открыл звук. Нажми клавишу ещё раз.");
      });
  }

  function releaseMidi(midi: number) {
    heldRef.current.delete(midi);
    setPressed(new Set(heldRef.current));
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea")) {
        return;
      }
      if (event.code === "Space") {
        if (
          target instanceof HTMLElement &&
          target.closest("button, a, input, textarea")
        ) {
          return;
        }
        event.preventDefault();
        toggleRef.current();
        return;
      }
      if (event.repeat) return;
      const midi = midiFromCode(event.code);
      if (!midi) return;
      event.preventDefault();
      pressMidi(midi);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const midi = midiFromCode(event.code);
      if (!midi) return;
      releaseMidi(midi);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const lesson = STEPS.find((item) => item.id === step) ?? STEPS[0];
  const chart = chartFor(step);
  const shownRaw = playing && cursor ? cursor.bar : focusBar;
  const shownBar = chart.bars[shownRaw] ? shownRaw : 0;
  const placeBar = countIn ? loop.start : shownBar;
  const playingHit =
    playing && cursor
      ? (chart.hits[cursor.bar] ?? []).find(
          (hit) => Math.abs(hit.at - cursor.at) < 0.05,
        )
      : undefined;
  const highlights =
    playing && !countIn && playingHit
      ? cellHighlights(playingHit, chart.bars[cursor?.bar ?? 0]?.tone ?? "home", {
          left: leftOn,
          right: rightOn,
        })
      : previewNotes(step, placeBar);
  const playLabel = playing || starting ? "Стоп" : lesson.play;
  const countWord =
    countIn ?? (playing && cursor ? COUNT_WORDS[cursor.beat] : "раз");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="max-w-2xl">
        <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
          Пианино · тональность до · без нот
        </p>
        <h1 className="font-heading mt-2 text-5xl leading-none text-balance sm:text-6xl">
          Двенадцать тактов
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-pretty">
          Сначала ровный круг, потом фразы, потом пьеса в шаффле. В каждой
          руке работают только большой палец и мизинец. Сольфеджио и нотный
          стан не нужны: у каждой ноты есть имя и палец.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <nav
          aria-label="Шаги"
          className="no-print flex gap-2 overflow-x-auto lg:sticky lg:top-6 lg:flex-col lg:overflow-visible"
          role="tablist"
        >
          {STEPS.map((item) => (
            <Button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={step === item.id}
              variant={step === item.id ? "default" : "outline"}
              className="h-auto min-w-36 flex-col items-start px-3 py-2 lg:min-w-0 lg:w-full"
              onClick={() => selectStep(item.id)}
            >
              <span className="text-[10px] tracking-[0.14em] uppercase opacity-70">
                {item.kicker}
              </span>
              <span>{item.nav}</span>
            </Button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-5">
          {audioError ? (
            <p
              role="alert"
              className="rounded-xl border border-[var(--turn)] bg-[var(--turn-soft)] px-4 py-3 text-sm leading-6"
            >
              {audioError}
            </p>
          ) : null}

          <section
            aria-label="Карта двенадцати тактов"
            className="rounded-2xl bg-[#fffaf2] p-4 text-[var(--ink)] shadow-[0_16px_40px_rgba(60,40,10,0.08)] ring-1 ring-black/5 sm:p-5"
          >
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-heading text-3xl leading-none">Круг</h2>
                <p className="mt-1 text-sm text-[#5c5348]">
                  Нажми такт, чтобы крутить его один. Цвет меняется — левая
                  рука переезжает.
                </p>
              </div>
              <ul className="flex flex-wrap gap-3 text-xs">
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-[var(--home)]" />
                  до, дом
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-[var(--away)]" />
                  фа, уехали
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-[var(--turn)]" />
                  соль, горка
                </li>
              </ul>
            </div>
            <div className="flex flex-col gap-4">
              {chart.phrases.map((phrase) => (
                <div key={phrase.start}>
                  <button
                    type="button"
                    className="mb-1.5 flex w-full flex-col items-start gap-0.5 text-left sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                    onClick={() => chooseLoop("phrase", phrase.start)}
                  >
                    <span className="font-heading text-xl">{phrase.title}</span>
                    <span className="text-xs text-[#5c5348]">{phrase.text}</span>
                  </button>
                  <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                    {chart.bars
                      .slice(phrase.start, phrase.start + phrase.length)
                      .map(
                      (bar) => {
                        const current = playing && cursor?.bar === bar.index;
                        const drilled =
                          loopMode === "bar" && focusBar === bar.index;
                        return (
                          <button
                            key={bar.index}
                            type="button"
                            aria-pressed={drilled}
                            aria-current={current ? "step" : undefined}
                            onClick={() => selectBar(bar.index)}
                            className={cn(
                              "min-h-20 rounded-xl px-2 py-2 text-left ring-offset-2 transition focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:outline-none",
                              current ? "text-white" : "text-[var(--ink)]",
                              drilled && !current && "ring-2 ring-[var(--ink)]",
                            )}
                            style={{
                              background: current
                                ? `var(--${bar.tone})`
                                : `var(--${bar.tone}-soft)`,
                            }}
                          >
                            <span className="flex items-center justify-between text-[10px] tracking-wide uppercase opacity-80">
                              <span>{bar.index + 1}</span>
                              {chordChanges(bar.index, chart.bars) ? (
                                <span>переезд</span>
                              ) : null}
                            </span>
                            <span className="font-heading block text-2xl leading-none sm:text-3xl">
                              {bar.name}
                            </span>
                            <span className="mt-1 flex items-center justify-between text-xs">
                              <span>{bar.letter}</span>
                              <MarkDot mark={marks[bar.index]} light={!!current} />
                            </span>
                            {current ? (
                              <span className="mt-1 flex gap-1">
                                {[0, 1, 2, 3].map((beat) => (
                                  <span
                                    key={beat}
                                    className={cn(
                                      "h-1 flex-1 rounded-full",
                                      cursor && Math.floor(cursor.at + 1e-6) === beat
                                        ? "bg-white"
                                        : "bg-white/40",
                                    )}
                                  />
                                ))}
                              </span>
                            ) : null}
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            aria-label="Что играть сейчас"
            className="rounded-2xl border border-border bg-card p-4 sm:p-5"
          >
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">
                  {countIn
                    ? `Сейчас будет ${chart.bars[loop.start]?.name ?? "до"}`
                    : `Такт ${shownBar + 1} · ${phraseForBar(shownBar, chart.phrases).title}`}
                </p>
                <p
                  className={cn(
                    "font-heading text-6xl leading-none sm:text-7xl",
                    !playing && "text-muted-foreground",
                  )}
                >
                  {countWord}
                </p>
              </div>
              <p className="text-right text-sm leading-5 text-muted-foreground">
                {chart.bars[shownBar]?.letter}
                <span className="mt-1 block font-heading text-3xl leading-none text-foreground">
                  {chart.bars[shownBar]?.name}
                </span>
              </p>
            </div>
            {!playing && !starting && !countIn ? (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Нажми кнопку запуска и считай вслух — это и есть весь ритм. Пока
                круг стоит, на клавиатуре светятся ноты этого шага.
              </p>
            ) : null}
            <div className="mt-4 grid grid-cols-4 gap-1.5 sm:gap-2">
              {COUNT_WORDS.map((word, beat) => {
                const notes = hitsAt(step, placeBar, beat);
                const hot =
                  playing &&
                  !countIn &&
                  cursor?.bar === placeBar &&
                  Math.floor((cursor?.at ?? 0) + 1e-6) === beat;
                return (
                  <div
                    key={word}
                    className={cn(
                      "rounded-xl px-2 py-2",
                      hot ? "text-white" : "bg-muted text-foreground",
                    )}
                    style={
                      hot
                        ? { background: `var(--${chart.bars[placeBar]?.tone ?? "home"})` }
                        : undefined
                    }
                  >
                    <p className="text-[11px] tracking-wide uppercase opacity-80">
                      {word}
                    </p>
                    <HandBeat
                      hand="левая"
                      notes={notes.map((hit) => hit.lh)}
                      dim={!leftOn}
                    />
                    <HandBeat
                      hand="правая"
                      notes={notes.map((hit) => hit.rh)}
                      dim={!rightOn}
                    />
                  </div>
                );
              })}
            </div>
            {GRADED.has(step) && playing ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Попадания в этом круге: {liveHits}
              </p>
            ) : null}
            {summary ? (
              <div
                aria-live="polite"
                className={cn(
                  "mt-4 rounded-xl px-4 py-3",
                  summary.big
                    ? "bg-[var(--home-soft)] text-[var(--ink)]"
                    : "bg-muted",
                )}
              >
                <p className="font-heading text-2xl leading-none">{summary.title}</p>
                <p className="mt-1 text-sm leading-6">{summary.detail}</p>
              </div>
            ) : null}
          </section>

          <article>
            <h2 className="font-heading text-4xl leading-none">{lesson.title}</h2>
            <div className="mt-3 flex flex-col gap-3 text-base leading-7">
              {lesson.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            {step === "phrases" ? (
              <p className="mt-4 border-l-4 border-[var(--turn)] pl-3 text-sm leading-6">
                На тактах фа обе руки по очереди нажимают среднее до: правая на
                «раз», левая на «два» и «четыре». Ноты короткие — нажал и
                отпустил. Если держать клавишу, пальцы столкнутся.
              </p>
            ) : null}
            {step === "piece" ? (
              <p className="mt-4 border-l-4 border-[var(--turn)] pl-3 text-sm leading-6">
                На тактах фа среднее до делят: правая на длинной ноте «раз» и
                «три», левая на каждой короткой. Ноты короткие — нажал и
                отпустил. Если держать клавишу, пальцы столкнутся.
              </p>
            ) : null}
          </article>

          <div className="no-print flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="h-12 px-5 text-base"
                onClick={togglePlay}
              >
                {playing ? (
                  <Square aria-hidden="true" />
                ) : (
                  <Play aria-hidden="true" />
                )}
                {playLabel}
              </Button>
              <div className="flex flex-wrap gap-2" aria-label="Что крутить">
                <Button
                  type="button"
                  variant={loopMode === "all" ? "default" : "outline"}
                  onClick={() => chooseLoop("all")}
                >
                  {chart.once ? "Вся пьеса" : "Весь круг"}
                </Button>
                <Button
                  type="button"
                  variant={loopMode === "phrase" ? "default" : "outline"}
                  onClick={() => chooseLoop("phrase", shownBar)}
                >
                  Фраза
                </Button>
                <Button
                  type="button"
                  variant={loopMode === "bar" ? "default" : "outline"}
                  onClick={() => chooseLoop("bar", shownBar)}
                >
                  Такт {shownBar + 1}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="tempo" className="text-sm">
                  Темп {bpm}
                </label>
                <span className="text-xs text-muted-foreground">
                  ударов в минуту
                </span>
              </div>
              <Slider
                id="tempo"
                aria-label="Темп"
                min={52}
                max={116}
                step={1}
                value={[bpm]}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setBpm(next);
                }}
              />
              <div className="flex flex-wrap gap-2">
                {TEMPOS.map((tempo) => (
                  <Button
                    key={tempo.bpm}
                    type="button"
                    size="sm"
                    variant={bpm === tempo.bpm ? "default" : "outline"}
                    onClick={() => setBpm(tempo.bpm)}
                  >
                    {tempo.label} {tempo.bpm}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Toggle
                pressed={leftOn}
                onPressedChange={setLeftOn}
                variant="outline"
                className="h-10 data-pressed:bg-primary data-pressed:text-primary-foreground"
              >
                Левая
              </Toggle>
              <Toggle
                pressed={rightOn}
                onPressedChange={setRightOn}
                variant="outline"
                className="h-10 data-pressed:bg-primary data-pressed:text-primary-foreground"
              >
                Правая
              </Toggle>
              <Toggle
                pressed={drumsOn}
                onPressedChange={setDrumsOn}
                variant="outline"
                className="h-10 data-pressed:bg-primary data-pressed:text-primary-foreground"
              >
                Ритм
              </Toggle>
              {GRADED.has(step) ? (
                <Toggle
                  pressed={hintOn}
                  onPressedChange={setHintOn}
                  variant="outline"
                  className="h-10 data-pressed:bg-primary data-pressed:text-primary-foreground"
                >
                  Подсказка звуком
                </Toggle>
              ) : null}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {GRADED.has(step)
                ? "Подсказка тихо играет ноты, которые надо нажать. Без ритма остаётся тихий щелчок, чтобы не потерять счёт."
                : "Выключенная рука молчит — так собирают круг по одной. Без ритма остаётся тихий щелчок."}
            </p>
          </div>

          <div className="no-print flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-3xl leading-none">Клавиши</h2>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => lookAt(48)}>
                  К левой
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => lookAt(60)}>
                  К правой
                </Button>
              </div>
            </div>
            <PianoKeyboard
              highlights={highlights}
              pressed={pressed}
              strayMidi={strayMidi}
              scrollRequest={scrollRequest}
              onPress={pressMidi}
              onRelease={releaseMidi}
            />
            <p className="text-sm leading-6 text-muted-foreground">
              Золотая точка — нужные до: нижнее для мизинца левой, среднее для
              большого пальца правой. Си-бемоль — единственная подписанная
              чёрная клавиша, цифра 7.
            </p>
            <details className="text-sm leading-6 text-muted-foreground">
              <summary className="cursor-pointer text-foreground">
                Клавиатура компьютера
              </summary>
              <p className="mt-2">
                Нижний ряд — левая рука от нижнего до: на русской раскладке это
                Я Ч С М И, на английской Z X C V B. Верхний ряд — правая от
                среднего до: Й Ц У К Е или Q W E R T. Си-бемоль — цифра 7.
                Подписи на клавишах показывают обе буквы, звук привязан к месту
                клавиши. Пробел запускает круг, если фокус не на кнопке.
              </p>
            </details>
          </div>

          <CheatSheet />
        </div>
      </div>
    </div>
  );
}

function HandBeat({
  hand,
  notes,
  dim,
}: {
  hand: string;
  notes: Array<{ finger: number; ru: string } | null>;
  dim: boolean;
}) {
  const sounded = notes.filter((note) => note != null);
  return (
    <p className={cn("mt-2", dim && "opacity-35")}>
      <span className="block text-[10px] opacity-70">
        {hand}
        {sounded.length ? ` ${sounded.map((note) => note.finger).join(" ")}` : ""}
      </span>
      <span className="font-heading text-2xl leading-none">
        {sounded.length ? sounded.map((note) => note.ru).join(" · ") : "тишина"}
      </span>
    </p>
  );
}

function MarkDot({ mark, light }: { mark: BarMark; light: boolean }) {
  if (!mark) return <span className="size-2" />;
  const title =
    mark === "hit" ? "такт сел" : mark === "partial" ? "почти" : "мимо";
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "size-2 rounded-full border",
        light ? "border-white" : "border-current",
        mark === "hit" && (light ? "bg-white" : "bg-current"),
        mark === "partial" && (light ? "bg-white/50" : "bg-current/40"),
      )}
    />
  );
}

function CheatSheet() {
  const hands = [
    { title: "до", bar: leftHandBar(0) },
    { title: "фа", bar: leftHandBar(5) },
    { title: "соль", bar: leftHandBar(7) },
  ];
  const riff = rightHandBar();
  return (
    <section
      id="sheet"
      aria-label="Шпаргалка"
      className="scroll-mt-6 rounded-2xl bg-[#fffaf2] p-4 text-[var(--ink)] shadow-[0_16px_40px_rgba(60,40,10,0.08)] ring-1 ring-black/5 sm:p-5"
    >
      <h2 className="font-heading text-4xl leading-none">Шпаргалка на пюпитр</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#5c5348]">
        Положи рядом с пианино. 5 — мизинец, 1 — большой. Ноты короткие.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm tracking-[0.14em] uppercase">Левая</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {hands.map((hand) => (
              <li key={hand.title} className="flex items-baseline justify-between gap-3">
                <span className="font-heading text-2xl">{hand.title}</span>
                <span className="text-right text-sm">
                  {hand.bar.map((note) => note.ru).join(" · ")}
                  <span className="mt-0.5 block text-xs text-[#5c5348]">
                    пальцы {hand.bar.map((note) => note.finger).join(" ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm tracking-[0.14em] uppercase">Правая</h3>
          <p className="font-heading mt-2 text-2xl leading-tight">
            {riff.map((note) => note.ru).join(" · ")}
          </p>
          <p className="mt-1 text-xs text-[#5c5348]">
            пальцы {riff.map((note) => note.finger).join(" ")}. Во фразах
            четвёртая доля — тишина. В пьесе внутри доли длинная и короткая.
          </p>
          <p className="font-heading mt-3 text-2xl leading-tight">
            си♭ · соль · до
          </p>
          <p className="mt-1 text-xs text-[#5c5348]">
            ответ пьесы, пальцы 5 5 1. Во фразах ответ длиннее: до · си♭ · соль
            · до, такты 4 и 8.
          </p>
          <p className="mt-4 text-sm leading-6">
            Си-бемоль — чёрная клавиша сразу слева от си. Пьеса кончается на
            до: обе руки ставят его и отпускают.
          </p>
        </div>
      </div>
      <ol className="mt-5 grid gap-2 text-sm leading-6 sm:grid-cols-3">
        <li className="rounded-xl bg-[var(--home-soft)] px-3 py-2">
          круг: до до до до
        </li>
        <li className="rounded-xl bg-[var(--away-soft)] px-3 py-2">
          фа фа до до
        </li>
        <li className="rounded-xl bg-[var(--turn-soft)] px-3 py-2">
          соль фа до соль
        </li>
        <li className="rounded-xl bg-[var(--home-soft)] px-3 py-2">
          пьеса: до фа до до
        </li>
        <li className="rounded-xl bg-[var(--away-soft)] px-3 py-2">
          фа фа до до
        </li>
        <li className="rounded-xl bg-[var(--turn-soft)] px-3 py-2">
          соль фа до до
        </li>
      </ol>
    </section>
  );
}

const CODE_TO_MIDI = new Map<string, number>(
  Object.entries(COMPUTER_KEYS).map(([midi, key]) => [key.code, Number(midi)]),
);

function midiFromCode(code: string): number | null {
  return CODE_TO_MIDI.get(code) ?? null;
}
