import { createLocalLlmClient } from '../client.js';
import { AgentHarness } from '../agent/index.js';
import { tools } from '../tools.js';
import { SYSTEM_PROMPT } from '../prompts.js';

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

1. Read the first 20 lines of src/tools.ts using the read tool.
2. Run a bash command that prints the current Node version.
3. Write a temporary file named tmp-tool-demo.txt with the text: "This file was created by the agent tool demo.".
4. Edit that file by replacing "tool demo" with "tool demonstration".
`;

  const controller = new AbortController();

  // Example: abort after 15 minutes if still running
  const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000);

  try {
    const result = await agent.run(input, { signal: controller.signal });

    // console.log('\n=== Agent Result ===');
    // console.log('Type:', result.type);
    // console.log('Iterations:', result.iterationCount);
    // console.log('Steps:', result.steps.length);
    console.log('\n--- Final Answer ---');
    // console.log(result.text);
    console.log(JSON.stringify(result));

    // if (result.steps.length > 0) {
    //   console.log('\n--- Execution Trace ---');
    //   for (const step of result.steps) {
    //     const argsStr = JSON.stringify(step.toolArgs);
    //     console.log(`  [${step.iteration}] ${step.toolName}(${argsStr.slice(0, 80)}${argsStr.length > 80 ? '...' : ''})`);
    //     console.log(`       → ${step.toolResult.slice(0, 120)}${step.toolResult.length > 120 ? '...' : ''}`);
    //   }
    // }
  } finally {
    clearTimeout(timeout);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
