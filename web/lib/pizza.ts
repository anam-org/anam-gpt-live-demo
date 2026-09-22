import { z } from 'zod';

export const TOPPINGS = [
  { id: 'mozzarella', name: 'Mozzarella' },
  { id: 'pepperoni', name: 'Pepperoni' },
  { id: 'mushrooms', name: 'Mushrooms' },
  { id: 'red_onion', name: 'Red onion' },
  { id: 'bell_pepper', name: 'Bell pepper' },
  { id: 'olives', name: 'Olives' },
  { id: 'jalapenos', name: 'Jalapeños' },
  { id: 'pineapple', name: 'Pineapple' },
  { id: 'basil', name: 'Basil' },
  { id: 'sweetcorn', name: 'Sweetcorn' },
] as const;

export type ToppingId = typeof TOPPINGS[number]['id'];
export type PizzaType = 'margherita' | 'pepperoni';
export const PIZZAS: { id: PizzaType; name: string; description: string; toppings: ToppingId[] }[] = [
  { id: 'margherita', name: 'Margherita', description: 'Tomato, mozzarella & basil', toppings: ['mozzarella', 'basil'] },
  { id: 'pepperoni', name: 'Pepperoni', description: 'Tomato, mozzarella & pepperoni', toppings: ['mozzarella', 'pepperoni'] },
];

export type PizzaOrder = { pizzaType: PizzaType | null; toppings: ToppingId[]; status: 'building' | 'confirmed'; revision: number };
export const initialOrder = (): PizzaOrder => ({ pizzaType: null, toppings: [], status: 'building', revision: 0 });
export const toppingName = (id: ToppingId) => TOPPINGS.find(t => t.id === id)!.name;
export const pizzaName = (id: PizzaType) => PIZZAS.find(p => p.id === id)!.name;

const toppingId = z.enum(TOPPINGS.map(t => t.id) as [ToppingId, ...ToppingId[]]);
const revision = z.number().int().nonnegative();
export const pizzaCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read') }).strict(),
  z.object({ action: z.literal('select_base'), pizzaType: z.enum(['margherita', 'pepperoni']), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('set_topping'), topping: toppingId, selected: z.boolean(), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('update'), pizzaType: z.enum(['margherita', 'pepperoni']), toppings: z.array(toppingId).max(10), expectedRevision: revision }).strict(),
  z.object({ action: z.literal('confirm'), expectedRevision: revision }).strict(),
]);
export type PizzaCommand = z.infer<typeof pizzaCommandSchema>;

export function describeOrder(order: PizzaOrder) {
  if (order.pizzaType === null) return 'No pizza selected yet. Choose Margherita or Pepperoni by voice.';
  return `${pizzaName(order.pizzaType)} with ${order.toppings.length ? order.toppings.map(toppingName).join(', ') : 'tomato sauce only'}`;
}

export function orderResult(order: PizzaOrder) {
  return {
    ok: true, order, summary: describeOrder(order), demoOnly: true,
    menu: { pizzas: PIZZAS, toppings: TOPPINGS, note: 'Start with an empty plate. Choose a recipe before adding toppings or confirming. Every pizza has dough and tomato sauce. Selecting a recipe loads its listed toppings. No prices, payment, cooking, or delivery.' },
  };
}

/** Only the avatar's live browser tool calls change the displayed order. */
export function applyPizzaCommand(order: PizzaOrder, input: unknown) {
  const parsed = pizzaCommandSchema.safeParse(input);
  if (!parsed.success) return { ...orderResult(order), ok: false, error: 'invalid_order', message: 'Choose one of the two pizzas and only toppings from the menu.' };
  const command = parsed.data;
  if (command.action === 'read') return orderResult(order);
  if (command.expectedRevision !== order.revision) {
    return { ...orderResult(order), ok: false, error: 'order_changed', message: 'The pizza changed. Read this current order and reapply only the requested change; get confirmation again if needed.' };
  }
  if (order.pizzaType === null && (command.action === 'set_topping' || command.action === 'confirm')) {
    return { ...orderResult(order), ok: false, error: 'base_required', message: 'Choose Margherita or Pepperoni before adding toppings or confirming. Do not select a recipe for the visitor.' };
  }
  if (command.action === 'confirm') {
    if (order.status === 'confirmed') return orderResult(order);
    return orderResult({ ...order, status: 'confirmed', revision: order.revision + 1 });
  }
  // Incremental client tools preserve everything the visitor has already chosen.
  // Only an explicit base choice resets the recipe to its default toppings.
  const pizzaType = command.action === 'set_topping' ? order.pizzaType : command.pizzaType;
  const requested = command.action === 'select_base'
    ? PIZZAS.find(p => p.id === command.pizzaType)!.toppings
    : command.action === 'set_topping'
      ? command.selected ? [...order.toppings, command.topping] : order.toppings.filter(t => t !== command.topping)
      : command.toppings;
  const toppings = TOPPINGS.filter(t => requested.includes(t.id)).map(t => t.id);
  if (pizzaType === order.pizzaType && toppings.join() === order.toppings.join()) return orderResult(order);
  return orderResult({ pizzaType, toppings, status: 'building', revision: order.revision + 1 });
}

export const PIZZA_RPC_METHOD = 'pizza.order';
export const PIZZA_TOOLS_VERSION = 'pizza-tools-v3';
