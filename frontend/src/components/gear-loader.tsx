/** The logo gear rolling along a road: shown while a page waits on the server. */

import { Gear } from "@/components/brand-mark";

export function GearLoader() {
  return (
    <div role="status" className="gear-loader flex justify-center py-24">
      <div className="gear-loader-road">
        <span className="gear-loader-hop">
          <Gear />
        </span>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
