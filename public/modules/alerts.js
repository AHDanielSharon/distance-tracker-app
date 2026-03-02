import { MovementAnalytics } from './analytics.js';

export class AlertsManager {
  constructor() {
    this.radius = 100;
    this.sound = false;
    this.prevInside = new Set();
  }

  setRadius(v) { this.radius = v; }
  setSound(v) { this.sound = v; }

  async ensureNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'default') {
      const p = await Notification.requestPermission();
      return p === 'granted';
    }
    return false;
  }

  beep() {
    if (!this.sound) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }

  async notify(text) {
    const ok = await this.ensureNotificationPermission();
    if (ok) new Notification(text);
  }

  async checkProximity(me, users, onAlert) {
    if (!me || typeof me.lat !== 'number') return;
    const nowInside = new Set();

    users.forEach((u) => {
      if (u.id === me.id || typeof u.lat !== 'number') return;
      const d = MovementAnalytics.haversine(me, u);
      if (d <= this.radius) nowInside.add(u.id);

      const was = this.prevInside.has(u.id);
      if (!was && d <= this.radius) {
        const msg = `${u.name} entered ${Math.round(this.radius)}m radius`;
        this.beep();
        if (navigator.vibrate) navigator.vibrate([120, 50, 120]);
        this.notify(msg);
        onAlert?.(msg, 'enter');
      }
      if (was && d > this.radius) {
        const msg = `${u.name} exited ${Math.round(this.radius)}m radius`;
        this.beep();
        this.notify(msg);
        onAlert?.(msg, 'exit');
      }
    });

    this.prevInside = nowInside;
  }
}
