import { RepoDashboard } from "@/components/RepoDashboard";

export default function Home() {
  return (
    <main>
      <header className="masthead">
        <div className="wrap">
          <div className="brand">
            <h1>
              inspectra<span className="cursor">_</span>
            </h1>
            <span className="tag">AI code review</span>
          </div>
          <p className="lede">
            Every connected repo is embedded into a searchable index. When a
            pull request opens, Inspectra retrieves the code around your change
            and leaves inline review comments — not just on the diff, but on
            what the diff touches.
          </p>
        </div>
      </header>

      <div className="wrap">
        <RepoDashboard />
      </div>
    </main>
  );
}
