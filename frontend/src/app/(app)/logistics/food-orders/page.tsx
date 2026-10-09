/** The Food orders tab: what is ordered, from whom, and when it arrives. */

import { auth } from "@/auth";
import { FOOD_ORDER_LIST } from "@/lib/list-specs";
import { listFoodOrders } from "@/lib/logistics/food-orders";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings } from "@/lib/roles";
import { FoodOrdersView } from "./food-orders-view";

export default async function FoodOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const query = parseListQuery(await searchParams, FOOD_ORDER_LIST);
  return (
    <FoodOrdersView
      query={query}
      page={await listFoodOrders(query)}
      canEdit={!!session?.user && canManageTrainingSettings(session.user.access)}
    />
  );
}
