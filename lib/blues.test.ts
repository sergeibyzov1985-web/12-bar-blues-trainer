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

test("circle preview shows the three bass homes and the black key", () => {
  const homes = previewNotes("circle", 0).map((note) => note.midi);
  assert.deepEqual(homes, [48, 53, 55, 70]);
});

test("phrases keep the early F and the answer, and the piece swings", () => {
  const phrases = chartFor("phrases");
  assert.equal(phrases.bars[1].letter, "F");
  assert.equal(phrases.hits[0][3].rh, null);
  assert.deepEqual(
    phrases.hits[3].map((hit) => hit.rh?.midi ?? null),
    [60, 70, 67, 60],
  );

  const piece = chartFor("piece");
  assert.equal(piece.once, true);
  assert.equal(piece.bars[1].letter, "F");
  assert.equal(piece.bars[11].letter, "C");
  assert.equal(piece.hits[0].length, 8);
  assert.ok(Math.abs(piece.hits[0][1].at - 2 / 3) < 1e-6);
  assert.deepEqual(
    piece.hits[0].slice(0, 6).map((hit) => hit.rh?.midi),
    [60, 67, 70, 67, 60, 67],
  );
  assert.equal(piece.hits[2][7].rh?.midi, 60);
  assert.equal(piece.hits[3][0].rh?.midi, 70);
  assert.equal(piece.hits[8].length, 1);
  assert.equal(piece.hits[11][0].hold, true);

  for (const bar of piece.hits) {
    for (const hit of bar) {
      if (!hit.lh || !hit.rh) continue;
      assert.notEqual(hit.lh.midi, hit.rh.midi);
      const distance = Math.abs(hit.lh.pc - hit.rh.pc) % 12;
      assert.notEqual(Math.min(distance, 12 - distance), 1);
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
