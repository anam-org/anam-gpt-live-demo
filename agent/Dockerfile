FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev
COPY agent.py audio_conditioning.py pizza_tools.py ./
RUN useradd --create-home --uid 10001 agent && chown -R agent:agent /app
USER agent
CMD ["uv", "run", "--no-sync", "agent.py", "start"]
