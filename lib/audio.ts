import {
  COUNT_WORDS,
  cellAt,
  chartFor,
  clampTempo,
  positionInLoop,
  type Cell,
  type StepId,
  type Tone,
} from "./blues";

export type SoundMode = "full" | "hint" | "off";

export interface EngineEvent {
  kind: "count" | "beat" | "stop" | "done";
  label: string;
  bar: number;
  beat: number;
  lap: number;
  time: number;
  midis: number[];
  tone: Tone | null;
}

const EMPTY_EVENT: EngineEvent = {
  kind: "stop",
  label: "",
  bar: -1,
  beat: 0,
  lap: -1,
  time: 0,
  midis: [],
  tone: null,
};

export class BluesEngine {
  onEvent: ((event: EngineEvent) => void) | null = null;
  onExpect: ((event: EngineEvent) => void) | null = null;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;
  private timeouts: number[] = [];
  private voices: Array<{
    node: OscillatorNode | AudioBufferSourceNode;
    start: number;
  }> = [];
  private playing = false;
  private origin = 0;
  private nextBeat = 0;
  private bpm = 72;
  private loopStart = 0;
  private loopBars = 12;
  private hands = { left: true, right: true };
  private drums = true;
  private sound: SoundMode = "full";
  private generation = 0;
  private step: StepId = "listen";
  private once = false;

  whenReady(): Promise<void> {
    const ctx = this.ensure();
    if (ctx.state === "closed") return Promise.reject(new Error("audio-closed"));
    const pending = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    return pending.then(() => {
      if (ctx.state !== "running") throw new Error("audio-blocked");
    });
  }

  start(): void {
    const ctx = this.ensure();
    if (ctx.state === "closed") throw new Error("audio-closed");
    this.playing = true;
    this.cutSound();
    this.generation += 1;
    const spb = 60 / this.bpm;
    this.origin = ctx.currentTime + 0.08 + 4 * spb;
    this.nextBeat = -4;
    window.clearTimeout(this.timer);
    this.scheduler();
  }

  stop(): void {
    this.playing = false;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.cutSound();
    this.generation += 1;
    this.onEvent?.({
      ...EMPTY_EVENT,
      time: this.ctx?.currentTime ?? 0,
    });
  }

  dispose(): void {
    this.playing = false;
    window.clearTimeout(this.timer);
    this.cutSound();
    this.generation += 1;
    void this.ctx?.close();
    this.ctx = null;
  }

  setBpm(bpm: number): void {
    const next = clampTempo(bpm);
    if (next === this.bpm) return;
    if (!this.playing || !this.ctx) {
      this.bpm = next;
      return;
    }
    const now = this.ctx.currentTime;
    const beatFloat = (now - this.origin) / (60 / this.bpm);
    const snapped = Math.round(beatFloat);
    this.bpm = next;
    this.cutSound();
    this.generation += 1;
    this.origin = now + 0.05 - snapped * (60 / next);
    this.nextBeat = snapped;
  }

  setLoop(start: number, bars: number): void {
    if (this.loopStart === start && this.loopBars === bars) return;
    this.loopStart = start;
    this.loopBars = bars;
    if (!this.playing || !this.ctx) return;
    this.cutSound();
    this.generation += 1;
    this.origin = this.ctx.currentTime + 0.06;
    this.nextBeat = 0;
  }

  setHands(hands: { left: boolean; right: boolean }): void {
    this.hands = hands;
  }

  setDrums(drums: boolean): void {
    this.drums = drums;
  }

  setSound(sound: SoundMode): void {
    this.sound = sound;
  }

  setStep(step: StepId, once: boolean): void {
    this.step = step;
    this.once = once;
  }

  playNote(midi: number, velocity = 0.85): number {
    const ctx = this.ensure();
    const time = ctx.currentTime;
    this.piano(midi, time, 0.42, velocity);
    return time;
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) throw new Error("audio-missing");
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.75;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    master.connect(comp);
    comp.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    this.master = master;
    this.noise = noise;
    return ctx;
  }

  private scheduler = (): void => {
    if (!this.playing || !this.ctx) return;
    const horizon = this.ctx.currentTime + 0.3;
    const spb = 60 / this.bpm;
    let guard = 0;
    while (guard < 32) {
      guard += 1;
      const time = this.origin + this.nextBeat * spb;
      if (time < this.ctx.currentTime - 0.05) {
        this.nextBeat = Math.ceil(
          (this.ctx.currentTime - 0.02 - this.origin) / spb,
        );
        continue;
      }
      if (time > horizon) break;
      const chart = chartFor(this.step);
      if (this.once && this.nextBeat >= chart.cells.length * 4) {
        this.finish(time, this.generation);
        break;
      }
      this.scheduleBeat(this.nextBeat, time, this.generation);
      this.nextBeat += 1;
    }
    this.timer = window.setTimeout(this.scheduler, 25);
  };

  private scheduleBeat(index: number, time: number, gen: number): void {
    if (index < 0) {
      const beat = index + 4;
      this.tick(time, beat === 0 ? 0.08 : 0.05, beat === 0 ? 1500 : 1080);
      const event: EngineEvent = {
        kind: "count",
        label: COUNT_WORDS[beat],
        bar: -1,
        beat,
        lap: -1,
        time,
        midis: [],
        tone: null,
      };
      this.arm(time, gen, event);
      return;
    }

    const chart = chartFor(this.step);
    const pos = positionInLoop(index, this.loopStart, this.loopBars);
    const cell: Cell = cellAt(this.step, pos.bar, pos.beat);
    const tone = chart.bars[pos.bar]?.tone ?? null;
    const midis: number[] = [];
    const accent = [1, 0.76, 0.9, 0.76][pos.beat];
    const duration = cell.hold
      ? Math.max(1.5, (60 / this.bpm) * 3.2)
      : Math.max(0.16, (60 / this.bpm) * 0.46);
    const gainScale = this.sound === "hint" ? 0.42 : 1;
    if (this.hands.left && cell.lh) {
      midis.push(cell.lh.midi);
      if (this.sound !== "off") {
        this.piano(cell.lh.midi, time, duration, 0.7 * accent * gainScale);
      }
    }
    if (this.hands.right && cell.rh) {
      midis.push(cell.rh.midi);
      if (this.sound !== "off") {
        this.piano(cell.rh.midi, time, duration, 0.55 * accent * gainScale);
      }
    }
    if (cell.drum === "hit") {
      if (this.drums && pos.beat === 0) this.kick(time);
      else this.tick(time, pos.beat === 0 ? 0.05 : 0.03, pos.beat === 0 ? 1320 : 980);
    } else if (this.drums) {
      this.drum(time, pos.beat);
    } else {
      this.tick(time, pos.beat === 0 ? 0.06 : 0.04, pos.beat === 0 ? 1320 : 980);
    }

    const event: EngineEvent = {
      kind: "beat",
      label: COUNT_WORDS[pos.beat],
      bar: pos.bar,
      beat: pos.beat,
      lap: pos.lap,
      time,
      midis,
      tone,
    };
    this.onExpect?.(event);
    this.arm(time, gen, event);
  }

  private finish(time: number, gen: number): void {
    this.playing = false;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.arm(time, gen, { ...EMPTY_EVENT, kind: "done", time }, true);
  }

  private arm(
    time: number,
    gen: number,
    event: EngineEvent,
    allowStopped = false,
  ): void {
    if (!this.ctx) return;
    const delay = Math.max(0, (time - this.ctx.currentTime - 0.03) * 1000);
    const id = window.setTimeout(() => {
      if (gen !== this.generation) return;
      if (!this.playing && !allowStopped) return;
      this.onEvent?.(event);
    }, delay);
    this.timeouts.push(id);
  }

  private piano(
    midi: number,
    time: number,
    duration: number,
    velocity: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const freq = 440 * 2 ** ((midi - 69) / 12);
    const partials = [1, 2, 3, 4, 5];
    const amps = [0.9, 0.36, 0.16, 0.07, 0.035];
    const end = time + Math.max(duration, 0.18);
    for (let i = 0; i < partials.length; i += 1) {
      const n = partials[i];
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * n * (1 + 0.00015 * n * n);
      const gain = ctx.createGain();
      const peak = Math.max(0.0001, velocity * 0.16 * amps[i]);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(peak, time + 0.01);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, peak * 0.32),
        time + 0.08,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(master);
      osc.start(time);
      osc.stop(end + 0.02);
      this.track(osc, time);
    }
    if (!this.noise) return;
    const hammer = ctx.createBufferSource();
    hammer.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, velocity * 0.05), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
    hammer.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    hammer.start(time);
    hammer.stop(time + 0.03);
    this.track(hammer, time);
  }

  private drum(time: number, beat: number): void {
    if (beat === 0 || beat === 2) this.kick(time);
    if (beat === 1 || beat === 3) this.snare(time);
    this.hat(time, 0.045);
    this.hat(time + (60 / this.bpm) * 0.5, 0.02);
  }

  private kick(time: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(148, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.09);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.46, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    osc.connect(gain);
    gain.connect(master);
    osc.start(time);
    osc.stop(time + 0.18);
    this.track(osc, time);
  }

  private snare(time: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise) return;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.16, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    noise.start(time);
    noise.stop(time + 0.12);
    this.track(noise, time);
  }

  private hat(time: number, velocity: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise) return;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    noise.start(time);
    noise.stop(time + 0.04);
    this.track(noise, time);
  }

  private tick(time: number, velocity: number, freq: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, velocity), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(time);
    osc.stop(time + 0.05);
    this.track(osc, time);
  }

  private track(
    node: OscillatorNode | AudioBufferSourceNode,
    start: number,
  ): void {
    this.voices.push({ node, start });
    node.onended = () => {
      const index = this.voices.findIndex((voice) => voice.node === node);
      if (index >= 0) this.voices.splice(index, 1);
    };
  }

  private cutSound(): void {
    const when = this.ctx?.currentTime ?? 0;
    for (const voice of this.voices) {
      try {
        voice.node.stop(Math.max(when, voice.start));
      } catch {
        // already stopped
      }
    }
    this.voices = [];
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts = [];
  }
}
