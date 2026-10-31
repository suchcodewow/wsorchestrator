/** The logo gear bouncing inside a turning ring: shown while a page waits on the server. */

import { Gear } from "@/components/brand-mark";

export function GearLoader() {
  return (
    <div role="status" className="gear-loader flex justify-center py-24">
      <div className="gear-loader-wheel">
        {/* pathLength 60 makes "5 5" six dashes and six gaps, wherever the radius lands. */}
        <svg viewBox="0 0 84 84" className="gear-loader-ring" aria-hidden>
          <circle
            cx="42"
            cy="42"
            r="40.5"
            pathLength="60"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray="5 5"
          />
        </svg>
        <span className="gear-loader-hop">
          <Gear />
        </span>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
