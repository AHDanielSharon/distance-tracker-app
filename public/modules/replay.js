export class ReplayController {
  constructor(sliderEl) {
    this.sliderEl = sliderEl;
    this.history = [];
    this.onFrame = null;
    this.playing = false;
    this.raf = null;
    this.sliderEl.addEventListener('input', () => this.emitCurrent());
  }

  setHistory(history) {
    this.history = history || [];
    this.sliderEl.min = '0';
    this.sliderEl.max = String(Math.max(0, this.history.length - 1));
    this.sliderEl.value = this.sliderEl.max;
  }

  emitCurrent() {
    const idx = Number(this.sliderEl.value || 0);
    const point = this.history[idx];
    if (point && this.onFrame) this.onFrame(point, idx, this.history.length);
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    const tick = () => {
      if (!this.playing) return;
      const max = Number(this.sliderEl.max || 0);
      let v = Number(this.sliderEl.value || 0);
      if (v < max) {
        v += 1;
        this.sliderEl.value = String(v);
        this.emitCurrent();
        this.raf = requestAnimationFrame(tick);
      } else {
        this.playing = false;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  }
}
