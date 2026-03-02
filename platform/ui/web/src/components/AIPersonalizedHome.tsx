export type PersonalizedBlock = {
  id: string;
  title: string;
  confidence: number;
  mode: 'media' | 'map' | 'community' | 'chat';
};

export function AIPersonalizedHome({ blocks }: { blocks: PersonalizedBlock[] }) {
  return (
    <main className="min-h-screen bg-[#090b14] text-white p-6">
      <header className="mb-6 rounded-2xl border border-cyan-400/30 bg-white/10 backdrop-blur-xl p-4 shadow-[0_0_24px_rgba(34,211,238,0.25)]">
        <h1 className="text-2xl font-semibold">Your Adaptive Universe</h1>
        <p className="text-cyan-100/80">Layout generated from real-time intent, context, and wellbeing signals.</p>
      </header>
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {blocks.map((block) => (
          <article key={block.id} className="rounded-2xl bg-white/5 border border-fuchsia-400/20 backdrop-blur-lg p-4 transition-all duration-200 hover:scale-[1.01]">
            <h2 className="text-lg font-medium">{block.title}</h2>
            <p className="text-sm text-fuchsia-100/70">Mode: {block.mode}</p>
            <p className="text-xs text-fuchsia-200/70">AI confidence: {(block.confidence * 100).toFixed(1)}%</p>
          </article>
        ))}
      </section>
    </main>
  );
}
