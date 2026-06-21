import { createLocalLlmClient } from '../client.js';
import { AgentHarness } from '../agent.js';
import { tools } from '../tools.js';
import { SYSTEM_PROMPT } from '../prompts.js';

const client = createLocalLlmClient();

const agent = new AgentHarness({
  client,
  tools,
  systemPrompt: SYSTEM_PROMPT
});

async function run(): Promise<void> {
  const input = `You have access to the following tools: read, bash, write, edit.

Please perform these steps using the exact tool call syntax:

1. Read the first 20 lines of src/tools.ts using the read tool.
2. Run a bash command that prints the current Node version.
3. Write a temporary file named tmp-tool-demo.txt with the text: "This file was created by the agent tool demo.".
4. Edit that file by replacing "tool demo" with "tool demonstration".

Return the final tool results and a short summary of what was done.`;

  const response = await agent.run(input);

  console.log('Response type:', response.type);
  console.log('Output:', response.text);

  if (response.type === 'tool_response') {
    console.log('Tool used:', response.tool);
    console.log('Tool args:', response.toolArgs);
    console.log('Tool result:', response.toolResult);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
