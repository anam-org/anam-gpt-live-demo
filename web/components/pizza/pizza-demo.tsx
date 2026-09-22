'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneIcon } from '@phosphor-icons/react';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PizzaScene } from './pizza-scene';
import { usePizzaCall } from '@/hooks/use-pizza-call';
import { applyPizzaCommand, describeOrder, initialOrder, PIZZAS, pizzaName, TOPPINGS } from '@/lib/pizza';

export function PizzaDemo() {
  const [order, setOrder] = useState(initialOrder);
  const orderRef = useRef(order);
  const [notice, setNotice] = useState('Tell the avatar what you’d like on your pizza.');
  const execute = useCallback((input: unknown) => {
    const result = applyPizzaCommand(orderRef.current, input);
    if (result.ok && result.order !== orderRef.current) {
      orderRef.current = result.order;
      setOrder(result.order);
      setNotice(result.order.status === 'confirmed' ? 'Demo order confirmed. The pizza is virtual. The attitude is included.' : 'Your pizza has been updated.');
    }
    return result;
  }, []);
  const { phase, syncOrder, muted, hasVideo, video, audio, error, needsAudio, enableAudio, start, toggleMic, stop } = usePizzaCall(execute);
  useEffect(() => { if (phase === 'connected') syncOrder(order); }, [order, phase, syncOrder]);
  const status = phase === 'idle' ? '' : phase === 'connecting' ? 'Connecting…' : phase === 'reconnecting' ? 'Reconnecting…' : muted ? 'Your microphone is muted' : 'Listening…';

  return <main className="pizza-site">
    <header className="pizza-header">
      <a className="pizza-brand" href="https://anam.ai" aria-label="Anam home"><span className="pizza-brand-name">Anam</span><span className="pizza-brand-divider" /><span>GPT Live 1</span></a>
    </header>

    <section className="pizza-intro" aria-labelledby="pizza-title">
      <h1 id="pizza-title">Let’s make pizza.</h1>
      <p>Tell our least enthusiastic employee what you want.<br className="pizza-desktop-break" /> Watch your pizza come together as you talk.</p>
    </section>

    <div className="pizza-workspace">
      <section className="pizza-counter" aria-labelledby="counter-title">
        <div className="pizza-panel-heading"><h2 id="counter-title">Anam Pizza Counter</h2><span>AI avatar</span></div>
        <div className="pizza-avatar-frame" role="group" aria-label="Pizza avatar">
          <div className={hasVideo ? 'pizza-avatar-placeholder is-hidden' : 'pizza-avatar-placeholder'} aria-hidden={hasVideo}>
            <span>Your avatar will appear here</span>
            <p>Start a call to place a demo order.</p>
          </div>
          <video ref={video} width="1152" height="768" autoPlay playsInline muted className={hasVideo ? 'pizza-avatar-video is-visible' : 'pizza-avatar-video'} aria-hidden={!hasVideo} aria-label="Live pizza character" />
        </div>
        <div className="pizza-call-area">
          <p className={`pizza-call-status${status ? '' : ' pizza-sr-only'}`} role="status">{status}</p>
          {error && <p className="pizza-call-error" role="alert">{error}</p>}
          {needsAudio && <Button className="anam-pill" variant="secondary" onClick={enableAudio}>Enable sound</Button>}
          {phase === 'idle' ? (
            <button className="pizza-start-call" type="button" onClick={() => void start()}>
              <PhoneIcon weight="regular" size={20} aria-hidden="true" />
              Start Call
            </button>
          ) : (
            <div className="pizza-call-buttons">
              <button
                className="pizza-call-control"
                type="button"
                onClick={() => void toggleMic()}
                disabled={phase === 'connecting'}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                aria-pressed={muted}
              >
                {muted ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
              </button>
              <button className="pizza-call-control pizza-end-call" type="button" onClick={() => void stop()}>
                <PhoneOff size={16} aria-hidden="true" />
                {phase === 'connecting' ? 'Cancel' : 'End call'}
              </button>
            </div>
          )}
        </div>
        <div className="pizza-conversation-hint"><p>Give it a try</p><blockquote>“Pepperoni with mushrooms.<br /> Actually, add pineapple. Don’t judge me.”</blockquote></div>
      </section>

      <section className="pizza-builder" aria-labelledby="builder-title">
        <div className="pizza-panel-heading"><h2 id="builder-title">Your masterpiece</h2><span>{order.status === 'confirmed' ? 'Demo order confirmed' : 'Made your way'}</span></div>
        <PizzaScene pizzaType={order.pizzaType} toppings={order.toppings} />
        <div className="pizza-menu">
          <p className="pizza-voice-note">Order by voice. This menu is just here for reference.</p>
          <div className="pizza-menu-label"><h3>01 <span>Tell us your starting point</span></h3><span>Two classic recipes</span></div>
          <ul className="pizza-recipes" aria-label="Available pizza recipes, reference only">
            {PIZZAS.map(pizza => <li key={pizza.id} className={`pizza-recipe ${order.pizzaType === pizza.id ? 'is-selected' : ''}`}><strong>{pizza.name}</strong><p>{pizza.description}</p>{order.pizzaType === pizza.id && <span className="pizza-selection-note">Current recipe</span>}</li>)}
          </ul>
          <div className="pizza-menu-label pizza-topping-heading"><h3>02 <span>Say what goes on it</span></h3><span>{order.toppings.length} of 10 toppings</span></div>
          <ul className="pizza-toppings" aria-label="Available toppings, reference only">
            {TOPPINGS.map(topping => <li key={topping.id} className={`pizza-topping ${order.toppings.includes(topping.id) ? 'is-selected' : ''}`}><span>{topping.name}</span>{order.toppings.includes(topping.id) && <span className="pizza-selection-note">On your pizza</span>}</li>)}
          </ul>
          <div className="pizza-order-summary">
            <div><span className="pizza-small">{order.status === 'confirmed' ? 'Your demo order' : 'On your pizza'}</span><h3>{order.pizzaType ? pizzaName(order.pizzaType) : 'Your pizza starts here'}</h3><p>{order.pizzaType === null ? 'No base or toppings selected yet.' : order.toppings.length ? TOPPINGS.filter(t => order.toppings.includes(t.id)).map(t => t.name).join(' · ') : 'Tomato sauce only'}</p></div>
            <p className="pizza-confirm-hint">{order.pizzaType === null ? 'Tell the avatar which recipe you’d like.' : order.status === 'confirmed' ? 'Demo order confirmed by voice.' : 'All done? Ask the avatar to confirm your order.'}</p>
          </div>
          <p className="pizza-order-notice" role="status" aria-live="polite">{notice}</p>
          <p className="pizza-sr-only" aria-live="polite">{describeOrder(order)}</p>
        </div>
      </section>
    </div>
    <footer className="pizza-footer"><p>A demo by Anam × GPT Live 1.</p><a href="https://anam.ai">Build your own with Anam</a></footer>
    <div ref={audio} className="audio-tracks" />
  </main>;
}
