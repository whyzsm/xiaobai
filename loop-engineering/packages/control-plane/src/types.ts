export type WorkspaceSource =
  | { type: 'empty' }
  | { type: 'git'; repositoryUrl: string; branch?: string }
  | { type: 'existing'; path: string };

export type BackgroundSource =
  | { type: 'none' }
  | { type: 'xiaoneng' }
  | { type: 'git'; name: string; repositoryUrl: string; ref?: string }
  | { type: 'existing'; name: string; path: string };

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  defaultBranch?: string;
  source: WorkspaceSource;
  background: BackgroundSource;
}

export interface PreflightIssue {
  field: string;
  code: string;
  message: string;
}

export interface WorkspacePreflight {
  ok: boolean;
  issues: PreflightIssue[];
}

export interface ManagedBackground {
  id: string;
  name: string;
  hostPath: string;
  agentPath: string;
  source: BackgroundSource;
  resolvedCommit: string | null;
  access: 'read-only';
}

export interface ManagedWorkspace {
  id: string;
  name: string;
  hostPath: string;
  agentPath: string;
  defaultBranch: string;
  source: WorkspaceSource;
  remote: string | null;
  resolvedCommit: string | null;
  background: ManagedBackground | null;
  route: {
    projectId: string;
    repositoryId: string;
    backgroundId: string | null;
    loopId: 'frontend-delivery';
  };
  createdAt: string;
}

export interface ControlPlaneState {
  version: 1;
  workspaces: ManagedWorkspace[];
}
