export function PlatformHealthPanel() {
  const stats = [
    ['Concurrent Users', '102.4M'],
    ['P95 Latency', '84ms'],
    ['Realtime Msg/s', '12.8M'],
    ['Moderation Queue Lag', '0.8s'],
  ];

  return (
    <section className="rounded-3xl border border-emerald-300/20 bg-black/30 backdrop-blur-xl p-5 shadow-[0_0_20px_rgba(16,185,129,0.25)]">
      <h3 className="text-lg font-semibold text-emerald-200">Platform Health</h3>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white/5 p-3">
            <div className="text-xs text-emerald-100/70">{label}</div>
            <div className="text-xl font-semibold">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
