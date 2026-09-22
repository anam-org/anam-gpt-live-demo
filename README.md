# Anam + GPT Live demos

Give GPT Live a face with Anam and LiveKit. This repo includes two browser demos:

- **Grumpy Pizza** at `/pizza`: build a pretend pizza by talking to a sarcastic avatar. Choose a recipe, add or remove toppings, and watch each accepted change appear in 3D. The menu is read-only; no payment or real order is placed.
- **Hana** at `/`: have an open-ended conversation with an AI host. Try interrupting, asking her to whisper, or asking about Anam.

Both use one Python agent and one Next.js website. GPT Live handles speech, a Responses backend handles reasoning and tools, and Anam publishes the avatar's audio and video into the LiveKit room. Your browser publishes microphone audio; it never receives your API secrets.

If you came from the GPT Live avatar tutorial, this is the complete application behind the pizza demo. Use this repo's browser pages to test ordering: the pizza tools need the browser's order state and won't work in the generic LiveKit Agent Console.

## Prerequisites

- Python **3.12+**, [uv](https://docs.astral.sh/uv/getting-started/installation/), Node.js **22.13+**, and npm.
- The latest [LiveKit CLI](https://docs.livekit.io/reference/developer-tools/livekit-cli/) and your own [LiveKit Cloud project](https://cloud.livekit.io/).
- An OpenAI API key with access to `gpt-live-1` and `gpt-5.6-luna`. Both models are required by the current configuration.
- An [Anam account](https://lab.anam.ai/register), API key, and Cara 4 avatar IDs available to that account. You can use one avatar for both demos while testing, or choose separate characters.
- A browser and microphone. Hosted microphone access requires HTTPS; localhost works for development.

Calls use your provider accounts and can incur charges. Use a separate development LiveKit project when trying the demos.

## 1. Clone and configure

```bash
git clone https://github.com/anam-org/anam-gpt-live-demo.git
cd anam-gpt-live-demo
cp agent/.env.example agent/.env.local
cp web/.env.example web/.env.local
```

Fill in the two local files:

| Variable | Agent | Website |
| --- | --- | --- |
| `LIVEKIT_URL` | Your project's WebSocket URL | Same value |
| `LIVEKIT_API_KEY` | Your project's API key | Same value |
| `LIVEKIT_API_SECRET` | The matching secret | Same value |
| `LIVEKIT_AGENT_DEPLOYMENT` | Keep `hana-gpt-live` | Same value |
| `OPENAI_API_KEY` | Your OpenAI key | — |
| `ANAM_API_KEY` | Your Anam key for Hana | — |
| `ANAM_AVATAR_ID` | Your Hana avatar ID | — |
| `ANAM_PIZZA_API_KEY` | Your Anam key for pizza | — |
| `ANAM_PIZZA_AVATAR_ID` | Your pizza avatar ID | — |

Set the pizza values explicitly. They can use the same key and avatar as Hana, but the agent won't fall back to Hana's settings if they are missing. To try only one demo, you can leave the other demo's Anam settings unconfigured.

No avatar images, preview videos or speech recordings are bundled. The pages show a placeholder until the live avatar connects. Your avatar comes from the ID you supply; the pizza itself is rendered in code.

Local env files are ignored by Git. Keep all keys server-side; never add a `NEXT_PUBLIC_` prefix to a secret.

## 2. Start the Python agent

Install the LiveKit CLI using the guide above. On macOS, use `brew install livekit-cli`; update an existing installation with `brew update && brew upgrade livekit-cli`.

Link your development project and find its CLI name:

```bash
lk cloud auth
lk project list
```

From the repository root, install dependencies and start the agent. Replace `my-demo` with your CLI project name:

```bash
cd agent
uv sync --locked
uv run python -m livekit.agents download-files
lk --project my-demo agent dev
```

Leave this terminal running. The CLI detects `agent.py` and reloads it when code changes. It supplies the selected project's LiveKit credentials; the agent loads the remaining settings from `.env.local`. Use that same project in the website's environment file.

The worker registers as `cara` in the `hana-gpt-live` deployment. Those are routing names used by both sides of this app. You don't need a deployed Cloud agent or a `livekit.toml` file for this local setup.

## 3. Start the website

In a second terminal, from the repository root:

```bash
cd web
npm ci
npm run dev
```

Open [Grumpy Pizza](http://localhost:3000/pizza), start a call and allow microphone access. Try:

1. "Pepperoni."
2. "Add pineapple."
3. "Actually, mushrooms instead of pineapple."
4. Ask for the order summary, then confirm it.

Each accepted change should appear on the pizza. An edit after confirmation reopens the order. Refreshing the page clears it.

End the call, then try [Hana](http://localhost:3000). Calls end automatically after 15 minutes.

## Customize the demos

| File | What to change |
| --- | --- |
| `agent/.env.local` | Credentials and avatar IDs |
| [agent/agent.py](agent/agent.py) | Voice, model settings, character prompts and backend instructions |
| [agent/pizza_tools.py](agent/pizza_tools.py) | Agent tools and validated browser responses |
| [web/lib/pizza.ts](web/lib/pizza.ts) | Menu, order state and browser commands |
| [web/components/pizza/](web/components/pizza/) | Pizza UI and 3D scene |

Hana uses Willow; pizza uses Beacon. Keep `system-prompt.txt` and `pizza-system-prompt.txt` in sync when editing their prompts in Python. Menu or tool-protocol changes need matching agent and website updates.

These demos add audio conditioning and interruption handling beyond the tutorial's minimal example. The agent buffers up to one second of source audio per speech segment and slows playback by 10%, which also lowers pitch. Local speech detection clears queued playback during interruptions; a brief acknowledgment can trigger it too. Dynamic facial cues are not wired. See [AGENTS.md](AGENTS.md) for maintenance details.

## Hosting

The agent and website run separately. This repo's GitHub Actions workflow runs tests and builds only; it does not deploy or need provider credentials.

For the agent, follow [LiveKit's Cloud deployment guide](https://docs.livekit.io/deploy/agents/) using your own project and a named `hana-gpt-live` deployment. This requires a plan with [non-production deployments](https://docs.livekit.io/deploy/agents/deployments/). Once you have registered your own agent, copy `agent/livekit.toml.example` to `agent/livekit.toml` and enter its project subdomain and agent ID. Keep that local config out of Git.

Put `OPENAI_API_KEY`, both Anam keys and both avatar IDs in the agent's LiveKit secret store. LiveKit supplies its own credentials and deployment name. From the repository root, subsequent deployments use:

```bash
lk --project my-demo agent deploy agent --deployment hana-gpt-live
```

Always include the deployment flag. This demo rejects the production deployment. Stop a local worker before testing a Cloud worker on the same project and deployment.

For Vercel, import your repository, set **Root Directory** to `web`, choose Next.js, and add the four website environment variables from the table above. Keep the default output directory. Deploy and test both routes over HTTPS. For another Node.js host, run `npm ci`, `npm run build` and `npm start` from `web/` behind HTTPS.

The session endpoint has origin checks but no login, rate limit or usage quota. Add access controls and spending limits before opening your hosted copy to unrestricted traffic.

## Checks and troubleshooting

```bash
# From agent/
uv run python -m unittest discover -s . -p 'test_*.py' -v

# From web/
npm run test:pizza
npm run test:session
npm run build
```

- **Agent doesn't join:** check the CLI project matches the website's credentials, and both use `LIVEKIT_AGENT_DEPLOYMENT=hana-gpt-live`.
- **Avatar or speech fails:** check the agent logs, model access, Anam keys and avatar IDs. Missing pizza settings do not fall back to Hana.
- **Microphone unavailable:** allow browser access and use localhost or HTTPS.
- **Pizza compatibility error:** update the website and agent together, then reload the page.
- **Slow first hosted call:** named Cloud deployments sleep when idle and need time to start again.

The [LiveKit GPT Live guide](https://docs.livekit.io/agents/models/realtime/plugins/gpt-live/) and [Anam LiveKit quickstart](https://anam.ai/docs/integrations/livekit/quickstart) cover the underlying integrations.
