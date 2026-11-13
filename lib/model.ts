// Claude over an OpenAI-compatible chat endpoint: Vercel AI Gateway by default.
import { z } from "zod";
import { attempt, type Json } from "./attempt.js";
import { env } from "./env.js";

export function modelConfig() {
  return {
    baseUrl: (env("MODEL_BASE_URL") ?? "https://ai-gateway.vercel.sh/v1").replace(/\/$/, ""),
    apiKey: env("MODEL_API_KEY") ?? env("AI_GATEWAY_API_KEY"),
    model: env("INTERPRET_MODEL") ?? "anthropic/claude-sonnet-5.5",
  };
}

const Completion = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        tool_calls: z.array(z.object({ function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
      }),
    }),
  ),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number(), cost: z.number().optional(), gateway_cost: z.number().optional() })
    .optional(),
});

export type ToolCallOptions = {
  kind: string;
  owner: string;
  system: string;
  /** Personal: goes only to interaction_private. */
  user: string;
  tool: { name: string; description: string; parameters: Record<string, unknown> };
  /** Public request fields for the interaction row. */
  request?: { [key: string]: Json };
  timeoutMs?: number;
};

/** One forced tool call; returns its parsed arguments and the interaction row. */
export async function callTool(options: ToolCallOptions): Promise<{ value: unknown; interaction: string }> {
  const config = modelConfig();
  const result = await attempt(
    {
      kind: options.kind,
      channel: "gateway",
      owner: options.owner,
      request: { public: { model: config.model, ...options.request }, private: { user: options.user } },
      timeoutMs: options.timeoutMs ?? 25_000,
    },
    [
      [
        "live",
        async (ctx) => {
          if (!config.apiKey) throw new Error("Set MODEL_API_KEY or AI_GATEWAY_API_KEY");
          const res = await fetch(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: config.model,
              max_tokens: 2000,
              temperature: 0,
              messages: [
                { role: "system", content: options.system },
                { role: "user", content: options.user },
              ],
              tools: [{ type: "function", function: options.tool }],
              tool_choice: { type: "function", function: { name: options.tool.name } },
            }),
            signal: ctx.signal,
          });
          if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 300)}`);
          const body = Completion.parse(await res.json());
          const cost = body.usage?.gateway_cost ?? body.usage?.cost;
          if (cost !== undefined) ctx.cost(cost);
          if (body.usage) ctx.note({ prompt_tokens: body.usage.prompt_tokens, completion_tokens: body.usage.completion_tokens });
          const call = body.choices[0]?.message.tool_calls?.find((c) => c.function.name === options.tool.name);
          if (!call) throw new Error("model returned no tool call");
          const args = JSON.parse(call.function.arguments) as Json;
          ctx.privately({ arguments: args });
          return args as unknown;
        },
      ],
    ],
  );
  return { value: result.value, interaction: result.interaction };
}
