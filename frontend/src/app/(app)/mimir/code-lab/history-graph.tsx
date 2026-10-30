"use client";

/**
 * The repository's history as the Code Lab goes: main's commits along the top,
 * the branch dropping off it with a dot for each commit, hollow until pushed,
 * and the merge back into main at the end. Before the merge, a pull request
 * shows as the same curve dashed, an arrow asking to join main.
 */

import { cn } from "@/lib/utils";

const MAIN_Y = 18;
const BRANCH_Y = 54;
const STEP = 34;
const MAIN_COMMITS = 3;
const R = 5;
/** Roughly how wide one character of the 10px mono labels is, so the branch's name fits. */
const LABEL_CH = 6.2;
const PR_LABEL = "pull request";

export function HistoryGraph({
  branch,
  commits,
  pushed,
  merged,
  requested = false,
  className,
}: {
  /** The branch's name, or null before it is made. */
  branch: string | null;
  commits: number;
  pushed: number;
  merged: boolean;
  /** Draw the pull request: the merge the branch is asking for. */
  requested?: boolean;
  className?: string;
}) {
  const x = (k: number) => 16 + k * STEP;
  const forkX = x(MAIN_COMMITS - 1);
  const branchX = (k: number) => forkX + STEP * (k + 1);
  const lastX = commits > 0 ? branchX(commits - 1) : forkX + STEP;
  const mergeX = lastX + STEP;
  const asking = Boolean(branch) && requested && !merged;
  // The arrow stops short of the merge it asks for, so its head shows.
  const arrowX = mergeX - R - 3;
  const labelEnd = branch ? forkX + STEP + branch.length * LABEL_CH + 8 : 0;
  const requestEnd = asking ? mergeX + 10 + PR_LABEL.length * LABEL_CH : 0;
  const width = Math.ceil(Math.max(mergeX + 16, labelEnd, requestEnd, 260));

  return (
    <svg
      viewBox={`0 0 ${width} 72`}
      width={width}
      height={72}
      className={cn("max-w-full overflow-visible", className)}
      role="img"
      aria-label={
        branch
          ? `main, with branch ${branch}: ${commits} commit${commits === 1 ? "" : "s"}, ${pushed} pushed${merged ? ", merged into main" : asking ? ", asking to merge into main" : ""}`
          : "main, with no branch yet"
      }
    >
      <line x1={x(0)} y1={MAIN_Y} x2={width - 4} y2={MAIN_Y} className="stroke-muted-foreground/50" strokeWidth={2} />
      {branch && (
        <>
          <path
            d={`M${forkX},${MAIN_Y} C${forkX + STEP / 2},${MAIN_Y} ${forkX + STEP / 2},${BRANCH_Y} ${forkX + STEP},${BRANCH_Y} L${lastX},${BRANCH_Y}`}
            fill="none"
            className="stroke-brand"
            strokeWidth={2}
            strokeDasharray={commits === 0 ? "4 4" : undefined}
          />
          {merged && (
            <path
              d={`M${lastX},${BRANCH_Y} C${lastX + STEP / 2},${BRANCH_Y} ${lastX + STEP / 2},${MAIN_Y} ${mergeX},${MAIN_Y}`}
              fill="none"
              className="stroke-brand"
              strokeWidth={2}
            />
          )}
          {asking && (
            <>
              <path
                d={`M${lastX},${BRANCH_Y} C${lastX + STEP / 2},${BRANCH_Y} ${lastX + STEP / 2},${MAIN_Y} ${arrowX},${MAIN_Y}`}
                fill="none"
                className="stroke-brand"
                strokeWidth={2}
                strokeDasharray="4 3"
              />
              <path d={`M${arrowX + 3},${MAIN_Y} l-7,-4.5 v9 z`} className="fill-brand" />
              <text x={mergeX + 10} y={(MAIN_Y + BRANCH_Y) / 2 + 4} className="fill-brand font-mono text-[10px] font-medium">
                {PR_LABEL}
              </text>
            </>
          )}
          <text x={forkX + STEP} y={BRANCH_Y + 16} className="fill-brand font-mono text-[10px]">
            {branch}
          </text>
        </>
      )}
      {Array.from({ length: MAIN_COMMITS }, (_, k) => (
        <circle key={k} cx={x(k)} cy={MAIN_Y} r={R} className="fill-muted-foreground" />
      ))}
      <text x={x(0)} y={MAIN_Y - 9} className="fill-muted-foreground font-mono text-[10px]">
        main
      </text>
      {Array.from({ length: commits }, (_, k) => (
        <circle
          key={k}
          cx={branchX(k)}
          cy={BRANCH_Y}
          r={R}
          strokeWidth={2}
          className={cn("stroke-brand", k < pushed ? "fill-brand" : "fill-card")}
        />
      ))}
      {merged && <circle cx={mergeX} cy={MAIN_Y} r={R + 1} className="fill-brand" />}
      {asking && <circle cx={mergeX} cy={MAIN_Y} r={R + 1} strokeWidth={1.5} strokeDasharray="2 2" className="fill-card stroke-brand" />}
    </svg>
  );
}
