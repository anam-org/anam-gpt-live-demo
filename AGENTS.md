# Working on the demos

## Project layout and configuration

- `agent/` is the Python LiveKit agent; `web/` is the Next.js app and Vercel root. The optional `node web/scripts/export-node.mjs` makes an ignored `web-node/` copy.
- Follow the README for setup. Run locally with `lk --project <your-project> agent dev` from `agent/`.
- Keep credentials, local LiveKit config, session logs, recordings and investigation notes out of Git. Never put provider secrets in browser code or `NEXT_PUBLIC_` variables.
- Use your own LiveKit project. Explicitly target `--deployment hana-gpt-live` when deploying; numbered `hana-gpt-live-pr-<number>` names are also accepted. Never omit the flag or promote this demo to production.
- CI tests and builds only. No deployment or credentials should be needed to check a contribution.

## Prompts and pizza tools

- `agent/agent.py` owns the prompts, voices and model settings. Keep `system-prompt.txt` in sync with `INSTRUCTIONS`, and `pizza-system-prompt.txt` with `PIZZA_INSTRUCTIONS`. Tool instructions live in `PIZZA_BACKEND_INSTRUCTIONS`.
- Avatar IDs come from `ANAM_AVATAR_ID` and `ANAM_PIZZA_AVATAR_ID`. Hana uses `ANAM_API_KEY`; pizza uses `ANAM_PIZZA_API_KEY`. Missing pizza settings must fail rather than fall back to Hana's values.
- Pizza ordering is voice-only. Keep the menu read-only and a fresh order empty until a recipe is chosen. Confirmations are demo state, never real orders.
- Browser state is authoritative. Bind tools to the dispatched guest, validate replies and apply edits sequentially with revision checks. Preserve unrelated toppings. Confirm only the revision the visitor approved; read state before retrying an uncertain result.
- Keep `pizza-tools-v3` and menu definitions consistent across Python, TypeScript and the prompts. Protocol changes require compatible website and agent versions.

## Audio and video

- Start Anam before the agent session so all speech reaches the avatar. Keep one browser audio playback path, the full 3:2 video frame and native AI-avatar disclosure.
- The default conditioner collects 1,000 ms of source audio per speech segment, or releases a completed shorter segment early, then stretches audio by 10% at the original sample rate. This lowers pitch and adds playback time, including pauses.
- Local Silero VAD confirms 180 ms of speech before clearing buffered speech and avatar playback. GPT Live controls conversational turns. Brief acknowledgments can trigger this detector; it does not infer intent.
- Dynamic facial cues are not wired. Voice emotion does not imply explicit facial-cue control.
- Measure audio changes at browser playback with the same input and settings for each comparison. Keep the server-only diagnostic profiles out of the public session API. Small sequential samples do not establish latency guarantees.

## Validation

- From `agent/`, run `uv run python -m unittest discover -s . -p 'test_*.py' -v`.
- From `web/`, run `npm run test:pizza`, `npm run test:session` and `npm run build`.
- New agent modules must appear in both the Dockerfile's `COPY` list and `.dockerignore` allowlist.
- For live checks, test both routes, microphone permission, interruptions and room cleanup. On pizza, test incremental edits, corrections, a recipe switch, readback, confirmation and an edit after confirmation. Unit tests do not verify model behavior during a real call.
