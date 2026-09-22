# Demo website

This Next.js app serves Grumpy Pizza at `/pizza` and Hana at `/`.

Follow the [repository setup guide](../README.md) to configure and start the agent. From this directory:

```bash
cp .env.example .env.local
# Fill in the same LiveKit project credentials as the agent.
npm ci
npm run dev
```

Open `http://localhost:3000/pizza`. All environment settings are server-side. OpenAI and Anam keys belong only on the Python agent.

Use `npm run build` and `npm start` for a Node.js deployment, or set Vercel's Root Directory to `web` with the Next.js preset. Hosted microphone access requires HTTPS.

Run `npm run test:pizza` and `npm run test:session` here. Pizza tests also read the sibling Python sources, so run them in the original repository rather than an exported website copy.
