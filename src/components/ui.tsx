"use client";

import { useEffect } from "react";

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 2000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div role="status" aria-live="polite" className="toast">
      {message}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="wrap flex-1">
      <div className="empty" style={{ maxWidth: 560, margin: "0 auto" }}>
        <p style={{ color: "var(--text)", fontWeight: 500 }}>The scan could not be loaded</p>
        <p className="readline" style={{ margin: "8px auto 16px", maxWidth: "52ch" }}>
          {message}
        </p>
        <button type="button" className="lnk" onClick={onRetry}>
          Try again
        </button>
      </div>
    </main>
  );
}
