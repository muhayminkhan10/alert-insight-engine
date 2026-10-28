"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

/**
 * Server-side incident explanation.
 *
 * Credentials never reach the browser: the Gemini key (GEMINI_API_KEY) and the
 * platform integration key (VLY_INTEGRATION_KEY) are read from the Convex
 * deployment environment. When neither is available the action returns
 * `ok: false` and the client renders its deterministic explanation instead —
 * the rest of the app does not depend on this call succeeding.
 */

const alertSpec = v.object({
  ts: v.number(),
  service: v.string(),
  severity: v.string(),
  type: v.string(),
  description: v.string(),
});

const SYSTEM_PROMPT = `You are an SRE incident analyst. You receive a correlated incident: its
alerts (in time order), the dependency-graph evidence, and ranked root-cause
candidates. Answer ONLY from the supplied evidence. Never invent alerts,
services, timestamps or metrics. Treat every causal statement as a hypothesis.

Return strictly valid JSON with this shape and nothing else:
{
  "summary": "2-4 sentences explaining the incident and the leading root-cause hypothesis",
  "hypotheses": [
    { "service": "service-id", "supporting": ["evidence line", "..."], "counter": "one sentence of disconfirming context or the main uncertainty" }
  ],
  "steps": ["concrete investigation step", "..."]
}
Include the top ranked candidate first, then at most two alternatives.`;

export const explainIncident = action({
  args: {
    title: v.string(),
    severity: v.string(),
    services: v.array(v.string()),
    rootCause: v.string(),
    evidence: v.array(v.string()),
    candidates: v.array(
      v.object({ service: v.string(), score: v.number(), signals: v.array(v.string()) }),
    ),
    alerts: v.array(alertSpec),
  },
  handler: async (_ctx, args): Promise<{ ok: boolean; source: string; text?: string }> => {
    const user = JSON.stringify(
      {
        title: args.title,
        severity: args.severity,
        rootCauseCandidate: args.rootCause,
        affectedServices: args.services,
        correlationEvidence: args.evidence,
        rootCauseCandidates: args.candidates,
        alerts: args.alerts,
      },
      null,
      2,
    );

    const callGemini = async (apiKey: string) => {
      const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
          }),
        },
      );
      if (!res.ok) throw new Error(`gemini:${res.status}`);
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("gemini:empty");
      return text;
    };

    const callVly = async () => {
      const { vly } = await import("../lib/vly-integrations");
      const res = await vly.ai.completion({
        model: process.env.VLY_AI_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        maxTokens: 900,
      });
      const text = res?.data?.choices?.[0]?.message?.content;
      if (!res?.success || !text) throw new Error(res?.error ?? "vly:failed");
      return text;
    };

    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        return { ok: true, source: "gemini", text: await callGemini(geminiKey) };
      } catch (err) {
        console.warn("[ai] gemini failed, trying fallback", err);
      }
    }
    if (process.env.VLY_INTEGRATION_KEY) {
      try {
        return { ok: true, source: "vly", text: await callVly() };
      } catch (err) {
        console.warn("[ai] vly completion failed", err);
      }
    }
    return { ok: false, source: "none" };
  },
});
