"use client";

import { useMemo, useState } from "react";
import type { Mover } from "@/lib/types";

const TIERS = [
  { t: "all", label: "ALL" },
  { t: "9", label: "9–11" },
  { t: "7", label: "7–8" },
  { t: "5", label: "5–6" },
  { t: "0", label: "<5" },
] as const;

type Tier = (typeof TIERS)[number]["t"];

const TIER_OK: Record<Tier, (m: Mover) => boolean> = {
  all: () => true,
  "9": (m) => Math.max(m.p, m.s) >= 9,
  "7": (m) => Math.max(m.p, m.s) >= 7 && Math.max(m.p, m.s) < 9,
  "5": (m) => Math.max(m.p, m.s) >= 5 && Math.max(m.p, m.s) < 7,
  "0": (m) => Math.max(m.p, m.s) < 5,
};

function abbrevs(ix: number[], ab: string[]): string {
  return ix.map((i) => ab[i]).join(" · ");
}

export function MoversPanel({
  ups,
  dns,
  nUp,
  nDn,
  abbrevs: ab,
  read,
  onOpen,
}: {
  ups: Mover[];
  dns: Mover[];
  nUp: number;
  nDn: number;
  abbrevs: string[];
  read: string;
  onOpen: (sym: string) => void;
}) {
  const [tier, setTier] = useState<Tier>("all");
  const [delta, setDelta] = useState<string>("all");

  const deltas = useMemo(
    () => [...new Set([...ups, ...dns].map((m) => Math.abs(m.s - m.p)))].sort((a, b) => a - b),
    [ups, dns],
  );
  const deltaCount = (list: Mover[], n: number) => list.filter((m) => Math.abs(m.s - m.p) === n).length;

  const deltaOk = (m: Mover) => delta === "all" || Math.abs(m.s - m.p) === Number(delta);
  const upList = ups.filter(TIER_OK[tier]).filter(deltaOk);
  const dnList = dns.filter(TIER_OK[tier]).filter(deltaOk);

  function row(m: Mover, dir: "up" | "dn") {
    const crossed = dir === "up" ? m.p < 9 && m.s >= 9 : m.p >= 9 && m.s < 9;
    const dl = m.s - m.p;
    const why =
      dir === "up"
        ? (m.g.length ? `gained <u>${abbrevs(m.g, ab)}</u>` : "") +
          (m.l.length ? ` · lost <u>${abbrevs(m.l, ab)}</u>` : "")
        : (m.l.length ? `lost <u>${abbrevs(m.l, ab)}</u>` : "") +
          (m.g.length ? ` · gained <u>${abbrevs(m.g, ab)}</u>` : "");
    return (
      <div key={m.symbol} className="mvr" data-sym={m.symbol} onClick={() => onOpen(m.symbol)}>
        <span className="t">{m.symbol}</span>
        <span className="arc">
          {m.p} → <em>{m.s}</em>
        </span>
        <span className={`dch ${dl > 0 ? "u" : "d"}`}>
          {dl > 0 ? "+" : "\u2212"}
          {Math.abs(dl)}
        </span>
        {crossed ? <span className={`tag ${dir === "up" ? "in" : "out"}`}>{dir === "up" ? "ENTERED 9+" : "LOST 9+"}</span> : null}
        <span className="why" dangerouslySetInnerHTML={{ __html: why }} />
      </div>
    );
  }

  return (
    <>
      <div className="sech">
        <h2>What moved</h2>
        <div className="seg">
          {TIERS.map((x) => (
            <button key={x.t} className={tier === x.t ? "on" : ""} onClick={() => setTier(x.t)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={delta === "all" ? "on" : ""} onClick={() => setDelta("all")}>
            ANY Δ
          </button>
          {deltas.map((n) => (
            <button key={n} className={delta === String(n) ? "on" : ""} onClick={() => setDelta(String(n))}>
              ±{n} ({deltaCount(ups, n)}/{deltaCount(dns, n)})
            </button>
          ))}
        </div>
      </div>
      <p className="readline">{read}</p>
      <div className="panel">
        <div className="mv">
          <div>
            <div className="mvh">
              <span className="eyebrow">Upgrades</span>
              <s>
                {upList.length} of {nUp}
              </s>
            </div>
            <div className="mvl">{upList.length ? upList.map((m) => row(m, "up")) : <div className="mvempty">No upgrades touched this tier.</div>}</div>
          </div>
          <div>
            <div className="mvh">
              <span className="eyebrow">Downgrades</span>
              <s>
                {dnList.length} of {nDn}
              </s>
            </div>
            <div className="mvl">{dnList.length ? dnList.map((m) => row(m, "dn")) : <div className="mvempty">No downgrades touched this tier.</div>}</div>
          </div>
        </div>
        <div className="note">A move is listed under the highest tier it touched, so an exit from 9+ still appears under 9–11.</div>
      </div>
    </>
  );
}
