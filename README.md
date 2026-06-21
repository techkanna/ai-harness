# Explore Harness

A simple JavaScript agent harness for local models.

## What this includes

- `src/client.js` — a reusable local client for chat and completion requests.
- `src/agent.js` — a basic agent harness that can use tools and memory.
- `src/tools.js` — example tools for time lookup and simple math.
- `src/examples/basic.js` — simple prompt-to-response example.
- `src/examples/advanced.js` — tool-aware agent example.

## Prerequisites

- Node.js 18 or newer
- A local model endpoint running at `http://127.0.0.1:1234`
- A local LLM endpoint such as Qwen, Gemma, GPT-OSS, or another compatible server

## Run examples

- `npm run basic`
- `npm run advanced`

## Configure the model endpoint

The harness reads these environment variables by default:

- `MODEL_BASE_URL` — full local LLM HTTP endpoint, e.g. `http://127.0.0.1:1234`
- `MODEL_NAME` — the model identifier your server accepts, e.g. `local-llm`, `qwen/qwen3.6-35b-a3b`, or `google/gemma-4-e4b`

If your endpoint or model differs, set these values instead of editing source files.

## Learn the harness

- The client wraps API calls so you can swap endpoints or model settings easily.
- The agent harness adds memory, a system prompt, and tool integration.
- The advanced example shows how the model can return a tool call that the harness executes and then continues the conversation.
