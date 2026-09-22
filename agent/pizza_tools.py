"""GPT Live backend tools that execute against the caller's browser over LiveKit RPC."""

import asyncio
import json
from typing import Literal

from livekit import rtc
from livekit.agents import function_tool

PizzaType = Literal['margherita', 'pepperoni']
Topping = Literal['mozzarella', 'pepperoni', 'mushrooms', 'red_onion', 'bell_pepper',
                  'olives', 'jalapenos', 'pineapple', 'basil', 'sweetcorn']
TOPPING_IDS = {'mozzarella', 'pepperoni', 'mushrooms', 'red_onion', 'bell_pepper',
               'olives', 'jalapenos', 'pineapple', 'basil', 'sweetcorn'}
# V3 browsers start empty and can return pizzaType=None before a recipe is selected.
TOOLS_VERSION = 'pizza-tools-v3'


def pizza_dispatch(metadata: str) -> str | None:
    """Only explicit server dispatch metadata selects this experience."""
    try:
        payload = json.loads(metadata or '{}')
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get('demo') != 'pizza':
        return None
    identity = payload.get('participant_identity')
    if not isinstance(identity, str) or not identity.startswith('guest-'):
        raise ValueError('Pizza dispatch requires its browser participant identity')
    return identity


def validate_order(value: object) -> dict:
    """Accept only structured order data; never inject arbitrary browser text into prompts."""
    if not isinstance(value, dict):
        raise ValueError('Invalid browser order')
    pizza_type, toppings = value.get('pizzaType'), value.get('toppings')
    revision, status = value.get('revision'), value.get('status')
    if (pizza_type not in (None, 'margherita', 'pepperoni') or 'pizzaType' not in value or
            not isinstance(toppings, list) or len(toppings) > 10 or
            any(not isinstance(t, str) or t not in TOPPING_IDS for t in toppings) or
            len(set(toppings)) != len(toppings) or
            type(revision) is not int or revision < 0 or
            status not in ('building', 'confirmed') or
            (pizza_type is None and (toppings or status != 'building'))):
        raise ValueError('Invalid browser order')
    return {'pizzaType': pizza_type, 'toppings': toppings, 'revision': revision, 'status': status}


class PizzaTools:
    def __init__(self, room: rtc.Room, participant_identity: str):
        self.room = room
        self.participant_identity = participant_identity
        self._lock = asyncio.Lock()
        self.functions = [self.get_pizza_order, self.select_pizza_base,
                          self.set_pizza_topping, self.confirm_pizza_order]

    async def _call(self, command: dict) -> dict:
        async with self._lock:
            try:
                # Only delegated backend work awaits this I/O. GPT Live's voice stream
                # remains independent; never return success before browser acceptance.
                result = await self.room.local_participant.perform_rpc(
                    destination_identity=self.participant_identity,
                    method='pizza.order', payload=json.dumps(command), response_timeout=8.0,
                )
                response = json.loads(result)
                order = validate_order(response.get('order'))
                if response.get('ok') is not True:
                    error = response.get('error')
                    return {'ok': False, 'error': error if error in ('order_changed', 'invalid_order', 'base_required') else 'browser_error', 'order': order}
                # The frontend menu is fixed; only validated structured state is returned to the model.
                return {'ok': True, 'order': order, 'demoOnly': True}
            except (rtc.RpcError, ValueError, TypeError, AttributeError, TimeoutError):
                # Delivery can be ambiguous on timeout. Never blindly retry a mutation.
                return {'ok': False, 'error': 'browser_unavailable',
                        'message': 'The browser did not confirm this action. Do not claim success. Read the current order before retrying, or ask the visitor to restart the call. There is no manual ordering.'}

    @function_tool
    async def get_pizza_order(self) -> dict:
        """Read the browser's current pizza, complete topping selection, status, and revision.

        Call before changes and summaries to preserve the latest voice-requested order.
        pizzaType=None with no toppings means the visitor has not selected a recipe yet.
        """
        return await self._call({'action': 'read'})

    @function_tool
    async def select_pizza_base(self, pizza_type: PizzaType, expected_revision: int) -> dict:
        """Show a recipe as soon as the visitor explicitly chooses or switches to it.

        Loads that recipe's default toppings, replacing the previous selection. Do not
        call for a topping-only request or repeat a base selection from earlier context:
        that would reset customizations. Apply any newly requested toppings afterward.

        Args:
            pizza_type: Recipe name: margherita or pepperoni.
            expected_revision: Latest browser revision from a read or successful tool result.

        Returns browser-acknowledged state. This only changes a pretend order preview.
        """
        return await self._call({'action': 'select_base', 'pizzaType': pizza_type,
                                 'expectedRevision': expected_revision})

    @function_tool
    async def set_pizza_topping(self, topping: Topping, selected: bool, expected_revision: int) -> dict:
        """Add or remove one topping as soon as that choice is clear; keep all other items.

        Do not wait for the whole order. This sets presence, rather than toggling it, so
        repeated additions cannot remove a topping. Call sequentially for multiple items,
        using the returned revision for the next edit. Corrections use selected=False
        to remove an unwanted topping and selected=True to add its replacement.
        If no recipe has been selected, ask for one first; never assume a base.

        Args:
            topping: Exact supported topping ID, including mozzarella for cheese.
            selected: True to include the topping; False to remove it.
            expected_revision: Latest browser revision from a read or successful tool result.

        Returns browser-acknowledged state; actual edits reopen confirmed demo orders.
        """
        return await self._call({'action': 'set_topping', 'topping': topping,
                                 'selected': selected, 'expectedRevision': expected_revision})

    @function_tool
    async def confirm_pizza_order(self, expected_revision: int) -> dict:
        """Mark the displayed demo order confirmed after the visitor approves its summary.

        Args:
            expected_revision: Revision of the exact order summarized to and approved by
                the visitor. Never confirm a different revision without fresh approval.

        This only changes the browser's demo status. No real order is placed.
        """
        return await self._call({'action': 'confirm', 'expectedRevision': expected_revision})
