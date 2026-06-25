import { createLocalLlmClient } from '../llm/client.js';
import { AgentHarness } from '../agents/agent-harness.js';
import { tools } from '../tools/index.js';
import { SYSTEM_PROMPT } from '../prompts/system.js';

const client = createLocalLlmClient();

const agent = new AgentHarness({
  client,
  tools,
  systemPrompt: SYSTEM_PROMPT,
  maxIterations: 25,
  maxContextMessages: 50,
  logLevel: 'silent',
});

async function run(): Promise<void> {
  const input = `
Do the following tasks in order, using the appropriate tools:

1. Read the first 20 lines of src/tools/implementations.ts using the read tool.
2. Run a bash command that prints the current Node version.
3. Write a temporary file named tmp-tool-demo.txt with the text: "This file was created by the agent tool demo.".
4. Edit that file by replacing "tool demo" with "tool demonstration".
`;

  const controller = new AbortController();

  // Abort after 15 minutes if still running
  const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000);

  try {
    const result = await agent.run(input, { signal: controller.signal });
    console.log('\n--- Final Answer ---');
    console.log(JSON.stringify(result));
  } finally {
    clearTimeout(timeout);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
