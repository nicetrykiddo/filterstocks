"use client";

import type { ScanResult } from "@/lib/types";
import { Modal } from "./ui";

/**
 * The reading guide: what the score counts, what the columns mean, and how
 * the move tiers are assigned. Everything the scan claims is documented here
 * so the dashboard never asks for blind trust.
 */
export function HowToRead({ scan, onClose }: { scan: ScanResult; onClose: () => void }) {
  const groups = ["trend", "momentum", "contraction"] as const;
  const groupLabels = { trend: "Trend conditions", momentum: "Momentum conditions", contraction: "Contraction conditions" } as const;

  return (
    <Modal title="How to read this dashboard" onClose={onClose}>
      <div className="space-y-6 text-[13px] leading-relaxed text-ink2">
        <p>
          Every session, each stock in the universe is scored against{" "}
          <strong className="text-ink">eleven written conditions</strong>: five on trend, two on
          momentum, and four on contraction. One point per pass, so the score runs 0 to 11. A 9 or
          better means a stock keeps a quality trend while physically tightening with drying
          volume, which is the setup this scan hunts. Nothing here is a buy or sell instruction.
        </p>

        {groups.map((g) => (
          <div key={g}>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink3">
              {groupLabels[g]}
            </h3>
            <ol className="space-y-2.5">
              {scan.conditions.map((c, i) =>
                c.group !== g ? null : (
                  <li key={c.key} className="border-l-2 border-rule pl-3">
                    <p className="text-[13px] font-medium text-ink">
                      <span className="num mr-1.5 text-ink3">{i + 1}</span>
                      {c.label}
                    </p>
                    <p className="mt-0.5">{c.detail}</p>
                  </li>
                ),
              )}
            </ol>
          </div>
        ))}

        <div>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink3">
            Columns
          </h3>
          <dl className="space-y-2">
            <div>
              <dt className="text-[13px] font-medium text-ink">Score and band</dt>
              <dd>
                The eleven-condition sum, bucketed 9-11, 7-8, 5-6 and under 5. The eleven small
                squares in each row are the individual conditions, filled when passed, so you can
                see what a score is made of without opening the row.
              </dd>
            </div>
            <div>
              <dt className="text-[13px] font-medium text-ink">Δ</dt>
              <dd>Score change against the previous session.</dd>
            </div>
            <div>
              <dt className="text-[13px] font-medium text-ink">Held</dt>
              <dd>
                How many consecutive sessions the stock has sat on exactly this score. A value of 1
                means it changed today; 12 means twelve static sessions.
              </dd>
            </div>
            <div>
              <dt className="text-[13px] font-medium text-ink">vs 20 DMA</dt>
              <dd>The close against its own 20-session average.</dd>
            </div>
            <div>
              <dt className="text-[13px] font-medium text-ink">Volume</dt>
              <dd>Shares traded in the session, in lakh and crore units.</dd>
            </div>
            <div>
              <dt className="text-[13px] font-medium text-ink">What moved tiers</dt>
              <dd>
                A move is listed under the highest tier it touched, so an exit from 9+ still appears
                under 9-11 rather than quietly dropping down the page.
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-[6px] border border-rule bg-raise/50 px-4 py-3">
          <p className="text-[12.5px]">
            Prices come from NSE end-of-day bhavcopies and are adjusted for splits and bonuses using
            the exchange&rsquo;s own previous-close field. The scan runs after the session closes and is
            published for research and education only; it is not investment advice, and nothing in
            it is a recommendation to trade.
          </p>
        </div>
      </div>
    </Modal>
  );
}
