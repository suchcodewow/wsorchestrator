/**
 * Food orders to print on letter paper: one order from its print button, or
 * the list as Food orders shows it, a page at a time. It sits outside the
 * app's shell so only the orders print.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { FOOD_ORDER_LIST } from "@/lib/list-specs";
import { foodOrdersById, listFoodOrders } from "@/lib/logistics/food-orders";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";
import { OrderSheet } from "./order-sheet";

export const metadata: Metadata = { title: "Food orders" };

export default async function FoodOrdersPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  const params = await searchParams;
  const id = typeof params.id === "string" ? params.id : null;
  const orders = id ? await foodOrdersById([id]) : (await listFoodOrders(parseListQuery(params, FOOD_ORDER_LIST))).rows;
  if (id && orders.length === 0) notFound();

  return <OrderSheet orders={orders} single={id !== null} />;
}
