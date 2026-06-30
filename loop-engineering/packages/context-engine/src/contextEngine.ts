import { DiscoveryContext, ConnectorEvidence, LoopSpec, SkillDocument } from '../../shared/src/types';

export class ContextEngine {
  buildDiscoveryContext(input: {
    loop: LoopSpec;
    projectId?: string;
    skill: SkillDocument;
    state: string;
    inbox: string;
    evidence: ConnectorEvidence[];
    maxCharacters: number;
  }): DiscoveryContext {
    return {
      loopId: input.loop.metadata.id,
      projectId: input.projectId ?? input.loop.handoff.project,
      skill: input.skill,
      state: truncate(input.state, input.maxCharacters),
      inbox: truncate(input.inbox, input.maxCharacters),
      evidence: input.evidence,
      maxCharacters: input.maxCharacters
    };
  }
}

function truncate(value: string, maxCharacters: number): string {
  return value.length > maxCharacters ? value.slice(0, maxCharacters) : value;
}
