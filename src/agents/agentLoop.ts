import Anthropic from '@anthropic-ai/sdk';
import { log } from '../utils/logger';
import { ToolInput, SearchInput, FetchInput } from '../types';
import { webSearch } from '../tools/webSearch';
import { webFetch } from '../tools/webFetch';

export type ToolExecutor = (input: ToolInput) => Promise<string>;

export interface AgentLoopOptions {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  userMessage: string;
  tools: Anthropic.Tool[];
  toolExecutors: Record<string, ToolExecutor>;
  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 25;

export async function runAgentLoop(options: AgentLoopOptions): Promise<string> {
  const {
    client,
    model,
    systemPrompt,
    userMessage,
    tools,
    toolExecutors,
    maxIterations = DEFAULT_MAX_ITERATIONS,
  } = options;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;
    log(`Agent loop iteration ${iterations}/${maxIterations}`);

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools,
      messages,
    });

    log(`Stop reason: ${response.stop_reason}`);

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        return textBlock.text;
      }
      return '';
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        log(`Executing tool: ${block.name} with input: ${JSON.stringify(block.input)}`);

        const executor = toolExecutors[block.name];
        let resultContent: string;

        if (!executor) {
          resultContent = `Error: Unknown tool "${block.name}"`;
        } else {
          try {
            resultContent = await executor(block.input as ToolInput);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            resultContent = `Tool error: ${msg}`;
            log(`Tool "${block.name}" failed: ${msg}`);
          }
        }

        log(`Tool result (truncated): ${resultContent.slice(0, 200)}...`);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultContent,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    log(`Unexpected stop_reason: ${response.stop_reason}. Ending loop.`);
    break;
  }

  throw new Error(`Agent loop exceeded ${maxIterations} iterations without completing.`);
}

export const STANDARD_TOOLS: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description:
      'Search the web for job listings and information. Returns a list of results with title, URL, and snippet.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute',
        },
        num_results: {
          type: 'number',
          description: 'Number of results to return (default: 10, max: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description:
      'Fetch and read the text content of a web page. Use this to read full job descriptions after finding URLs via web_search.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
      },
      required: ['url'],
    },
  },
];

export const STANDARD_EXECUTORS: Record<string, ToolExecutor> = {
  web_search: async (input: ToolInput) => {
    const { query, num_results } = input as SearchInput;
    return webSearch(query, num_results);
  },
  web_fetch: async (input: ToolInput) => {
    const { url } = input as FetchInput;
    return webFetch(url);
  },
};
