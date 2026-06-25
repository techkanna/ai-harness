import { createLocalLlmClient } from '../llm/client.js';

const client = createLocalLlmClient();

async function run(): Promise<void> {
  const input = 'how can you calculate 1 + 3?';
  const output = { thinking: '', content: '' };
  await client.streamChat([
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: input }
  ], {}, (delta) => {
    if (delta.startsWith('<|reasoning|>')) {
      const reasoning = delta.slice('<|reasoning|>'.length);
      output.thinking += reasoning;
    } else {
      output.content += delta;
    }
  });
  console.log(output);

  const result = await client.completion(input);
  console.log('Result:', JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
