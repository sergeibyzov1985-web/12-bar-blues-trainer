import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPUTER_KEYS,
  FORM,
  PATTERN_MIDIS,
  beatNotes,
  chordChanges,
  formatBarList,
  leftHandBar,
  loopRange,
  markFor,
  positionInLoop,
  chartFor,
  previewNotes,
  rightHandBar,
  summarizeChorus,
  weakBars,
} from "./blues.ts";

test("twelve-bar form is the standard blues loop in C", () => {
  assert.equal(FORM.length, 12);
  assert.deepEqual(
    FORM.map((bar) => bar.degree),
    ["I", "I", "I", "I", "IV", "IV", "I", "I", "V", "IV", "I", "V"],
  );
  assert.deepEqual(
    FORM.map((bar) => bar.letter),
    ["C", "C", "C", "C", "F", "F", "C", "C", "G", "F", "C", "G"],
  );
});

test("left hand walks a perfect fifth above the chord root", () => {
  const expected: Record<string, [number, number]> = {
    C: [48, 55],
    F: [53, 60],
    G: [55, 62],
  };
  for (const [letter, [root, fifth]] of Object.entries(expected)) {
    const pc = letter === "C" ? 0 : letter === "F" ? 5 : 7;
    const bar = leftHandBar(pc);
    assert.deepEqual(
      bar.map((note) => note.midi),
      [root, fifth, root, fifth],
    );
    assert.deepEqual(
      bar.map((note) => note.finger),
      [5, 1, 5, 1],
    );
    assert.equal(fifth - root, 7);
  }
});

test("right hand riff stays put over every bar", () => {
  const riff = rightHandBar();
  assert.deepEqual(
    riff.map((note) => note.midi),
    [60, 67, 70, 67],
  );
  assert.deepEqual(
    riff.map((note) => note.ru),
    ["до", "соль", "си♭", "соль"],
  );
  assert.deepEqual(
    riff.map((note) => note.finger),
    [1, 5, 5, 5],
  );
  for (let bar = 0; bar < 12; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      const notes = beatNotes(bar, beat);
      assert.equal(notes.rh.midi, riff[beat].midi);
      assert.notEqual(notes.lh.midi, notes.rh.midi);
    }
  }
});

test("chord changes are exactly the color changes", () => {
  const changes = FORM.map((_, index) => index).filter(chordChanges);
  assert.deepEqual(changes, [4, 6, 8, 9, 10, 11]);
});

test("loop position stays inside the chosen slice", () => {
  assert.deepEqual(positionInLoop(0, 0, 12), { bar: 0, beat: 0, lap: 0 });
  assert.deepEqual(positionInLoop(5, 0, 12), { bar: 1, beat: 1, lap: 0 });
  assert.deepEqual(positionInLoop(48, 0, 12), { bar: 0, beat: 0, lap: 1 });
  assert.deepEqual(positionInLoop(0, 4, 4), { bar: 4, beat: 0, lap: 0 });
  assert.deepEqual(positionInLoop(16, 4, 4), { bar: 4, beat: 0, lap: 1 });
  assert.deepEqual(loopRange("phrase", 9), { start: 8, bars: 4 });
  assert.deepEqual(loopRange("bar", 11), { start: 11, bars: 1 });
  assert.deepEqual(loopRange("all", 5), { start: 0, bars: 12 });
});

test("every pattern note has a computer key", () => {
  for (const midi of PATTERN_MIDIS) {
    assert.ok(COMPUTER_KEYS[midi], `missing key for midi ${midi}`);
  }
  const codes = Object.values(COMPUTER_KEYS).map((key) => key.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("listen preview is the three bass homes, and the riff adds one black key", () => {
  const homes = previewNotes("listen", 0).map((note) => note.midi);
  assert.deepEqual(homes, [48, 53, 55]);
  const both = previewNotes("both", 0).map((note) => note.midi);
  assert.ok(both.includes(70));
  assert.ok(both.includes(48));
  assert.equal(previewNotes("right", 4).some((note) => note.midi < 60), false);
});

test("later lessons add one idea at a time and end on a piece", () => {
  const breath = chartFor("breath");
  assert.equal(breath.cells[0][3].rh, null);
  assert.equal(breath.cells[0][2].rh?.ru, "си♭");
  assert.equal(breath.bars[1].letter, "C");

  const answer = chartFor("answer").cells[3].map((cell) => cell.rh?.midi ?? null);
  assert.deepEqual(answer, [60, 70, 67, 60]);
  assert.deepEqual(
    chartFor("answer").cells[3].map((cell) => cell.rh?.finger ?? null),
    [1, 5, 5, 1],
  );
  assert.equal(chartFor("answer").cells[8][2].rh?.midi, 70);

  const early = chartFor("early");
  assert.equal(early.bars[1].letter, "F");
  assert.equal(early.bars[0].letter, "C");
  assert.equal(early.bars[2].letter, "C");

  const stop = chartFor("stop");
  assert.equal(stop.cells[0][0].lh?.midi, 48);
  assert.equal(stop.cells[0][0].rh?.midi, 60);
  assert.equal(stop.cells[0][1].lh, null);
  assert.equal(stop.cells[0][1].rh, null);
  assert.equal(stop.cells[0][0].drum, "hit");
  assert.equal(stop.cells[4][1].lh?.midi, 60);

  const show = chartFor("show");
  assert.equal(show.once, true);
  assert.equal(show.bars.length, 24);
  assert.equal(show.bars[23].letter, "C");
  assert.equal(show.cells[23][0].hold, true);
  assert.equal(show.cells[23][1].rh, null);
  assert.equal(show.cells[12][2].lh, null);
  assert.deepEqual(
    show.cells[0].map((cell) => cell.rh?.midi ?? null),
    chartFor("early").cells[0].map((cell) => cell.rh?.midi ?? null),
  );

  for (const step of ["breath", "answer", "early", "stop", "show"] as const) {
    const chart = chartFor(step);
    for (const bar of chart.cells) {
      for (const cell of bar) {
        if (!cell.lh || !cell.rh) continue;
        assert.notEqual(cell.lh.midi, cell.rh.midi);
        const distance = Math.abs(cell.lh.pc - cell.rh.pc) % 12;
        assert.notEqual(Math.min(distance, 12 - distance), 1);
      }
    }
  }
});

test("chorus feedback stays plain and names a short list of weak bars", () => {
  assert.equal(markFor(0, 0), null);
  assert.equal(markFor(0, 4), "miss");
  assert.equal(markFor(2, 4), "partial");
  assert.equal(markFor(4, 4), "hit");
  assert.equal(formatBarList([9, 10, 12]), "такты 9, 10 и 12");
  assert.equal(formatBarList([5]), "такт 5");
  const weak = weakBars([
    { hits: 4, total: 4 },
    { hits: 1, total: 4 },
    { hits: 0, total: 0 },
  ]);
  assert.deepEqual(weak, [2]);
  assert.match(summarizeChorus(0, 48, []).title, /без нот/);
  assert.match(summarizeChorus(46, 48, []).title, /сел/);
  assert.match(summarizeChorus(20, 48, [9, 12]).detail, /такты 9 и 12/);
  assert.match(summarizeChorus(0, 0, []).title, /выключены/);
});
