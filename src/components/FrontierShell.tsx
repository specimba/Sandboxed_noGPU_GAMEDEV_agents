"use client";


import { useEffect, useRef, useState } from "react";

/** React shell for STEEL FRONTIER: mounts the canvas, awaits async boot. */
export default function FrontierShell() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 block h-full w-full";
    host.appendChild(canvas);

    let dispose: (() => void) | null = null;
    let cancelled = false;

    import("@/frontier/main")
      .then((m) => m.boot(canvas))
      .then((d) => {
        if (cancelled) { d(); return; }
        dispose = d;
        setBooted(true);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[FRONTIER] boot failed", e);
        setError("Your browser could not start the engine. A WebGPU- or WebGL2-capable browser is required.");
      });

    return () => {
      cancelled = true;
      dispose?.();
      canvas.remove();
    };
  }, []);

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-[#0b0806]" style={{ touchAction: "none" }}>
      <div ref={hostRef} className="absolute inset-0" />
      {!booted && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="animate-pulse font-mono text-xs tracking-[0.45em] text-neutral-500">
            FIRING FURNACES…
          </p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center px-8">
          <p className="max-w-md text-center font-mono text-sm leading-6 tracking-wider text-[#ff3b30]">
            {error}
          </p>
        </div>
      )}
    </div>
  );
}
