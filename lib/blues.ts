export type Tone = "home" | "away" | "turn";
export type Degree = "I" | "IV" | "V";
export type StepId =
  | "listen"
  | "left"
  | "right"
  | "both"
  | "play"
  | "breath"
  | "answer"
  | "early"
  | "stop"
  | "show";
export type BarMark = "hit" | "partial" | "miss" | null;
export type LoopMode = "all" | "phrase" | "bar";

export interface PitchName {
  letter: string;
  ru: string;
}

export const PITCHES: readonly PitchName[] = [
  { letter: "C", ru: "до" },
  { letter: "Db", ru: "ре♭" },
  { letter: "D", ru: "ре" },
  { letter: "Eb", ru: "ми♭" },
  { letter: "E", ru: "ми" },
  { letter: "F", ru: "фа" },
  { letter: "F#", ru: "фа♯" },
  { letter: "G", ru: "соль" },
  { letter: "Ab", ru: "ля♭" },
  { letter: "A", ru: "ля" },
  { letter: "Bb", ru: "си♭" },
  { letter: "B", ru: "си" },
];

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

export const COUNT_WORDS = ["раз", "два", "три", "четыре"] as const;

export interface ChordBar {
  index: number;
  degree: Degree;
  rootPc: number;
  name: string;
  letter: string;
  tone: Tone;
}

const HOME: Omit<ChordBar, "index"> = {
  degree: "I",
  rootPc: 0,
  name: "до",
  letter: "C",
  tone: "home",
};
const AWAY: Omit<ChordBar, "index"> = {
  degree: "IV",
  rootPc: 5,
  name: "фа",
  letter: "F",
  tone: "away",
};
const TURN: Omit<ChordBar, "index"> = {
  degree: "V",
  rootPc: 7,
  name: "соль",
  letter: "G",
  tone: "turn",
};

export const FORM: readonly ChordBar[] = [
  HOME,
  HOME,
  HOME,
  HOME,
  AWAY,
  AWAY,
  HOME,
  HOME,
  TURN,
  AWAY,
  HOME,
  TURN,
].map((bar, index) => ({ ...bar, index }));

export const PHRASES = [
  {
    start: 0,
    length: 4,
    title: "Дом",
    text: "Четыре такта на до. Рука стоит.",
  },
  {
    start: 4,
    length: 4,
    title: "Уехали",
    text: "Два такта фа, потом снова до.",
  },
  {
    start: 8,
    length: 4,
    title: "Горка",
    text: "Соль, фа, до и снова соль — она зовёт круг сначала.",
  },
] as const;

export interface PlayNote {
  midi: number;
  pc: number;
  letter: string;
  ru: string;
  finger: number;
}

export interface ComputerKey {
  code: string;
  ru: string;
  en: string;
}

export function midiOf(pc: number, octave: number): number {
  return (octave + 1) * 12 + pc;
}

export function pitchOf(pc: number, octave: number): Omit<PlayNote, "finger"> {
  const name = PITCHES[pc];
  return {
    midi: midiOf(pc, octave),
    pc,
    letter: name.letter,
    ru: name.ru,
  };
}

export function leftHandBar(rootPc: number): PlayNote[] {
  const fifthPc = (rootPc + 7) % 12;
  const root = pitchOf(rootPc, 3);
  const fifth = pitchOf(fifthPc, fifthPc < rootPc ? 4 : 3);
  const fingers = [5, 1, 5, 1];
  return fingers.map((finger, index) => ({
    ...(index % 2 === 0 ? root : fifth),
    finger,
  }));
}

export function rightHandBar(): PlayNote[] {
  const shape: Array<{ pc: number; finger: number }> = [
    { pc: 0, finger: 1 },
    { pc: 7, finger: 5 },
    { pc: 10, finger: 5 },
    { pc: 7, finger: 5 },
  ];
  return shape.map(({ pc, finger }) => ({ ...pitchOf(pc, 4), finger }));
}

export function beatNotes(bar: number, beat: number): { lh: PlayNote; rh: PlayNote } {
  const chord = FORM[bar];
  return {
    lh: leftHandBar(chord.rootPc)[beat],
    rh: rightHandBar()[beat],
  };
}

export type DrumHit = "groove" | "hit";

export interface Cell {
  lh: PlayNote | null;
  rh: PlayNote | null;
  drum: DrumHit;
  hold: boolean;
}

export interface Chart {
  bars: ChordBar[];
  cells: Cell[][];
  phrases: readonly Phrase[];
  once: boolean;
}

const QUICK: readonly ChordBar[] = [
  HOME,
  AWAY,
  HOME,
  HOME,
  AWAY,
  AWAY,
  HOME,
  HOME,
  TURN,
  AWAY,
  HOME,
  TURN,
].map((bar, index) => ({ ...bar, index }));

const SHOW_SECOND: readonly ChordBar[] = [
  HOME,
  AWAY,
  HOME,
  HOME,
  AWAY,
  AWAY,
  HOME,
  HOME,
  TURN,
  AWAY,
  HOME,
  HOME,
].map((bar, index) => ({ ...bar, index: index + 12 }));

function rhBeat(
  pc: number | null,
  beat: number,
  fingers: readonly number[],
): PlayNote | null {
  if (pc == null) return null;
  return { ...pitchOf(pc, 4), finger: fingers[beat] };
}

function grooveBar(rootPc: number, answer: boolean): Cell[] {
  const left = leftHandBar(rootPc);
  const pcs = answer ? [0, 10, 7, 0] : [0, 7, 10, null];
  const fingers = answer ? [1, 5, 5, 1] : [1, 5, 5, 5];
  return [0, 1, 2, 3].map((beat) => ({
    lh: left[beat],
    rh: rhBeat(pcs[beat], beat, fingers),
    drum: "groove",
    hold: false,
  }));
}

function fullBar(rootPc: number): Cell[] {
  const left = leftHandBar(rootPc);
  const right = rightHandBar();
  return [0, 1, 2, 3].map((beat) => ({
    lh: left[beat],
    rh: right[beat],
    drum: "groove" as const,
    hold: false,
  }));
}

function stopBar(rootPc: number): Cell[] {
  const root = leftHandBar(rootPc)[0];
  return [0, 1, 2, 3].map((beat) => ({
    lh: beat === 0 ? root : null,
    rh: beat === 0 ? rhBeat(0, 0, [1, 5, 5, 5]) : null,
    drum: "hit" as const,
    hold: false,
  }));
}

function endingBar(): Cell[] {
  const root = leftHandBar(0)[0];
  return [0, 1, 2, 3].map((beat) => ({
    lh: beat === 0 ? root : null,
    rh: beat === 0 ? rhBeat(0, 0, [1, 5, 5, 5]) : null,
    drum: "hit" as const,
    hold: beat === 0,
  }));
}

function withIndexes(bars: readonly ChordBar[], offset = 0): ChordBar[] {
  return bars.map((bar, index) => ({ ...bar, index: offset + index }));
}

function chartOf(
  bars: readonly ChordBar[],
  cells: Cell[][],
  phrases: readonly Phrase[],
  once: boolean,
): Chart {
  return { bars: withIndexes(bars), cells, phrases, once };
}

const BASIC_CELLS = FORM.map((bar) => fullBar(bar.rootPc));

function variedCells(bars: readonly ChordBar[], answers: boolean): Cell[][] {
  return bars.map((bar, index) =>
    grooveBar(bar.rootPc, answers && (index === 3 || index === 7)),
  );
}

const EARLY_PHRASES: readonly Phrase[] = [
  {
    start: 0,
    length: 4,
    title: "Дом",
    text: "До, сразу фа, и снова два такта до.",
  },
  PHRASES[1],
  PHRASES[2],
];

const STOP_PHRASES: readonly Phrase[] = [
  {
    start: 0,
    length: 4,
    title: "Дыра",
    text: "Удар только на «раз». Дальше тишина.",
  },
  PHRASES[1],
  {
    start: 8,
    length: 4,
    title: "Горка",
    text: "Снова полный ход: соль, фа, до и соль.",
  },
];

const SHOW_PHRASES: readonly Phrase[] = [
  ...EARLY_PHRASES,
  {
    start: 12,
    length: 4,
    title: "Стоп",
    text: "Второй круг. Удар на «раз», дальше тишина.",
  },
  {
    start: 16,
    length: 4,
    title: "Снова",
    text: "Фа и до. В конце фразы — ответ.",
  },
  {
    start: 20,
    length: 4,
    title: "Поклон",
    text: "Горка, и в последнем такте оба пальца ставят до.",
  },
];

function showCells(): Cell[][] {
  const first = variedCells(QUICK, true);
  const secondBars = SHOW_SECOND;
  const second = secondBars.map((bar, index) => {
    if (index < 4) return stopBar(bar.rootPc);
    if (index === 11) return endingBar();
    return grooveBar(bar.rootPc, index === 7);
  });
  return [...first, ...second];
}

const CHARTS: Record<StepId, Chart> = {
  listen: chartOf(FORM, BASIC_CELLS, PHRASES, false),
  left: chartOf(FORM, BASIC_CELLS, PHRASES, false),
  right: chartOf(FORM, BASIC_CELLS, PHRASES, false),
  both: chartOf(FORM, BASIC_CELLS, PHRASES, false),
  play: chartOf(FORM, BASIC_CELLS, PHRASES, false),
  breath: chartOf(FORM, variedCells(FORM, false), PHRASES, false),
  answer: chartOf(FORM, variedCells(FORM, true), PHRASES, false),
  early: chartOf(QUICK, variedCells(QUICK, true), EARLY_PHRASES, false),
  stop: chartOf(
    QUICK,
    QUICK.map((bar, index) =>
      index < 4 ? stopBar(bar.rootPc) : grooveBar(bar.rootPc, index === 7),
    ),
    STOP_PHRASES,
    false,
  ),
  show: chartOf(
    [...QUICK, ...SHOW_SECOND],
    showCells(),
    SHOW_PHRASES,
    true,
  ),
};

export function chartFor(step: StepId): Chart {
  return CHARTS[step];
}

export function cellAt(step: StepId, bar: number, beat: number): Cell {
  const chart = chartFor(step);
  return (
    chart.cells[bar]?.[beat] ?? {
      lh: null,
      rh: null,
      drum: "groove",
      hold: false,
    }
  );
}

export function chordChanges(
  index: number,
  bars: readonly ChordBar[] = FORM,
): boolean {
  const form = Array.isArray(bars) ? bars : FORM;
  if (index <= 0 || index >= form.length) return false;
  return form[index].rootPc !== form[index - 1].rootPc;
}

export interface Phrase {
  start: number;
  length: number;
  title: string;
  text: string;
}

export function phraseForBar(
  bar: number,
  phrases: readonly Phrase[] = PHRASES,
): Phrase {
  const phrase = phrases.find(
    (item) => bar >= item.start && bar < item.start + item.length,
  );
  return phrase ?? phrases[0];
}

export function loopRange(
  mode: LoopMode,
  bar: number,
  total = 12,
  phrases: readonly Phrase[] = PHRASES,
): { start: number; bars: number } {
  if (mode === "bar") return { start: bar, bars: 1 };
  if (mode === "phrase") {
    const phrase = phraseForBar(bar, phrases);
    return { start: phrase.start, bars: phrase.length };
  }
  return { start: 0, bars: total };
}

export function positionInLoop(
  beatIndex: number,
  loopStartBar: number,
  loopBars: number,
): { bar: number; beat: number; lap: number } {
  const loopBeats = loopBars * 4;
  const lap = Math.floor(beatIndex / loopBeats);
  const within = beatIndex % loopBeats;
  return {
    lap,
    bar: loopStartBar + Math.floor(within / 4),
    beat: within % 4,
  };
}

export interface Highlight {
  midi: number;
  finger: number;
  tone: Tone;
}

const BASIC_STEPS = new Set<StepId>(["listen", "left", "right", "both", "play"]);

export function previewNotes(step: StepId, barIndex: number): Highlight[] {
  if (step === "listen") {
    return [
      { midi: midiOf(0, 3), finger: 5, tone: "home" },
      { midi: midiOf(5, 3), finger: 5, tone: "away" },
      { midi: midiOf(7, 3), finger: 5, tone: "turn" },
    ];
  }
  if (!BASIC_STEPS.has(step)) {
    const chart = chartFor(step);
    const tone = chart.bars[barIndex]?.tone ?? "home";
    return highlightsFromCells(chart.cells[barIndex] ?? [], tone, {
      left: true,
      right: true,
    });
  }
  const tone = FORM[barIndex].tone;
  const map = new Map<number, Highlight>();
  const add = (note: PlayNote) => {
    if (!map.has(note.midi)) {
      map.set(note.midi, { midi: note.midi, finger: note.finger, tone });
    }
  };
  if (step !== "right") leftHandBar(FORM[barIndex].rootPc).forEach(add);
  if (step !== "left") rightHandBar().forEach(add);
  return [...map.values()];
}

export function highlightsFromCells(
  cells: readonly Cell[],
  tone: Tone,
  hands: { left: boolean; right: boolean },
): Highlight[] {
  const map = new Map<number, Highlight>();
  for (const cell of cells) {
    const notes = [
      hands.left ? cell.lh : null,
      hands.right ? cell.rh : null,
    ];
    for (const note of notes) {
      if (!note || map.has(note.midi)) continue;
      map.set(note.midi, { midi: note.midi, finger: note.finger, tone });
    }
  }
  return [...map.values()];
}

export function cellHighlights(
  cell: Cell,
  tone: Tone,
  hands: { left: boolean; right: boolean },
): Highlight[] {
  return highlightsFromCells([cell], tone, hands);
}

export function activeHighlights(
  bar: number,
  beat: number,
  hands: { left: boolean; right: boolean },
): Highlight[] {
  const notes = beatNotes(bar, beat);
  const tone = FORM[bar].tone;
  const out: Highlight[] = [];
  if (hands.left) out.push({ ...notes.lh, tone });
  if (hands.right) out.push({ ...notes.rh, tone });
  return out;
}

export function markFor(hits: number, total: number): BarMark {
  if (total <= 0) return null;
  if (hits >= total) return "hit";
  if (hits === 0) return "miss";
  return "partial";
}

export function formatBarList(bars: number[]): string {
  if (bars.length === 0) return "";
  if (bars.length === 1) return `такт ${bars[0]}`;
  const head = bars.slice(0, -1).join(", ");
  return `такты ${head} и ${bars[bars.length - 1]}`;
}

export function summarizeChorus(
  hits: number,
  total: number,
  weak: number[],
): { title: string; detail: string } {
  if (total <= 0) {
    return {
      title: "Руки выключены",
      detail: "Включи левую или правую — без них круг не из чего собирать.",
    };
  }
  const weakText =
    weak.length > 0 && weak.length <= 4
      ? ` Отдельно покрути ${formatBarList(weak)}.`
      : "";
  const ratio = hits / total;
  if (hits === 0) {
    return {
      title: "Круг прошёл без нот",
      detail:
        "Нажми клавишу, которая светится, или ту же клавишу на компьютере. Можно медленнее.",
    };
  }
  if (ratio >= 0.92) {
    return {
      title: "Круг сел",
      detail: `Ещё два таких же, потом прибавь темп совсем немного.${weakText}`,
    };
  }
  if (ratio >= 0.75) {
    return {
      title: "Уже похоже на блюз",
      detail: `Форма на месте, пальцы иногда опаздывают.${weakText}`,
    };
  }
  if (ratio >= 0.45) {
    return {
      title: "Форма слышна, пальцы догоняют",
      detail: `Оставь звуковую подсказку и снизь темп, пока попадания не станут ровными.${weakText}`,
    };
  }
  return {
    title: "Нормальный первый заход",
    detail: `Выключи правую и собери только левую на одном такте. Потом верни рифф.${weakText}`,
  };
}

export function weakBars(
  bars: Array<{ hits: number; total: number }>,
): number[] {
  return bars.flatMap((bar, index) => {
    const mark = markFor(bar.hits, bar.total);
    return mark === "miss" || mark === "partial" ? [index + 1] : [];
  });
}

export const COMPUTER_KEYS: Record<number, ComputerKey> = {
  48: { code: "KeyZ", ru: "Я", en: "Z" },
  49: { code: "KeyS", ru: "Ы", en: "S" },
  50: { code: "KeyX", ru: "Ч", en: "X" },
  51: { code: "KeyD", ru: "В", en: "D" },
  52: { code: "KeyC", ru: "С", en: "C" },
  53: { code: "KeyV", ru: "М", en: "V" },
  54: { code: "KeyG", ru: "П", en: "G" },
  55: { code: "KeyB", ru: "И", en: "B" },
  56: { code: "KeyH", ru: "Р", en: "H" },
  57: { code: "KeyN", ru: "Т", en: "N" },
  58: { code: "KeyJ", ru: "О", en: "J" },
  59: { code: "KeyM", ru: "Ь", en: "M" },
  60: { code: "KeyQ", ru: "Й", en: "Q" },
  61: { code: "Digit2", ru: "2", en: "2" },
  62: { code: "KeyW", ru: "Ц", en: "W" },
  63: { code: "Digit3", ru: "3", en: "3" },
  64: { code: "KeyE", ru: "У", en: "E" },
  65: { code: "KeyR", ru: "К", en: "R" },
  66: { code: "Digit5", ru: "5", en: "5" },
  67: { code: "KeyT", ru: "Е", en: "T" },
  68: { code: "Digit6", ru: "6", en: "6" },
  69: { code: "KeyY", ru: "Н", en: "Y" },
  70: { code: "Digit7", ru: "7", en: "7" },
  71: { code: "KeyU", ru: "Г", en: "U" },
  72: { code: "KeyI", ru: "Ш", en: "I" },
};

export function computerLabel(key: Pick<ComputerKey, "ru" | "en">): string {
  return key.ru === key.en ? key.ru : `${key.ru}/${key.en}`;
}

export interface PianoKeyModel {
  midi: number;
  pc: number;
  letter: string;
  ru: string;
  black: boolean;
  whiteIndex: number;
  computer?: ComputerKey;
}

export function buildPiano(): PianoKeyModel[] {
  const keys: PianoKeyModel[] = [];
  let whiteIndex = 0;
  for (let midi = 48; midi <= 72; midi += 1) {
    const pc = midi % 12;
    const name = PITCHES[pc];
    const black = BLACK_PCS.has(pc);
    keys.push({
      midi,
      pc,
      letter: name.letter,
      ru: name.ru,
      black,
      whiteIndex: black ? whiteIndex - 1 : whiteIndex,
      computer: COMPUTER_KEYS[midi],
    });
    if (!black) whiteIndex += 1;
  }
  return keys;
}

export const PIANO_KEYS = buildPiano();
export const WHITE_KEY_COUNT = PIANO_KEYS.filter((key) => !key.black).length;

export function patternMidiSet(): Set<number> {
  const set = new Set<number>();
  for (const pc of [0, 5, 7]) {
    for (const note of leftHandBar(pc)) set.add(note.midi);
  }
  for (const note of rightHandBar()) set.add(note.midi);
  return set;
}

export const PATTERN_MIDIS = patternMidiSet();

export function clampTempo(bpm: number): number {
  return Math.min(116, Math.max(52, Math.round(bpm)));
}
