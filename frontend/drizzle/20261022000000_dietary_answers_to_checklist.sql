-- Gives the answers to the old dietary questions (the yes/no `dietary`, the
-- description `dietary-needs` and the 1-5 `dietary-critical`) a place in the
-- dietary checklist, which the Dietary needs page now reads:
--   dietary-restrictions            the items checked
--   dietary-restrictions-critical   those marked Critical
--   dietary-restrictions-other      what was written in for Other
--
-- Each description is read for the checklist's items (dairy, gluten, kosher,
-- ...) and those are checked. Unless the description is nothing more than one
-- item's name, it is also written in under Other in full, so nothing a person
-- wrote is lost to the keyword match and whoever reads the write-in sees it in
-- their own words. A 4 or 5 on the old scale (5 was an allergy or a religious
-- restriction) marks everything checked Critical. A level written out in words
-- is kept in the write-in. "No", "n/a" and blanks add nothing.
--
-- The old answers are left in place. Only responses with no checklist answer
-- yet are touched, so it is safe to run again, on any database:
--   * fresh/empty      - skipped entirely; db:push creates the schema outright
--   * before this      - old answers gain checklist answers
--   * already migrated - a guarded no-op

begin;

do $$
begin
  if to_regclass('public.intake_responses') is null then
    raise notice 'no intake_responses yet - nothing to migrate';
    return;
  end if;

  update intake_responses r
  set answers = r.answers
    || jsonb_build_object('dietary-restrictions', to_jsonb(c.items))
    || case
         when c.critical then jsonb_build_object('dietary-restrictions-critical', to_jsonb(c.items))
         else '{}'::jsonb
       end
    || case
         when c.other_text is not null then jsonb_build_object('dietary-restrictions-other', c.other_text)
         else '{}'::jsonb
       end
  from (
    select
      s.id,
      s.other_text,
      s.critical,
      (
        select array_agg(k.item order by k.ord)
        from (
          values
            ('Dairy', '\m(dairy|milk|lactose)', 1),
            ('Gluten / wheat', '\m(gluten|wheat|celiac|coeliac)', 2),
            ('Peanuts', '\mpeanut', 3),
            ('Tree nuts', 'tree.?nut|\m(almond|cashew|walnut|pecan|pistachio)', 4),
            ('Shellfish', '\m(shellfish|shrimp|prawn|crab|lobster)', 5),
            ('Eggs', '\meggs?\M', 6),
            ('Soy', '\msoy', 7),
            ('Fish', '\mfish', 8),
            ('Vegetarian', '\mvegetarian', 9),
            ('Vegan', '\mvegan', 10),
            ('Kosher', '\mkosher', 11),
            ('Halal', '\mhalal', 12),
            ('Pescatarian', '\mpesc[ae]tarian', 13),
            ('No pork', '\mpork', 14),
            ('Low sodium', 'low.?sodium|low.?salt', 15),
            ('Other', null, 16)
        ) as k(item, pattern, ord)
        where (k.item = 'Other' and s.other_text is not null)
           or (k.pattern is not null and lower(s.needs) ~ k.pattern)
      ) as items
    from (
      select
        t.id,
        t.needs,
        -- Written in whole, unless the description is just one item's name.
        case
          when t.text = '' then null
          when t.extra = '' and lower(t.needs) in (
            'dairy', 'gluten / wheat', 'peanuts', 'tree nuts', 'shellfish', 'eggs',
            'soy', 'fish', 'vegetarian', 'vegan', 'kosher', 'halal', 'pescatarian',
            'no pork', 'low sodium'
          ) then null
          else left(t.text, 500)
        end as other_text,
        t.level >= 4 as critical
      from (
        select
          x.id,
          x.needs,
          x.extra,
          x.level,
          concat_ws('; ', nullif(x.needs, ''), nullif(x.extra, '')) as text
        from (
          select
            i.id,
            -- A description that is a "no" or a blank says nothing.
            case
              when lower(n.needs) in ('', 'n/a', 'na', 'none', 'no', 'nope', 'nothing', '-', '0', 'not applicable')
                then ''
              else n.needs
            end as needs,
            -- A level written out in words rather than 1-5.
            case
              when n.crit ~ '^[0-9]+$' or lower(n.crit) in ('', 'n/a', 'na', 'none', 'no', '-') then ''
              else n.crit
            end as extra,
            case when n.crit ~ '^[0-9]$' then n.crit::int else 0 end as level,
            lower(n.dietary) as dietary
          from intake_responses i
          cross join lateral (
            select
              btrim(case when jsonb_typeof(i.answers -> 'dietary') = 'string' then i.answers ->> 'dietary' else '' end) as dietary,
              btrim(case when jsonb_typeof(i.answers -> 'dietary-needs') = 'string' then i.answers ->> 'dietary-needs' else '' end) as needs,
              btrim(case when jsonb_typeof(i.answers -> 'dietary-critical') = 'string' then i.answers ->> 'dietary-critical' else '' end) as crit
          ) n
          where not (i.answers ? 'dietary-restrictions')
            and (i.answers ? 'dietary' or i.answers ? 'dietary-needs')
        ) x
        where x.needs <> '' or (x.dietary = 'yes' and x.extra <> '')
      ) t
    ) s
  ) c
  where r.id = c.id
    and c.items is not null;
end $$;

commit;
