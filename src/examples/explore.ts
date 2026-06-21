import { createLocalLlmClient } from '../client.js';

const client = createLocalLlmClient();


async function run(): Promise<void> {
  // const input = 'Explain the difference between an agent and a normal chat completion.';
  const input = 'how can you calculate 1 + 3?';
  let output = {thinking: '', content: ''};
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
