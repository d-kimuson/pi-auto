import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const toolApproveParameters = Type.Object({
  approve: Type.Boolean({
    description: 'True to approve unsandboxed execution, false to deny it.',
  }),
  reason: Type.Optional(
    Type.String({
      description: 'Reason for the approval or denial.',
    }),
  ),
});

export type ToolApprovalDecision =
  | { readonly approve: true; readonly reason?: string }
  | { readonly approve: false; readonly reason: string };

export const toolApproveTool = defineTool<typeof toolApproveParameters, ToolApprovalDecision>({
  name: 'toolApprove',
  label: 'Approve Tool',
  description: 'Approve or deny unsandboxed execution for a sandbox-blocked tool call.',
  promptSnippet:
    'Call toolApprove exactly once to approve or deny the blocked tool execution request.',
  promptGuidelines: [
    'You must call toolApprove exactly once before finishing.',
    'Use approve=true when the blocked execution is aligned with the user intent and acceptable to run outside the sandbox.',
    'Use approve=false with a concrete reason when the blocked execution should remain denied.',
  ],
  executionMode: 'sequential',
  parameters: toolApproveParameters,

  execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    if (!params.approve && params.reason === undefined) {
      throw new Error('toolApprove deny requires reason');
    }

    const details: ToolApprovalDecision = params.approve
      ? { approve: true, reason: params.reason }
      : { approve: false, reason: params.reason ?? 'Denied without reason' };

    return Promise.resolve({
      content: [
        {
          type: 'text',
          text: params.approve
            ? `Approved${params.reason === undefined ? '' : `: ${params.reason}`}`
            : `Denied: ${params.reason}`,
        },
      ],
      details,
      terminate: true,
    });
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(toolApproveTool);
}
