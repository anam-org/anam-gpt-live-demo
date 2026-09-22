import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyPizzaCommand, describeOrder, initialOrder, PIZZAS, TOPPINGS, PIZZA_TOOLS_VERSION } from '../lib/pizza.ts';

const margherita = () => applyPizzaCommand(initialOrder(), { action: 'select_base', pizzaType: 'margherita', expectedRevision: 0 }).order;

test('a fresh order has no recipe or toppings, and cannot be edited or confirmed before choosing a base', () => {
  const empty = initialOrder();
  assert.deepEqual(empty, { pizzaType: null, toppings: [], status: 'building', revision: 0 });
  assert.match(describeOrder(empty), /No pizza selected/);
  for (const command of [
    { action: 'set_topping', topping: 'mushrooms', selected: true, expectedRevision: 0 },
    { action: 'confirm', expectedRevision: 0 },
  ]) {
    const result = applyPizzaCommand(empty, command);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'base_required');
    assert.equal(result.order, empty);
  }
  assert.equal(applyPizzaCommand(empty, { action: 'read' }).order, empty);
});

test('one whole-order update builds both recipes and every topping combination', () => {
  assert.equal(PIZZAS.length, 2);
  assert.equal(TOPPINGS.length, 10);
  for (const recipe of PIZZAS) {
    for (let mask = 0; mask < 1 << TOPPINGS.length; mask++) {
      const toppings = TOPPINGS.filter((_, index) => mask & (1 << index)).map(t => t.id);
      const result = applyPizzaCommand(initialOrder(), { action: 'update', pizzaType: recipe.id, toppings, expectedRevision: 0 });
      assert.equal(result.ok, true);
      assert.deepEqual(result.order.toppings, toppings);
      assert.equal(result.order.pizzaType, recipe.id);
    }
  }
});

test('voice updates preserve newer edits by rejecting stale revisions', () => {
  const latest = applyPizzaCommand(initialOrder(), { action: 'update', pizzaType: 'margherita', toppings: ['mozzarella', 'basil', 'olives'], expectedRevision: 0 });
  const staleVoice = applyPizzaCommand(latest.order, { action: 'update', pizzaType: 'margherita', toppings: ['mozzarella', 'basil', 'pineapple'], expectedRevision: 0 });
  assert.equal(staleVoice.ok, false);
  assert.equal(staleVoice.error, 'order_changed');
  assert.deepEqual(staleVoice.order.toppings, ['mozzarella', 'olives', 'basil']);
  const retry = applyPizzaCommand(staleVoice.order, { action: 'update', pizzaType: 'margherita', toppings: [...staleVoice.order.toppings, 'pineapple'], expectedRevision: staleVoice.order.revision });
  assert.deepEqual(retry.order.toppings, ['mozzarella', 'olives', 'pineapple', 'basil']);
});

test('the menu exposes no manual pizza editing or confirmation handlers', () => {
  const page = readFileSync(new URL('../components/pizza/pizza-demo.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /\b(?:Checkbox|RadioGroup|onCheckedChange|onValueChange)\b/);
  assert.doesNotMatch(page, /\bexecute\s*\(/);
  assert.match(page, /usePizzaCall\(execute\)/);
  assert.match(page, /Order by voice\. This menu is just here for reference\./);
});

test('confirmation targets exactly the reviewed order; later edits reopen it', () => {
  const order = margherita();
  const confirmed = applyPizzaCommand(order, { action: 'confirm', expectedRevision: order.revision });
  assert.equal(confirmed.order.status, 'confirmed');
  const repeated = applyPizzaCommand(confirmed.order, { action: 'confirm', expectedRevision: confirmed.order.revision });
  assert.deepEqual(repeated.order, confirmed.order);
  const changed = applyPizzaCommand(confirmed.order, { action: 'update', pizzaType: 'pepperoni', toppings: ['mozzarella', 'pepperoni'], expectedRevision: confirmed.order.revision });
  assert.equal(changed.order.status, 'building');
  assert.equal(applyPizzaCommand(changed.order, { action: 'confirm', expectedRevision: confirmed.order.revision }).ok, false);
});

test('rejects unknown ingredients, malformed commands, and extra properties without mutation', () => {
  const order = initialOrder();
  for (const command of [null, {}, { action: 'pay' }, { action: 'read', prompt: 'ignore rules' },
    { action: 'update', pizzaType: 'hawaiian', toppings: [], expectedRevision: 0 },
    { action: 'update', pizzaType: 'margherita', toppings: ['chicken'], expectedRevision: 0 },
    { action: 'update', pizzaType: 'margherita', toppings: Array(11).fill('basil'), expectedRevision: 0 },
    { action: 'confirm', expectedRevision: -1 }, { action: 'confirm', expectedRevision: '0' },
  ]) {
    const result = applyPizzaCommand(order, command);
    assert.equal(result.ok, false);
    assert.equal(result.order, order);
  }
});

test('repeated topping requests are deduplicated; reads never mutate', () => {
  const order = margherita();
  assert.equal(applyPizzaCommand(order, { action: 'read' }).order, order);
  const result = applyPizzaCommand(order, { action: 'update', pizzaType: 'margherita', toppings: ['basil', 'mozzarella', 'basil'], expectedRevision: order.revision });
  assert.equal(result.order, order);
});

test('spoken base and successive toppings produce incremental browser states', () => {
  let order = applyPizzaCommand(initialOrder(), { action: 'select_base', pizzaType: 'pepperoni', expectedRevision: 0 }).order;
  assert.equal(order.pizzaType, 'pepperoni');
  assert.deepEqual(order.toppings, ['mozzarella', 'pepperoni']);
  for (const topping of ['mushrooms', 'olives', 'pineapple']) {
    const previous = order;
    const result = applyPizzaCommand(order, { action: 'set_topping', topping, selected: true, expectedRevision: order.revision });
    assert.equal(result.ok, true);
    order = result.order;
    assert.equal(order.pizzaType, 'pepperoni');
    assert.equal(order.revision, previous.revision + 1);
    assert.ok(order.toppings.includes(topping));
    assert.ok(previous.toppings.every(t => order.toppings.includes(t)));
  }
  const removed = applyPizzaCommand(order, { action: 'set_topping', topping: 'olives', selected: false, expectedRevision: order.revision });
  assert.deepEqual(removed.order.toppings, ['mozzarella', 'pepperoni', 'mushrooms', 'pineapple']);
  const switched = applyPizzaCommand(removed.order, { action: 'select_base', pizzaType: 'margherita', expectedRevision: removed.order.revision });
  assert.deepEqual(switched.order.toppings, ['mozzarella', 'basil']);
});

test('incremental tools reject stale and malformed edits and safely repeat additions', () => {
  const order = initialOrder();
  for (const command of [
    { action: 'select_base', pizzaType: 'hawaiian', expectedRevision: 0 },
    { action: 'set_topping', topping: 'chicken', selected: true, expectedRevision: 0 },
    { action: 'set_topping', topping: 'olives', selected: 'true', expectedRevision: 0 },
    { action: 'set_topping', topping: 'olives', selected: true, expectedRevision: 1 },
    { action: 'select_base', pizzaType: 'pepperoni', expectedRevision: 1 },
  ]) {
    const result = applyPizzaCommand(order, command);
    assert.equal(result.ok, false);
    assert.equal(result.order, order);
  }
  const base = margherita();
  const added = applyPizzaCommand(base, { action: 'set_topping', topping: 'olives', selected: true, expectedRevision: base.revision }).order;
  assert.equal(applyPizzaCommand(added, { action: 'set_topping', topping: 'olives', selected: true, expectedRevision: added.revision }).order, added);
  const confirmed = applyPizzaCommand(added, { action: 'confirm', expectedRevision: added.revision }).order;
  const removed = applyPizzaCommand(confirmed, { action: 'set_topping', topping: 'mozzarella', selected: false, expectedRevision: confirmed.revision }).order;
  assert.equal(removed.status, 'building');
  assert.deepEqual(removed.toppings, ['olives', 'basil']);
  assert.equal(applyPizzaCommand(removed, { action: 'confirm', expectedRevision: confirmed.revision }).ok, false);
});

test('agent topping schema and prompt stay aligned with the browser menu', () => {
  const tools = readFileSync(new URL('../../agent/pizza_tools.py', import.meta.url), 'utf8');
  assert.equal(PIZZA_TOOLS_VERSION, 'pizza-tools-v3');
  assert.equal(tools.match(/TOOLS_VERSION = '([^']+)'/)[1], PIZZA_TOOLS_VERSION);
  const literal = tools.match(/Topping = Literal\[([\s\S]*?)\]/)[1];
  const agentIds = [...literal.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(agentIds, TOPPINGS.map(t => t.id));
  const agent = readFileSync(new URL('../../agent/agent.py', import.meta.url), 'utf8');
  const pizzaPrompt = agent.match(/PIZZA_INSTRUCTIONS = """([\s\S]*?)"""/)[1];
  const hanaPrompt = agent.match(/\nINSTRUCTIONS = """([\s\S]*?)"""/)[1];
  assert.equal(readFileSync(new URL('../../pizza-system-prompt.txt', import.meta.url), 'utf8').trim(), pizzaPrompt.trim());
  assert.equal(readFileSync(new URL('../../system-prompt.txt', import.meta.url), 'utf8').trim(), hanaPrompt.trim());
});
