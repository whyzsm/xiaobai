window.__ModuleLoader__.load({
  id: "@xiaobai/dsh-plugin",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useState } = React;

    const METHODS = {
      list: "WorkspaceConfigRequest",
      projectCandidates: "ProjectCandidatesRequest",
      get: "WorkspaceConfigRequest",
      createDraft: "CreateProjectDraftRequest",
      validate: "ProjectConfigDraft",
      preview: "ProjectConfigDraft",
      pickDirectory: "DirectoryPickRequest",
      requestApproval: "ProjectConfigDraft",
      apply: "ApplyProjectConfigRequest",
      history: "WorkspaceConfigRequest",
      rollback: "RollbackProjectConfigRequest",
    };
    const REMOTE = {
      package: "@xiaobai/dsh-plugin",
      descriptors: Object.entries(METHODS).map(([method, typeSymbol]) => ({
        id: `@xiaobai/dsh-plugin#xiaobaiConfig/${method}`,
        service: "xiaobaiConfig",
        namespace: "xiaobaiConfig",
        method,
        invocation: { kind: "direct" },
        parameters: [{
          name: "request",
          wire: "request",
          source: "json",
          codec: { mode: "strict", typeSymbol: `@xiaobai/dsh-plugin/types#${typeSymbol}`, schema: { parse: (value) => value } },
        }],
        result: { mode: "strict", typeSymbol: "@xiaobai/dsh-plugin/types#ResponseEnvelope", schema: { parse: (value) => value } },
      })),
    };
    const REMOTE_MOUNT_TIMEOUT_MS = 10000;
    const REMOTE_REQUEST_TIMEOUT_MS = 10000;
    const PROJECT_REFERENCE_SOURCE = "xiaobai-project";
    const PROJECT_REFERENCE_TAG = "xiaobai-project";
    const WORKSPACE_ID_PATTERN = /^ws_[a-z0-9][a-z0-9_-]{2,63}$/;
    const PROJECT_ID_PATTERN = /^prj_[a-z0-9][a-z0-9_-]{2,63}$/;
    const PROJECT_STATUS_LABELS = { locked: "已锁定", unavailable: "不可用", unknown: "未知" };
    const PHASE_LABELS = {
      idle: "待连接",
      loading: "加载中",
      loaded: "已加载",
      missing: "待选择",
      editing: "编辑中",
      draft: "草稿",
      invalid: "配置无效",
      conflict: "存在冲突",
      approval: "待审批",
      rollback: "回滚中",
      error: "错误",
    };
    const STATUS_LABELS = {
      active: "正常",
      blocked: "已阻塞",
      conflict: "存在冲突",
      drift: "配置漂移",
      invalid: "无效",
      loaded: "已加载",
      failed: "失败",
      ready: "就绪",
      unknown: "未知",
      "knowledge-unchecked": "知识未检查",
    };
    const DIRECTORY_KIND_LABELS = {
      workspace: "工作区目录",
      repository: "代码仓库目录",
      knowledge: "背景知识目录",
      artifact: "产物目录",
    };
    const LOCALIZED_MESSAGES = {
      REMOTE_MOUNT_TIMEOUT: "连接小白服务超时，请重试。",
      REMOTE_NAMESPACE_UNAVAILABLE: "小白服务未提供配置接口。",
      REMOTE_MOUNT_FAILED: "小白服务连接失败，请重试。",
      REMOTE_ERROR: "小白服务请求失败，请重试。",
      WORKSPACE_LOAD_FAILED: "工作区加载失败，请重试。",
      WORKSPACE_PICK_FAILED: "工作区目录未选择。",
      DIRECTORY_PICK_FAILED: "目录未选择。",
      DRAFT_FAILED: "配置草稿创建失败。",
      CONFIG_INVALID: "配置无效，请修正后重试。",
      PREVIEW_FAILED: "配置预览未就绪。",
      APPROVAL_REQUIRED: "需要主机审批后才能继续。",
      APPROVAL_FAILED: "配置审批失败。",
      APPLY_FAILED: "配置未应用。",
      ROLLBACK_FAILED: "配置回滚失败。",
      "directory-picker-unavailable": "当前 dsh 未启用目录浏览能力，请重启 dsh 后重试。",
      "directory-unreadable": "目录无法读取，请选择其他目录。",
      "directory-exists": "目录已存在，请选择其他名称。",
      "directory-create-failed": "新建目录失败，请重试。",
      XIAOBAI_HOST_UNSUPPORTED: "当前主机不支持该目录选择方式，请使用目录浏览器。",
      XIAOBAI_WORKSPACE_REQUIRED: "请先选择工作区。",
      XIAOBAI_PATH_ESCAPE: "所选目录不在允许范围内。",
      XIAOBAI_CONFIG_INVALID: "配置无效，请修正后重试。",
      XIAOBAI_CONFIG_CONFLICT: "配置已发生变化，请重新加载后再试。",
      XIAOBAI_CONFIG_DRIFT: "检测到配置漂移，请重新加载并处理冲突。",
      XIAOBAI_APPROVAL_REQUIRED: "需要主机审批后才能继续。",
      XIAOBAI_WRITE_FAILED: "配置写入失败，原配置已保留。",
      XIAOBAI_PROJECT_NOT_FOUND: "未找到对应项目。",
    };

    const listeners = new Set();
    const state = {
      remote: undefined,
      remoteStatus: "unmounted",
      phase: "idle",
      busy: undefined,
      workspaceBindingRef: undefined,
      workspaces: undefined,
      workspace: undefined,
      selectedProjectId: undefined,
      config: undefined,
      draft: undefined,
      validation: undefined,
      preview: undefined,
      approvalId: undefined,
      history: [],
      baseline: undefined,
      rollbackRevision: undefined,
      rollbackDraft: undefined,
      rollbackApprovalId: undefined,
      notice: [],
      directoryPicker: { open: false, kind: undefined, listing: undefined, loading: false, error: undefined },
    };
    let remoteMountTask;
    let remountRemote = () => {};
    let directoryBrowseController;
    let directoryBrowseRequest = 0;

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function notify() {
      for (const listener of [...listeners]) listener();
    }

    function localizedMessage(code, fallback) {
      return LOCALIZED_MESSAGES[code] || fallback || code || "操作失败，请重试。";
    }

    function errorText(error) {
      const raw = String(error?.message || error || "Remote request failed");
      const code = error?.code || raw.match(/^(XIAOBAI_[A-Z_]+|REMOTE_[A-Z_]+|[A-Z_]+_FAILED|directory-[a-z-]+)\s*:/)?.[1];
      const message = localizedMessage(code, raw === "host unavailable" ? "主机服务不可用。" : raw);
      return String(message)
        .replaceAll(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
        .replaceAll(/(?:[a-z]:[\\/]|\\\\|\/)[^\s'"()<>]+/g, "[redacted-path]");
    }

    function diagnosticsOf(envelope, fallbackCode, fallbackMessage) {
      const items = Array.isArray(envelope?.diagnostics) && envelope.diagnostics.length > 0
        ? envelope.diagnostics
        : [{ code: envelope?.errorCode || fallbackCode, severity: "error", message: fallbackMessage }];
      return items.map((item) => ({ ...item, message: localizedMessage(item.code, item.message || item.code) }));
    }

    function projectReference(value) {
      let reference;
      try { reference = typeof value === "string" ? JSON.parse(value) : value; } catch { return undefined; }
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) return undefined;
      if (!WORKSPACE_ID_PATTERN.test(reference.workspaceId || "") || !PROJECT_ID_PATTERN.test(reference.projectId || "")) return undefined;
      const label = String(reference.label || "").trim();
      if (!label || label.length > 128 || /[\u0000-\u001f\u007f<>]/u.test(label)) return undefined;
      return { workspaceId: reference.workspaceId, projectId: reference.projectId, label };
    }

    function escapeProjectText(value) {
      return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    }

    function projectCandidate(candidate) {
      const label = String(candidate?.sourceProjectId || candidate?.displayName || "").trim();
      const reference = projectReference({ workspaceId: candidate?.workspaceId, projectId: candidate?.projectId, label });
      if (!reference) return undefined;
      const knowledge = PROJECT_STATUS_LABELS[candidate.knowledgeStatus] || PROJECT_STATUS_LABELS.unknown;
      const repository = PROJECT_STATUS_LABELS[candidate.repositoryStatus] || PROJECT_STATUS_LABELS.unknown;
      return {
        name: `@${label}`,
        description: `${candidate.displayName || label} · 知识${knowledge} · 仓库${repository}`,
        value: JSON.stringify(reference),
      };
    }

    const projectSource = {
      trigger: "@",
      name: PROJECT_REFERENCE_SOURCE,
      order: 70,
      showGroupTitle: false,
      async candidates(_session, { query, signal }) {
        if (signal?.aborted || !state.remote || typeof state.remote.projectCandidates !== "function") return [];
        try {
          const envelope = await remoteCall("projectCandidates", { query: query || "", ...(state.workspace?.workspaceId ? { workspaceId: state.workspace.workspaceId } : {}) }, REMOTE_REQUEST_TIMEOUT_MS);
          if (signal?.aborted || envelope?.status !== "ok") return [];
          return (envelope.data?.projects || []).map(projectCandidate).filter(Boolean);
        } catch { return []; }
      },
      onPick({ candidate }) {
        const reference = projectReference(candidate?.value);
        if (!reference) return undefined;
        const mention = `@${reference.label}`;
        return { insert: { source: PROJECT_REFERENCE_SOURCE, ref: JSON.stringify(reference), label: mention, clipboardText: mention } };
      },
      codec: {
        clipboardText: (ref) => {
          const reference = projectReference(ref);
          return reference ? `@${reference.label}` : "@";
        },
        serialize: async (ref, signal) => {
          if (signal?.aborted) throw new Error("Project reference serialization was cancelled");
          const reference = projectReference(ref);
          if (!reference) throw new Error("Project reference is invalid");
          return `<${PROJECT_REFERENCE_TAG} workspace-id="${reference.workspaceId}" project-id="${reference.projectId}">${escapeProjectText(reference.label)}</${PROJECT_REFERENCE_TAG}>`;
        },
      },
    };

    function withTimeout(promise, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const error = new Error(`Remote mount timed out after ${timeoutMs}ms`);
          error.code = "REMOTE_MOUNT_TIMEOUT";
          reject(error);
        }, timeoutMs);
        Promise.resolve(promise).then((value) => {
          clearTimeout(timer);
          resolve(value);
        }, (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    }

    function remoteServiceFrom(ctx) {
      const remote = typeof ctx.get === "function" ? ctx.get("remote.xiaobaiConfig") : undefined;
      return remote || ctx.reflect?.get?.("remote.xiaobaiConfig");
    }

    function phaseFor(status, diagnostics = []) {
      if (status === "ok") return "loaded";
      if (status === "unsupported") return "missing";
      if (status === "conflict" || status === "drift") return "conflict";
      if (status === "invalid") return "invalid";
      if (status === "approval_required") return "approval";
      if (diagnostics.some((item) => item.code === "XIAOBAI_WORKSPACE_REQUIRED")) return "missing";
      return "error";
    }

    function defaultConfig() {
      return {
        key: "new-project",
        displayName: "新建项目",
        owner: "待指定",
        classification: "internal",
        repositories: [{ name: "repository", source: "local", locator: "repositories/repository", readOnly: false, classification: "internal" }],
        knowledgeBindings: [{ source: "project-context", revision: "declared", digest: `sha256:${"0".repeat(64)}`, readOnly: true, trust: "project" }],
        agentProfiles: [{ role: "project-operator", purpose: "操作当前项目范围", modelPolicyRef: "xiaobai-agent-policy/default", allowedSkills: [], requiredContext: ["project-baseline"], capabilities: [], riskLevel: "medium", humanGatePolicy: "required-for-delivery", outputContract: "stage-result/v1" }],
        skills: [{ name: "project-context", version: "1.0.0", purpose: "解析项目上下文", owner: "待指定", capabilities: [], trust: "project" }],
        memory: { namespaceId: "mem_new_project", retention: "project", projection: "host-storage-domain" },
        artifact: { locator: "artifacts/new-project", readOnly: false },
        qualityCommands: { validate: "npm run validate", test: "npm test" },
      };
    }

    function clearEditor() {
      state.selectedProjectId = undefined;
      state.config = undefined;
      state.draft = undefined;
      state.validation = undefined;
      state.preview = undefined;
      state.approvalId = undefined;
      state.history = [];
      state.baseline = undefined;
      state.rollbackRevision = undefined;
      state.rollbackDraft = undefined;
      state.rollbackApprovalId = undefined;
    }

    function resetDraftState() {
      state.draft = undefined;
      state.validation = undefined;
      state.preview = undefined;
      state.approvalId = undefined;
      state.rollbackRevision = undefined;
      state.rollbackDraft = undefined;
      state.rollbackApprovalId = undefined;
    }

    function patchConfig(patch) {
      state.config = { ...state.config, ...patch };
      resetDraftState();
      state.notice = [];
      notify();
    }

    async function remoteCall(method, request, timeoutMs) {
      if (!state.remote || typeof state.remote[method] !== "function") throw new Error("小白配置服务未挂载。");
      const call = Promise.resolve().then(() => state.remote[method](request || {}));
      const result = timeoutMs === undefined ? await call : await withTimeout(call, timeoutMs);
      if (!result?.ok) {
        const error = new Error(`${result?.error?.code || "REMOTE_ERROR"}: ${result?.error?.message || "小白服务请求失败。"}`);
        error.code = result?.error?.code || "REMOTE_ERROR";
        throw error;
      }
      return result.value;
    }

    async function loadProjects() {
      if (!state.remote || state.busy === "load") return;
      state.busy = "load";
      state.phase = "loading";
      state.notice = [];
      notify();
      try {
        const envelope = await remoteCall("list", state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}, REMOTE_REQUEST_TIMEOUT_MS);
        state.workspace = envelope.data;
        const workspaceStatus = envelope.data?.status;
        state.phase = workspaceStatus === "invalid" ? "invalid" : workspaceStatus === "drift" ? "conflict" : phaseFor(envelope.status, envelope.diagnostics);
        state.notice = envelope.status === "ok" ? diagnosticsOf({ diagnostics: envelope.data?.diagnostics || envelope.diagnostics }, "WORKSPACE_LOAD_FAILED", "工作区加载失败，请重试。") : diagnosticsOf(envelope, "WORKSPACE_LOAD_FAILED", "工作区加载失败，请重试。");
      } catch (error) {
        state.workspace = undefined;
        state.phase = state.remote ? "error" : "missing";
        state.notice = [{ code: "WORKSPACE_LOAD_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    function createAbortController() {
      if (typeof AbortController === "function") return new AbortController();
      return { signal: undefined, abort() {} };
    }

    function resetDirectoryPicker() {
      directoryBrowseRequest += 1;
      directoryBrowseController?.abort();
      directoryBrowseController = undefined;
      state.directoryPicker = { open: false, kind: undefined, listing: undefined, loading: false, error: undefined };
    }

    function applyDirectoryBinding(kind, binding) {
      if (kind === "repository") {
        const repository = state.config?.repositories?.[0] || {};
        patchConfig({ repositories: [{ ...repository, bindingRef: binding.bindingRef, locator: binding.locator }] });
      } else if (kind === "knowledge") {
        const knowledge = state.config?.knowledgeBindings?.[0] || {};
        patchConfig({ knowledgeBindings: [{ ...knowledge, bindingRef: binding.bindingRef, locator: binding.locator }] });
      } else if (kind === "artifact") {
        patchConfig({ artifact: { ...state.config?.artifact, bindingRef: binding.bindingRef, locator: binding.locator } });
      }
    }

    async function commitDirectory(kind, path) {
      state.busy = `pick-${kind}`;
      state.notice = [];
      notify();
      try {
        const envelope = await remoteCall("pickDirectory", { kind, selectedPath: path, ...(state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}) });
        if (envelope.status !== "ok" || envelope.data?.cancelled) {
          state.notice = envelope.data?.cancelled ? [] : diagnosticsOf(envelope, "DIRECTORY_PICK_FAILED", "目录未选择。");
          if (state.directoryPicker.open) state.directoryPicker.error = state.notice[0]?.message;
          return;
        }
        const binding = envelope.data;
        resetDirectoryPicker();
        if (kind === "workspace") {
          state.workspaceBindingRef = binding.bindingRef;
          await loadProjects();
        } else {
          applyDirectoryBinding(kind, binding);
        }
      } catch (error) {
        const diagnostic = { code: "DIRECTORY_PICK_FAILED", severity: "error", message: errorText(error) };
        state.notice = [diagnostic];
        if (state.directoryPicker.open) state.directoryPicker.error = diagnostic.message;
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    async function chooseNativeDirectory(kind) {
      state.busy = `pick-${kind}`;
      state.notice = [];
      notify();
      try {
        const envelope = await remoteCall("pickDirectory", { kind, ...(state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}) });
        if (envelope.status !== "ok" || envelope.data?.cancelled) {
          state.notice = envelope.data?.cancelled ? [] : diagnosticsOf(envelope, "DIRECTORY_PICK_FAILED", "目录未选择。");
          return;
        }
        const binding = envelope.data;
        if (kind === "workspace") {
          state.workspaceBindingRef = binding.bindingRef;
          await loadProjects();
        } else applyDirectoryBinding(kind, binding);
      } catch (error) {
        state.notice = [{ code: "DIRECTORY_PICK_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    async function loadDirectory(path) {
      const browser = state.workspaces;
      if (!browser || typeof browser.listDirectory !== "function") {
        state.directoryPicker.loading = false;
        state.directoryPicker.error = "当前主机没有目录浏览能力。";
        state.busy = undefined;
        notify();
        return;
      }
      const requestId = ++directoryBrowseRequest;
      directoryBrowseController?.abort();
      const controller = createAbortController();
      directoryBrowseController = controller;
      state.directoryPicker.loading = true;
      state.directoryPicker.error = undefined;
      notify();
      try {
        const listing = await withTimeout(Promise.resolve().then(() => browser.listDirectory(path, controller.signal)), REMOTE_REQUEST_TIMEOUT_MS);
        if (requestId !== directoryBrowseRequest || !state.directoryPicker.open) return;
        state.directoryPicker.listing = listing;
        state.directoryPicker.loading = false;
        state.directoryPicker.error = undefined;
        state.busy = undefined;
      } catch (error) {
        if (requestId !== directoryBrowseRequest || !state.directoryPicker.open) return;
        state.directoryPicker.loading = false;
        state.directoryPicker.error = errorText(error);
        state.busy = undefined;
      } finally {
        if (requestId === directoryBrowseRequest) directoryBrowseController = undefined;
        notify();
      }
    }

    function openDirectoryPicker(kind) {
      if (typeof state.workspaces?.pickDirectory === "function") {
        void chooseNativeDirectory(kind);
        return;
      }
      if (typeof state.workspaces?.listDirectory === "function") {
        state.directoryPicker = { open: true, kind, listing: undefined, loading: true, error: undefined };
        state.busy = `browse-${kind}`;
        state.notice = [];
        notify();
        void loadDirectory();
        return;
      }
      void chooseNativeDirectory(kind);
    }

    function closeDirectoryPicker() {
      resetDirectoryPicker();
      state.busy = undefined;
      notify();
    }

    function chooseWorkspace() {
      openDirectoryPicker("workspace");
    }

    function chooseBinding(kind) {
      if (!state.config) return;
      openDirectoryPicker(kind);
    }

    async function selectProject(projectId) {
      state.selectedProjectId = projectId;
      state.config = undefined;
      resetDraftState();
      state.history = [];
      state.notice = [];
      state.busy = "load-project";
      notify();
      const scope = state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {};
      try {
        const [configEnvelope, historyEnvelope] = await Promise.all([
          remoteCall("get", { ...scope, projectId }),
          remoteCall("history", { ...scope, projectId }),
        ]);
        if (configEnvelope.status !== "ok") throw new Error(`${configEnvelope.errorCode || "PROJECT_LOAD_FAILED"}: ${diagnosticsOf(configEnvelope, "PROJECT_LOAD_FAILED", "项目加载失败。")[0].message}`);
        state.config = configEnvelope.data.config;
        state.baseline = { revision: configEnvelope.data.revision, digest: configEnvelope.data.digest };
        state.history = historyEnvelope.status === "ok" ? (historyEnvelope.data?.entries || []) : [];
        state.phase = "loaded";
      } catch (error) {
        state.config = undefined;
        state.phase = "error";
        state.notice = [{ code: "PROJECT_LOAD_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    function newProject() {
      clearEditor();
      state.config = defaultConfig();
      state.phase = "editing";
      state.notice = [];
      notify();
    }

    async function createDraft() {
      if (!state.config) return;
      state.busy = "draft";
      state.notice = [];
      notify();
      try {
        const request = {
          ...(state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}),
          ...(state.selectedProjectId ? { projectId: state.selectedProjectId, operation: "update" } : { operation: "create" }),
          config: state.config,
          actor: { identity: "dsh-user" },
        };
        const envelope = await remoteCall("createDraft", request);
        if (envelope.status !== "ok") {
          state.phase = phaseFor(envelope.status, envelope.diagnostics);
          state.notice = diagnosticsOf(envelope, "DRAFT_FAILED", "配置草稿创建失败。");
          return;
        }
        state.draft = envelope.data;
        state.phase = "draft";
      } catch (error) {
        state.phase = "error";
        state.notice = [{ code: "DRAFT_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    async function validateDraft() {
      if (!state.draft) return;
      state.busy = "validate";
      notify();
      try {
        const envelope = await remoteCall("validate", { draft: state.draft, ...(state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}) });
        state.validation = envelope.data;
        state.phase = phaseFor(envelope.status, envelope.diagnostics);
        state.notice = envelope.status === "ok" ? [] : diagnosticsOf(envelope, "CONFIG_INVALID", "配置校验失败。");
      } catch (error) {
        state.phase = "error";
        state.notice = [{ code: "VALIDATE_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    async function previewDraft() {
      if (!state.draft) return;
      state.busy = "preview";
      notify();
      try {
        const envelope = await remoteCall("preview", { draft: state.draft, ...(state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}) });
        state.preview = envelope.data;
        state.phase = phaseFor(envelope.status, envelope.diagnostics);
        state.notice = envelope.status === "ok" ? [] : diagnosticsOf(envelope, "PREVIEW_FAILED", "配置预览未就绪。");
      } catch (error) {
        state.phase = "error";
        state.notice = [{ code: "PREVIEW_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    async function requestApprovalForDraft(draft, rollback = false) {
      if (!draft) return;
      state.busy = "approval";
      notify();
      try {
        const envelope = await remoteCall("requestApproval", { draft, ...(state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}) });
        if (envelope.status === "ok") {
          if (rollback) state.rollbackApprovalId = envelope.data.approvalId;
          else state.approvalId = envelope.data.approvalId;
          state.phase = "approval";
          state.notice = [];
        } else {
          state.phase = phaseFor(envelope.status, envelope.diagnostics);
          state.notice = diagnosticsOf(envelope, "APPROVAL_REQUIRED", "需要主机审批后才能继续。");
        }
      } catch (error) {
        state.phase = "error";
        state.notice = [{ code: "APPROVAL_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    async function applyDraft() {
      if (!state.draft || !state.approvalId) return;
      state.busy = "apply";
      notify();
      try {
        const envelope = await remoteCall("apply", { draftId: state.draft.draftId, approvalId: state.approvalId, ...(state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}) });
        state.phase = phaseFor(envelope.status, envelope.diagnostics);
        if (envelope.status === "ok") {
          state.notice = [{ code: "CONFIG_APPLIED", severity: "info", message: "配置已应用。" }];
          state.approvalId = undefined;
          await loadProjects();
          if (state.selectedProjectId) await selectProject(state.selectedProjectId);
        } else state.notice = diagnosticsOf(envelope, "APPLY_FAILED", "配置未应用。");
      } catch (error) {
        state.phase = "error";
        state.notice = [{ code: "APPLY_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    async function beginRollback(revision) {
      if (!state.selectedProjectId) return;
      state.busy = "rollback";
      state.rollbackRevision = revision;
      state.rollbackApprovalId = undefined;
      notify();
      try {
        const envelope = await remoteCall("rollback", { projectId: state.selectedProjectId, revision, ...(state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}) });
        if (envelope.status === "approval_required" && envelope.data?.draft) {
          state.rollbackDraft = envelope.data.draft;
          state.phase = "rollback";
          state.notice = diagnosticsOf(envelope, "ROLLBACK_FAILED", "回滚草稿创建失败。");
        } else {
          state.phase = phaseFor(envelope.status, envelope.diagnostics);
          state.notice = diagnosticsOf(envelope, "ROLLBACK_FAILED", "回滚草稿创建失败。");
        }
      } catch (error) {
        state.phase = "error";
        state.notice = [{ code: "ROLLBACK_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    async function applyRollback() {
      if (!state.selectedProjectId || !state.rollbackRevision || !state.rollbackDraft || !state.rollbackApprovalId) return;
      state.busy = "rollback-apply";
      notify();
      try {
        const envelope = await remoteCall("rollback", { projectId: state.selectedProjectId, revision: state.rollbackRevision, draftId: state.rollbackDraft.draftId, approvalId: state.rollbackApprovalId, ...(state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}) });
        state.phase = phaseFor(envelope.status, envelope.diagnostics);
        state.notice = envelope.status === "ok" ? [{ code: "ROLLBACK_APPLIED", severity: "info", message: "已恢复记录中的配置。" }] : diagnosticsOf(envelope, "ROLLBACK_FAILED", "配置未回滚。");
        if (envelope.status === "ok") {
          state.rollbackDraft = undefined;
          state.rollbackApprovalId = undefined;
          await loadProjects();
          await selectProject(state.selectedProjectId);
        }
      } catch (error) {
        state.phase = "error";
        state.notice = [{ code: "ROLLBACK_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    function retryConsole() {
      if (state.remote) {
        void loadProjects();
        return;
      }
      void remountRemote();
    }

    function labelOf(labels, value, fallback = "未知") {
      return labels[value] || value || fallback;
    }

    function directoryLabel(listing, path) {
      if (!path) return "主目录";
      if (path === listing?.home) return "主目录";
      const crumb = listing?.crumbs?.find((item) => item.path === path);
      if (crumb?.path === listing?.home) return "主目录";
      if (crumb?.name && !/^(?:[a-z]:[\\/]|\\\\|\/)/iu.test(crumb.name)) return crumb.name;
      const parts = path.split(/[\\/]+/u).filter(Boolean);
      return parts.at(-1) || "根目录";
    }

    function useStore() {
      const [, redraw] = useState(0);
      useEffect(() => subscribe(() => redraw((value) => value + 1)), []);
      return state;
    }

    function Diagnostics({ items }) {
      if (!Array.isArray(items) || items.length === 0) return null;
      return h("div", { className: "xb-config-diagnostics", role: "status", "aria-live": "polite" }, items.map((item, index) => h("div", { key: `${item.code || "diagnostic"}-${index}`, className: `xb-config-diagnostic xb-config-${item.severity || "info"}` }, `${item.field ? `${item.field}: ` : ""}${item.message || item.code}`)));
    }

    function Button({ children, onClick, disabled, primary, title, type = "button" }) {
      return h("button", { type, className: `xb-config-button${primary ? " primary" : ""}`, onClick, disabled, title }, children);
    }

    function Field({ label, value, onChange, type = "text", disabled = false }) {
      return h("label", { className: "xb-config-field" }, h("span", null, label), h("input", { type, value: value ?? "", disabled, onChange: (event) => onChange(event.target.value) }));
    }

    function SelectField({ label, value, options, onChange }) {
      const optionLabels = { public: "公开", internal: "内部", confidential: "机密", restricted: "受限", local: "本地", mount: "挂载", remote: "远程", bundled: "内置", project: "项目", external: "外部", derived: "派生", low: "低", medium: "中", high: "高", critical: "严重" };
      return h("label", { className: "xb-config-field" }, h("span", null, label), h("select", { value: value ?? "", onChange: (event) => onChange(event.target.value) }, options.map((option) => h("option", { key: option, value: option }, optionLabels[option] || option))));
    }

    function CheckField({ label, checked, onChange }) {
      return h("label", { className: "xb-config-check" }, h("input", { type: "checkbox", checked: checked === true, onChange: (event) => onChange(event.target.checked) }), h("span", null, label));
    }

    function DirectoryPickerDialog({ store }) {
      const picker = store.directoryPicker;
      if (!picker.open) return null;
      const listing = picker.listing;
      const crumbs = listing?.crumbs || [];
      const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined;
      const busy = Boolean(store.busy);
      const navigate = (path) => {
        state.busy = `browse-${picker.kind}`;
        notify();
        void loadDirectory(path);
      };
      return h("div", { className: "xb-config-picker-backdrop", role: "presentation" },
        h("div", { className: "xb-config-picker", role: "dialog", "aria-modal": "true", "aria-label": `选择${DIRECTORY_KIND_LABELS[picker.kind] || "目录"}` },
          h("div", { className: "xb-config-picker-head" },
            h("strong", null, `选择${DIRECTORY_KIND_LABELS[picker.kind] || "目录"}`),
            h("button", { type: "button", className: "xb-config-icon-button", onClick: closeDirectoryPicker, "aria-label": "关闭目录选择器", title: "关闭" }, "×")),
          listing ? h("div", { className: "xb-config-picker-crumbs", role: "navigation", "aria-label": "目录路径" }, crumbs.map((crumb, index) => h("span", { key: crumb.path, className: "xb-config-picker-crumb-seat" },
            index > 0 ? h("span", { className: "xb-config-picker-crumb-separator", "aria-hidden": "true" }, "/") : null,
            h("button", { type: "button", className: "xb-config-picker-crumb", disabled: busy, onClick: () => navigate(crumb.path) }, directoryLabel(listing, crumb.path))))) : null,
          h("div", { className: "xb-config-picker-body" },
            picker.loading ? h("p", { className: "xb-config-picker-status", role: "status", "aria-live": "polite" }, "正在读取目录…") : null,
            picker.error ? h("div", { className: "xb-config-picker-error", role: "alert" }, h("p", null, picker.error), h("div", { className: "xb-config-actions" }, h(Button, { disabled: busy, onClick: () => { state.busy = `browse-${picker.kind}`; void loadDirectory(listing?.path); } }, "重试"), h(Button, { disabled: busy, onClick: () => { closeDirectoryPicker(); void chooseNativeDirectory(picker.kind); } }, "使用系统选择器"))) : null,
            listing && !picker.loading ? h("div", { className: "xb-config-picker-list", role: "list" },
              listing.entries?.filter((entry) => !entry.hidden).map((entry) => h("div", { key: entry.path, className: "xb-config-picker-row", role: "listitem" }, h("span", { className: "xb-config-picker-folder", title: entry.name }, entry.name), h(Button, { disabled: busy, onClick: () => navigate(entry.path) }, "进入"))),
              listing.entries?.filter((entry) => !entry.hidden).length === 0 ? h("p", { className: "xb-config-picker-status" }, "当前目录没有可进入的子目录。") : null) : null,
            listing?.truncated ? h("p", { className: "xb-config-picker-status" }, "目录过多，仅显示部分内容。") : null),
          h("div", { className: "xb-config-picker-foot" },
            parent ? h(Button, { disabled: busy, onClick: () => navigate(parent.path) }, "返回上级") : null,
            h("span", { className: "xb-config-picker-current" }, `当前：${directoryLabel(listing, listing?.path)}`),
            h(Button, { disabled: busy || !listing || picker.loading, onClick: () => commitDirectory(picker.kind, listing.path) }, "选择此目录"),
            h(Button, { disabled: busy, onClick: closeDirectoryPicker }, "取消"))));
    }

    function Section({ title, children }) {
      return h("fieldset", { className: "xb-config-section" }, h("legend", null, title), children);
    }

    function ProjectList({ store }) {
      const projects = store.workspace?.projects || [];
      if (store.phase === "loading") return h("p", { className: "xb-config-muted" }, "正在加载项目…");
      if (projects.length === 0) return h("div", { className: "xb-config-empty" }, h("p", null, "暂无项目配置。"), h(Button, { primary: true, onClick: newProject }, "+ 新建项目"));
      return h("div", { className: "xb-config-projects", role: "list" }, projects.map((project) => h("div", { className: "xb-config-project", role: "listitem", key: project.projectId },
        h("div", { className: "xb-config-project-main" }, h("strong", null, project.displayName || project.projectId), h("span", { className: "xb-config-meta" }, `${labelOf(STATUS_LABELS, project.status)} · ${labelOf(STATUS_LABELS, project.knowledgeStatus, "知识未检查")}`)),
        h(Button, { onClick: () => selectProject(project.projectId), title: "打开项目配置" }, "配置"))));
    }

    function Editor({ store }) {
      if (!store.config) return null;
      const config = store.config;
      const repository = config.repositories?.[0] || {};
      const knowledge = config.knowledgeBindings?.[0] || {};
      const agent = config.agentProfiles?.[0] || {};
      const skill = config.skills?.[0] || {};
      const memory = config.memory || {};
      const artifact = config.artifact || {};
      const editing = Boolean(store.selectedProjectId);
      const disabled = Boolean(store.busy);
      const updateArray = (name, value) => patchConfig({ [name]: [value] });
      return h("div", { className: "xb-config-editor" },
        h("div", { className: "xb-config-editor-head" }, h("h2", null, editing ? "项目配置" : "新建项目"), h("button", { type: "button", className: "xb-config-icon-button", onClick: () => { clearEditor(); notify(); }, "aria-label": "关闭项目配置", title: "关闭" }, "×")),
        h(Section, { title: "基本信息" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "项目标识", value: config.key, disabled: editing || disabled, onChange: (value) => patchConfig({ key: value }) }),
          h(Field, { label: "项目名称", value: config.displayName, disabled, onChange: (value) => patchConfig({ displayName: value }) }),
          h(Field, { label: "负责人", value: config.owner, disabled, onChange: (value) => patchConfig({ owner: value }) }),
          h(SelectField, { label: "数据分类", value: config.classification, options: ["public", "internal", "confidential", "restricted"], onChange: (value) => patchConfig({ classification: value }) }),
        )),
        h(Section, { title: "代码仓库" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "名称", value: repository.name, disabled, onChange: (value) => updateArray("repositories", { ...repository, name: value }) }),
          h(SelectField, { label: "来源", value: repository.source, options: ["local", "mount", "remote"], onChange: (value) => updateArray("repositories", { ...repository, source: value }) }),
          h(Field, { label: "定位器", value: repository.locator, disabled, onChange: (value) => updateArray("repositories", { ...repository, locator: value }) }),
          h(CheckField, { label: "代码仓库只读", checked: repository.readOnly, onChange: (value) => updateArray("repositories", { ...repository, readOnly: value }) }),
          h("div", { className: "xb-config-field-action" }, h(Button, { disabled, onClick: () => chooseBinding("repository") }, "选择代码仓库目录")),
        )),
        h(Section, { title: "背景知识" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "来源", value: knowledge.source, disabled, onChange: (value) => updateArray("knowledgeBindings", { ...knowledge, source: value }) }),
          h(Field, { label: "版本", value: knowledge.revision, disabled, onChange: (value) => updateArray("knowledgeBindings", { ...knowledge, revision: value }) }),
          h(Field, { label: "摘要", value: knowledge.digest, disabled, onChange: (value) => updateArray("knowledgeBindings", { ...knowledge, digest: value }) }),
          h(SelectField, { label: "可信级别", value: knowledge.trust, options: ["bundled", "project", "external", "derived"], onChange: (value) => updateArray("knowledgeBindings", { ...knowledge, trust: value }) }),
          h(CheckField, { label: "背景知识只读", checked: knowledge.readOnly, onChange: (value) => updateArray("knowledgeBindings", { ...knowledge, readOnly: value }) }),
          h("div", { className: "xb-config-field-action" }, h(Button, { disabled, onClick: () => chooseBinding("knowledge") }, "选择背景知识目录")),
        )),
        h(Section, { title: "智能体配置" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "角色", value: agent.role, disabled, onChange: (value) => updateArray("agentProfiles", { ...agent, role: value }) }),
          h(Field, { label: "职责", value: agent.purpose, disabled, onChange: (value) => updateArray("agentProfiles", { ...agent, purpose: value }) }),
          h(Field, { label: "模型策略", value: agent.modelPolicyRef, disabled, onChange: (value) => updateArray("agentProfiles", { ...agent, modelPolicyRef: value }) }),
          h(SelectField, { label: "风险级别", value: agent.riskLevel, options: ["low", "medium", "high", "critical"], onChange: (value) => updateArray("agentProfiles", { ...agent, riskLevel: value }) }),
          h(Field, { label: "人工门禁策略", value: agent.humanGatePolicy, disabled, onChange: (value) => updateArray("agentProfiles", { ...agent, humanGatePolicy: value }) }),
          h(Field, { label: "输出合同", value: agent.outputContract, disabled, onChange: (value) => updateArray("agentProfiles", { ...agent, outputContract: value }) }),
        )),
        h(Section, { title: "技能" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "名称", value: skill.name, disabled, onChange: (value) => updateArray("skills", { ...skill, name: value }) }),
          h(Field, { label: "版本", value: skill.version, disabled, onChange: (value) => updateArray("skills", { ...skill, version: value }) }),
          h(Field, { label: "用途", value: skill.purpose, disabled, onChange: (value) => updateArray("skills", { ...skill, purpose: value }) }),
          h(Field, { label: "负责人", value: skill.owner, disabled, onChange: (value) => updateArray("skills", { ...skill, owner: value }) }),
        )),
        h(Section, { title: "记忆与产物" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "记忆命名空间", value: memory.namespaceId, disabled, onChange: (value) => patchConfig({ memory: { ...memory, namespaceId: value } }) }),
          h(Field, { label: "保留策略", value: memory.retention, disabled, onChange: (value) => patchConfig({ memory: { ...memory, retention: value } }) }),
          h(Field, { label: "投影方式", value: memory.projection, disabled, onChange: (value) => patchConfig({ memory: { ...memory, projection: value } }) }),
          h(Field, { label: "产物定位器", value: artifact.locator, disabled, onChange: (value) => patchConfig({ artifact: { ...artifact, locator: value } }) }),
          h(CheckField, { label: "产物只读", checked: artifact.readOnly, onChange: (value) => patchConfig({ artifact: { ...artifact, readOnly: value } }) }),
        )),
        h(Section, { title: "质量检查命令" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "校验", value: config.qualityCommands?.validate, disabled, onChange: (value) => patchConfig({ qualityCommands: { ...config.qualityCommands, validate: value } }) }),
          h(Field, { label: "测试", value: config.qualityCommands?.test, disabled, onChange: (value) => patchConfig({ qualityCommands: { ...config.qualityCommands, test: value } }) }),
        )),
        h("div", { className: "xb-config-actions" },
          h(Button, { primary: true, disabled, onClick: createDraft }, "创建草稿"),
          h(Button, { disabled: disabled || !store.draft, onClick: validateDraft }, "校验"),
          h(Button, { disabled: disabled || !store.draft, onClick: previewDraft }, "预览"),
          h(Button, { disabled: disabled || !store.draft || store.preview?.status !== "ready", onClick: () => requestApprovalForDraft(store.draft) }, "申请审批"),
          h(Button, { primary: true, disabled: disabled || !store.approvalId, onClick: applyDraft }, "应用"),
        ),
        store.validation ? h("div", { className: "xb-config-result" }, h("strong", null, `校验：${store.validation.valid ? "有效" : "无效"}`), h(Diagnostics, { items: store.validation.diagnostics })) : null,
        store.preview ? h("div", { className: "xb-config-result" }, h("strong", null, `预览：${labelOf(STATUS_LABELS, store.preview.status)}`), h("span", { className: "xb-config-meta" }, `${store.preview.files?.length || 0} 个文件 · ${store.preview.approvalRequired ? "需要审批" : "无需审批"}`), h(Diagnostics, { items: [...(store.preview.risks || []), ...(store.preview.diagnostics || [])] })) : null,
        h(HistoryPanel, { store }),
      );
    }

    function HistoryPanel({ store }) {
      if (!store.selectedProjectId) return null;
      if (!Array.isArray(store.history) || store.history.length === 0) return h("div", { className: "xb-config-history" }, h("h3", null, "历史版本"), h("p", { className: "xb-config-muted" }, "暂无记录版本。"));
      return h("div", { className: "xb-config-history" }, h("h3", null, "历史版本"), store.history.map((entry) => h("div", { className: "xb-config-history-row", key: entry.revision }, h("div", null, h("strong", null, entry.revision), h("span", { className: "xb-config-meta" }, `${entry.operation === "rollback" ? "回滚" : entry.operation === "update" ? "更新" : entry.operation} · ${entry.actor}`)), h(Button, { disabled: Boolean(store.busy) || !entry.canRollback, onClick: () => beginRollback(entry.revision) }, "回滚"))), store.rollbackDraft ? h("div", { className: "xb-config-rollback" }, h("strong", null, `回滚至 ${store.rollbackRevision}`), h("div", { className: "xb-config-actions" }, h(Button, { disabled: Boolean(store.busy), onClick: () => requestApprovalForDraft(store.rollbackDraft, true) }, "申请审批"), h(Button, { primary: true, disabled: Boolean(store.busy) || !store.rollbackApprovalId, onClick: applyRollback }, "应用回滚"))) : null);
    }

    function WorkspaceConsole({ store }) {
      const editing = Boolean(store.config);
      return h("section", { className: "xb-config-console", "aria-label": "小白" },
        h("div", { className: "xb-config-header" }, h("h1", null, "小白"), h("span", { className: `xb-config-status xb-config-status-${store.phase}` }, labelOf(PHASE_LABELS, store.phase))),
        h(Diagnostics, { items: store.notice }),
        store.phase === "loading" && !store.workspace ? h("div", { className: "xb-config-state", role: "status", "aria-live": "polite" }, store.remoteStatus === "mounted" ? "正在加载工作区项目…" : "正在连接小白服务…") : null,
        (store.remoteStatus === "error" || store.phase === "error") && !store.workspace && !editing ? h("div", { className: "xb-config-empty" }, h("p", null, "小白服务不可用，请重试连接。"), h(Button, { primary: true, disabled: Boolean(store.busy), onClick: retryConsole }, "重试连接")) : null,
        store.remoteStatus === "unmounted" && !store.workspace && !editing && store.phase !== "loading" ? h("div", { className: "xb-config-empty" }, h("p", null, "正在等待小白服务。"), h(Button, { primary: true, disabled: Boolean(store.busy), onClick: retryConsole }, "连接")) : null,
        store.phase === "missing" && !store.workspace ? h("div", { className: "xb-config-empty" }, h("p", null, "请选择工作区以管理项目。"), h(Button, { primary: true, disabled: Boolean(store.busy), onClick: chooseWorkspace }, "选择工作区目录")) : null,
        store.workspace && !editing ? h("div", { className: "xb-config-list" }, h("div", { className: "xb-config-list-head" }, h("h2", null, "项目"), h(Button, { primary: true, disabled: Boolean(store.busy), onClick: newProject }, "+ 新建项目")), h(ProjectList, { store })) : null,
        editing ? h(Editor, { store }) : null,
        h(DirectoryPickerDialog, { store }),
      );
    }

    function ConsoleView() {
      const store = useStore();
      useEffect(() => {
        if (store.remote && !store.workspace && !store.busy) void loadProjects();
      }, [store.remote]);
      return h(WorkspaceConsole, { store });
    }

    const CSS = `
.xb-config-console{box-sizing:border-box;width:100%;max-width:900px;padding:8px 0;color:var(--dsw-alias-label-primary);font:inherit}.xb-config-header,.xb-config-list-head,.xb-config-editor-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.xb-config-header h1,.xb-config-list-head h2,.xb-config-editor-head h2,.xb-config-history h3{margin:0;font-size:18px;line-height:26px;font-weight:600}.xb-config-history h3{font-size:14px;margin-bottom:8px}.xb-config-status,.xb-config-meta,.xb-config-muted{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.xb-config-status-conflict,.xb-config-status-invalid,.xb-config-status-error{color:var(--dsw-alias-state-error-primary)}.xb-config-status-loaded,.xb-config-status-approval{color:var(--dsw-alias-state-success-primary)}.xb-config-button{min-height:32px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}.xb-config-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.xb-config-button:disabled{opacity:.45;cursor:not-allowed}.xb-config-button.primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted)}.xb-config-icon-button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:22px;line-height:28px;cursor:pointer}.xb-config-projects{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}.xb-config-project{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.xb-config-project-main{display:flex;flex-direction:column;min-width:0;gap:3px}.xb-config-state{display:flex;align-items:center;min-height:48px;margin-top:16px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:13px}.xb-config-empty{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}.xb-config-editor{margin-top:12px}.xb-config-section{min-width:0;margin:16px 0 0;padding:12px 0 0;border:0;border-top:1px solid var(--dsw-alias-border-l1)}.xb-config-section legend{padding:0 8px 0 0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}.xb-config-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.xb-config-field{display:flex;flex-direction:column;gap:5px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.xb-config-field input,.xb-config-field select{box-sizing:border-box;width:100%;min-height:34px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}.xb-config-field input:disabled{opacity:.72}.xb-config-check{display:flex;align-items:center;align-self:end;min-height:34px;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px}.xb-config-check input{margin:0}.xb-config-field-action{display:flex;align-items:end;min-height:34px}.xb-config-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.xb-config-diagnostics{display:flex;flex-direction:column;gap:5px;margin-top:12px;font-size:12px;line-height:18px}.xb-config-diagnostic{padding:6px 8px;border-left:3px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}.xb-config-error{border-left-color:var(--dsw-alias-state-error-primary)}.xb-config-warning{border-left-color:var(--dsw-alias-state-warn-primary)}.xb-config-result,.xb-config-history{display:flex;flex-direction:column;gap:5px;margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:13px}.xb-config-history-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.xb-config-history-row>div{display:flex;flex-direction:column;gap:2px;min-width:0}.xb-config-rollback{margin-top:12px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}.xb-config-shortcut{margin:4px;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.xb-config-shortcut:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.xb-config-overlay{position:fixed;inset:0;z-index:100;display:flex;justify-content:flex-end;background:rgba(0,0,0,.22)}.xb-config-overlay-panel{box-sizing:border-box;width:min(820px,100vw);height:100%;overflow:auto;padding:24px;background:var(--dsw-alias-bg-base);box-shadow:-8px 0 24px rgba(0,0,0,.18)}.xb-config-overlay-close{position:absolute;top:14px;right:18px}.xb-config-picker-backdrop{position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.28)}.xb-config-picker{box-sizing:border-box;display:flex;flex-direction:column;width:min(680px,100%);max-height:min(620px,100%);overflow:hidden;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:0 12px 36px rgba(0,0,0,.22)}.xb-config-picker-head,.xb-config-picker-foot{display:flex;align-items:center;gap:12px;padding:14px 18px}.xb-config-picker-head{justify-content:space-between;border-bottom:1px solid var(--dsw-alias-border-l1)}.xb-config-picker-crumbs{display:flex;align-items:center;gap:4px;min-height:36px;padding:0 18px;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}.xb-config-picker-crumb-seat{display:inline-flex;align-items:center;gap:4px}.xb-config-picker-crumb-separator{color:var(--dsw-alias-label-tertiary)}.xb-config-picker-crumb{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.xb-config-picker-crumb:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.xb-config-picker-body{min-height:180px;overflow:auto;padding:14px 18px}.xb-config-picker-list{display:flex;flex-direction:column;gap:4px}.xb-config-picker-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:38px;padding:4px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.xb-config-picker-folder{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xb-config-picker-status,.xb-config-picker-error{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.xb-config-picker-error{color:var(--dsw-alias-state-error-primary)}.xb-config-picker-foot{flex-wrap:wrap;border-top:1px solid var(--dsw-alias-border-l1)}.xb-config-picker-current{flex:1 1 160px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px}.xb-config-picker-foot .xb-config-button{flex:0 0 auto}@media(max-width:600px){.xb-config-fields{grid-template-columns:minmax(0,1fr)}.xb-config-empty{align-items:flex-start;flex-direction:column}.xb-config-overlay-panel{padding:16px}.xb-config-actions .xb-config-button{flex:1 1 140px}.xb-config-picker-backdrop{padding:8px}.xb-config-picker-foot .xb-config-button{flex:1 1 120px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots) return;
      const inputTriggers = ctx.inputTriggers || (typeof ctx.get === "function" ? ctx.get("inputTriggers") : undefined);
      state.workspaces = ctx.workspaces || (typeof ctx.get === "function" ? ctx.get("workspaces") : undefined);
      if (typeof document !== "undefined" && !document.querySelector("style[data-plugin-css='xiaobai-dsh-plugin']")) {
        const style = document.createElement("style");
        style.dataset.pluginCss = "xiaobai-dsh-plugin";
        style.textContent = CSS;
        document.head.appendChild(style);
      }
      if (inputTriggers && typeof inputTriggers.registerSource === "function") ctx.effect(() => inputTriggers.registerSource(projectSource), "xiaobai-dsh-plugin: @project source");
      const mount = () => {
        if (state.remote || remoteMountTask) return remoteMountTask;
        state.remoteStatus = "loading";
        state.phase = "loading";
        state.notice = [];
        notify();
        remoteMountTask = (async () => {
          try {
            const dispose = await withTimeout(Promise.resolve().then(() => ctx.remote.$mount(REMOTE)), REMOTE_MOUNT_TIMEOUT_MS);
            state.remote = remoteServiceFrom(ctx);
            if (!state.remote || typeof state.remote.list !== "function") {
              const error = new Error("Xiaobai configuration Remote is unavailable after mount");
              error.code = "REMOTE_NAMESPACE_UNAVAILABLE";
              throw error;
            }
            state.remoteStatus = "mounted";
            state.phase = "loading";
            state.notice = [];
            notify();
            void loadProjects();
            return dispose;
          } catch (error) {
            state.remote = undefined;
            state.remoteStatus = "error";
            state.phase = "error";
            state.notice = [{ code: error?.code || "REMOTE_MOUNT_FAILED", severity: "error", message: errorText(error) }];
            notify();
            return undefined;
          } finally {
            remoteMountTask = undefined;
          }
        })();
        return remoteMountTask;
      };
      remountRemote = mount;
      ctx.effect(async () => {
        const dispose = await mount();
        return () => {
          if (remountRemote === mount) remountRemote = () => {};
          state.remote = undefined;
          state.remoteStatus = "unmounted";
          state.phase = "idle";
          resetDirectoryPicker();
          state.busy = undefined;
          state.workspace = undefined;
          state.workspaces = undefined;
          state.notice = [];
          notify();
          void dispose?.();
        };
      }, "xiaobai-dsh-plugin: remote");
      slots.inject("settings.section", () => slots.register({ name: "settings.section", id: "xiaobai-workspace", order: 60, label: "小白" }, ConsoleView));
    }

    exports.name = "@xiaobai/dsh-plugin";
    exports.inject = ["slots", "remote", "workspaces", "inputTriggers"];
    exports.apply = apply;
    return module.exports;
  },
});
