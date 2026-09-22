import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Anam + GPT Live demos',
  description: 'Voice-controlled pizza ordering and avatar conversations with Anam, GPT Live and LiveKit.',
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
