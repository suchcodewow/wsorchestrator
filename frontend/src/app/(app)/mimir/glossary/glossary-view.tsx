"use client";

/** The glossary's terms in one list, filtered by category and searched on the server. */

import { motion } from "framer-motion";
import { Pager, TableSearch } from "@/components/data-table";
import type { MimirItemSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { ChipNav } from "../chip-nav";

type Term = { id: string; title: string; category: string; definition: string; seeAlso: string };

export function GlossaryView({
  query,
  count,
  categories,
  category,
  page,
}: {
  query: ListQuery<MimirItemSort>;
  count: number;
  categories: { id: string; title: string; emoji: string }[];
  category: string | null;
  page: Page<Term>;
}) {
  const href = (id: string | null) => (id ? `/mimir/glossary?category=${encodeURIComponent(id)}` : "/mimir/glossary");

  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">Glossary</h2>
          <p className="text-sm text-muted-foreground tnum">
            <span className="font-medium text-foreground">{count.toLocaleString()}</span> terms in {categories.length} categories
          </p>
        </div>
        <TableSearch value={query.q} placeholder="Search terms, e.g. canary" label="Search the glossary" className="w-full sm:w-72" />
      </motion.div>

      <motion.div variants={riseChild}>
        <ChipNav
          label="Glossary categories"
          chips={[
            { href: href(null), label: "All", active: category === null },
            ...categories.map((c) => ({ href: href(c.id), label: `${c.emoji} ${c.title}`.trim(), active: c.id === category })),
          ]}
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
        {page.rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted-foreground">
            {query.q ? `No terms match “${query.q}”.` : "No terms yet."}
          </p>
        ) : (
          <dl className="divide-y">
            {page.rows.map((t) => (
              <div key={t.id} className="space-y-1 px-5 py-4">
                <dt className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium text-brand">{t.title}</span>
                  {category === null && t.category && <span className="text-xs text-muted-foreground">{t.category}</span>}
                </dt>
                <dd className="leading-relaxed">{t.definition}</dd>
                {t.seeAlso && <dd className="text-xs text-muted-foreground">See also: {t.seeAlso}</dd>}
              </div>
            ))}
          </dl>
        )}
        <div className="border-t empty:hidden">
          <Pager page={page} noun="terms" />
        </div>
      </motion.div>
    </motion.div>
  );
}
