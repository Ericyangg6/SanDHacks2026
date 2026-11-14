import { Agent } from '@mastra/core/agent';
import { TEXT_AGENT_INSTRUCTIONS } from '../agent/instructions';
import { env } from '../env';
import { findSitesTool } from './find-sites-tool';

// Answers SMS replies. It has no Mastra memory: history lives in our messages table and ../agent/reply.ts
// passes it in on each run. It has no workspace, file or shell tools, because it answers texts from the public.
// Registered in src/mastra/index.ts as agents: { agent, textAgent }.
export const textAgent = new Agent({
  id: 'text-agent',
  name: 'Shade Text Agent',
  description: 'Answers SMS replies to Shade alerts and finds open cooling and clean-air sites.',
  instructions: TEXT_AGENT_INSTRUCTIONS,
  // Resolved on each run, so nothing about the model is read at import time.
  model: () => env.textAgentModel(),
  // The object key, not the tool id, is the name the model sees and the toolName in results. Keep them equal.
  tools: { find_sites: findSitesTool },
});
