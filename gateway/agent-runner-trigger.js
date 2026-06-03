import { runAgentTask } from './agent.js';

const prompt = process.argv.slice(2).join(' ');
if (prompt) {
  runAgentTask(prompt);
} else {
  console.log('Usage: node agent-runner-trigger.js "your prompt here"');
}
