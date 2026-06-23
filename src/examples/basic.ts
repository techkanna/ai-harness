import { createLocalLlmClient } from '../client.js';
import { AgentHarness } from '../agent.js';

const client = createLocalLlmClient({
  requestPath: '/v1/chat/completions'
});

const agent = new AgentHarness({
  client,
  systemPrompt: 'You are a friendly and concise assistant that answers user questions.'
});

async function run(): Promise<void> {
  const input = 'Explain the difference between an agent and a normal chat completion.';
  const result = await agent.run(input);
  console.log('Result type:', result.type);
  console.log('Iterations:', result.iterationCount);
  console.log('Response:');
  console.log(result.text);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
