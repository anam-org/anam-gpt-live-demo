import type { Metadata } from 'next';
import { PizzaDemo } from '@/components/pizza/pizza-demo';
import './pizza.css';

export const metadata: Metadata = {
  title: 'Anam Pizza Counter — Anam × GPT Live 1',
  description: 'Build your favorite pizza with a grumpy AI avatar. A live, interactive Anam and GPT Live 1 demo.',
};

export default function PizzaPage() { return <PizzaDemo />; }
