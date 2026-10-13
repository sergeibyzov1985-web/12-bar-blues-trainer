import {
  COUNT_WORDS,
  chartFor,
  clampTempo,
  type Hit,
  type StepId,
  type Tone,
} from "./blues";

export type SoundMode = "full" | "hint" | "off";

export interface EngineEvent {
  kind: "count" | "beat" | "stop" | "done";
  label: string;
  bar: number;
  beat: number;
  at: number;
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
  at: 0,
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
  private nextSlot = 0;
  private lap = 0;
  private bpm = 72;
  private loopStart = 0;
  private loopBars = 12;
  private hands = { left: true, right: true };
  private drums = true;
  private sound: SoundMode = "full";
  private generation = 0;
  private step: StepId = "circle";
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
    this.nextSlot = 0;
    this.lap = 0;
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
    this.bpm = next;
    this.cutSound();
    this.generation += 1;
    if (beatFloat < 0) {
      const snapped = Math.round(beatFloat);
      this.origin = now + 0.05 - snapped * (60 / next);
      this.nextBeat = snapped;
      this.nextSlot = 0;
      this.lap = 0;
      return;
    }
    const loopBeats = this.loopBars * 4;
    const lap = Math.floor(beatFloat / loopBeats);
    const within = beatFloat - lap * loopBeats;
    const slots = this.slotClock();
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    slots.forEach((slot, index) => {
      const distance = Math.abs(slot.abs - within);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    const abs = lap * loopBeats + (slots[best]?.abs ?? 0);
    this.origin = now + 0.05 - abs * (60 / next);
    this.nextBeat = 0;
    this.lap = lap;
    this.nextSlot = best;
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
    this.nextSlot = 0;
    this.lap = 0;
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
    while (guard < 48) {
      guard += 1;
      if (this.nextBeat < 0) {
        const time = this.origin + this.nextBeat * spb;
        if (time < this.ctx.currentTime - 0.05) {
          this.nextBeat = Math.ceil(
            (this.ctx.currentTime - 0.02 - this.origin) / spb,
          );
          continue;
        }
        if (time > horizon) break;
        this.scheduleCount(this.nextBeat, time, this.generation);
        this.nextBeat += 1;
        continue;
      }
      const slots = this.slotClock();
      if (slots.length === 0) break;
      if (this.nextSlot >= slots.length) {
        const end = (this.lap + 1) * this.loopBars * 4 + 0.5;
        if (this.once) {
          this.finish(this.origin + end * spb, this.generation);
          break;
        }
        this.lap += 1;
        this.nextSlot = 0;
        continue;
      }
      const slot = slots[this.nextSlot];
      const abs = this.lap * this.loopBars * 4 + slot.abs;
      const slotTime = this.origin + abs * spb;
      if (slotTime < this.ctx.currentTime - 0.05) {
        this.nextSlot += 1;
        continue;
      }
      if (slotTime > horizon) break;
      this.scheduleHit(slot, slotTime, this.generation);
      this.nextSlot += 1;
    }
    this.timer = window.setTimeout(this.scheduler, 25);
  };

  private slotClock(): Array<{ bar: number; abs: number; hit: Hit }> {
    const chart = chartFor(this.step);
    const slots: Array<{ bar: number; abs: number; hit: Hit }> = [];
    for (let index = 0; index < this.loopBars; index += 1) {
      const bar = this.loopStart + index;
      for (const hit of chart.hits[bar] ?? []) {
        slots.push({ bar, abs: index * 4 + hit.at, hit });
      }
    }
    return slots;
  }

  private scheduleCount(index: number, time: number, gen: number): void {
    const beat = index + 4;
    this.tick(time, beat === 0 ? 0.08 : 0.05, beat === 0 ? 1500 : 1080);
    this.arm(time, gen, {
      kind: "count",
      label: COUNT_WORDS[beat],
      bar: -1,
      beat,
      at: beat,
      lap: -1,
      time,
      midis: [],
      tone: null,
    });
  }

  private scheduleHit(
    slot: { bar: number; abs: number; hit: Hit },
    time: number,
    gen: number,
  ): void {
    const { hit, bar } = slot;
    const beat = Math.floor(hit.at + 1e-6);
    const chart = chartFor(this.step);
    const tone = chart.bars[bar]?.tone ?? null;
    const midis: number[] = [];
    const long = Math.abs(hit.at - beat) < 0.05;
    const accent = long ? [1, 0.76, 0.9, 0.76][beat] ?? 0.8 : 0.7;
    const duration = hit.hold
      ? Math.max(1.5, (60 / this.bpm) * 3.2)
      : Math.max(0.12, (60 / this.bpm) * (long ? 0.46 : 0.28));
    const gainScale = this.sound === "hint" ? 0.42 : 1;
    if (this.hands.left && hit.lh) {
      midis.push(hit.lh.midi);
      if (this.sound !== "off") {
        this.piano(hit.lh.midi, time, duration, 0.7 * accent * gainScale);
      }
    }
    if (this.hands.right && hit.rh) {
      midis.push(hit.rh.midi);
      if (this.sound !== "off") {
        this.piano(hit.rh.midi, time, duration, 0.55 * accent * gainScale);
      }
    }
    this.playDrum(hit, time, beat, long);
    this.onExpect?.({
      kind: "beat",
      label: COUNT_WORDS[beat] ?? "",
      bar,
      beat,
      at: hit.at,
      lap: this.lap,
      time,
      midis,
      tone,
    });
    this.arm(time, gen, {
      kind: "beat",
      label: COUNT_WORDS[beat] ?? "",
      bar,
      beat,
      at: hit.at,
      lap: this.lap,
      time,
      midis,
      tone,
    });
  }

  private playDrum(hit: Hit, time: number, beat: number, long: boolean): void {
    if (hit.drum === "swing") {
      if (!this.drums) {
        this.tick(time, long ? 0.05 : 0.03, long ? 1320 : 980);
        return;
      }
      if (long && (beat === 0 || beat === 2)) this.kick(time);
      if (long && (beat === 1 || beat === 3)) this.snare(time);
      this.hat(time, long ? 0.05 : 0.032);
      return;
    }
    if (hit.drum === "hit") {
      if (this.drums && beat === 0) this.kick(time);
      else this.tick(time, beat === 0 ? 0.05 : 0.03, beat === 0 ? 1320 : 980);
      return;
    }
    if (this.drums) this.drum(time, beat);
    else this.tick(time, beat === 0 ? 0.06 : 0.04, beat === 0 ? 1320 : 980);
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
