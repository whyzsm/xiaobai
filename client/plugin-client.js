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

    const listeners = new Set();
    const state = {
      remote: undefined,
      remoteStatus: "unmounted",
      phase: "idle",
      busy: undefined,
      workspaceBindingRef: undefined,
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
      overlay: false,
    };

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function notify() {
      for (const listener of [...listeners]) listener();
    }

    function errorText(error) {
      return String(error?.message || error || "Remote request failed")
        .replaceAll(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
        .replaceAll(/(?:[a-z]:[\\/]|\\\\|\/)[^\s'"()<>]+/g, "[redacted-path]");
    }

    function diagnosticsOf(envelope, fallbackCode, fallbackMessage) {
      return Array.isArray(envelope?.diagnostics) && envelope.diagnostics.length > 0
        ? envelope.diagnostics
        : [{ code: fallbackCode, severity: "error", message: envelope?.errorCode || fallbackMessage }];
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
        displayName: "New Project",
        owner: "unassigned",
        classification: "internal",
        repositories: [{ name: "repository", source: "local", locator: "repositories/repository", readOnly: false, classification: "internal" }],
        knowledgeBindings: [{ source: "project-context", revision: "declared", digest: `sha256:${"0".repeat(64)}`, readOnly: true, trust: "project" }],
        agentProfiles: [{ role: "project-operator", purpose: "Operate the explicit Project scope", modelPolicyRef: "xiaobai-agent-policy/default", allowedSkills: [], requiredContext: ["project-baseline"], capabilities: [], riskLevel: "medium", humanGatePolicy: "required-for-delivery", outputContract: "stage-result/v1" }],
        skills: [{ name: "project-context", version: "1.0.0", purpose: "Resolve Project context", owner: "unassigned", capabilities: [], trust: "project" }],
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

    async function remoteCall(method, request) {
      if (!state.remote || typeof state.remote[method] !== "function") throw new Error("Xiaobai configuration Remote is not mounted");
      const result = await state.remote[method](request || {});
      if (!result?.ok) throw new Error(`${result?.error?.code || "REMOTE_ERROR"}: ${result?.error?.message || "Remote request failed"}`);
      return result.value;
    }

    async function loadProjects() {
      if (!state.remote) return;
      state.busy = "load";
      state.phase = "loading";
      state.notice = [];
      notify();
      try {
        const envelope = await remoteCall("list", state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {});
        state.workspace = envelope.data;
        state.phase = phaseFor(envelope.status, envelope.diagnostics);
        state.notice = envelope.status === "ok" ? [] : diagnosticsOf(envelope, "WORKSPACE_LOAD_FAILED", "Workspace could not be loaded");
      } catch (error) {
        state.workspace = undefined;
        state.phase = "missing";
        state.notice = [{ code: "WORKSPACE_LOAD_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    async function chooseWorkspace() {
      state.busy = "workspace";
      state.notice = [];
      notify();
      try {
        const envelope = await remoteCall("pickDirectory", { kind: "workspace" });
        if (envelope.status === "ok" && envelope.data?.bindingRef) {
          state.workspaceBindingRef = envelope.data.bindingRef;
          await loadProjects();
          return;
        }
        state.notice = envelope.data?.cancelled ? [] : diagnosticsOf(envelope, "WORKSPACE_PICK_FAILED", "Workspace directory was not selected");
      } catch (error) {
        state.notice = [{ code: "WORKSPACE_PICK_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
    }

    async function chooseBinding(kind) {
      if (!state.config) return;
      state.busy = `pick-${kind}`;
      notify();
      try {
        const envelope = await remoteCall("pickDirectory", { kind, ...(state.workspaceBindingRef ? { workspaceBindingRef: state.workspaceBindingRef } : {}) });
        if (envelope.status !== "ok" || envelope.data?.cancelled) {
          state.notice = envelope.data?.cancelled ? [] : diagnosticsOf(envelope, "DIRECTORY_PICK_FAILED", "Directory was not selected");
          return;
        }
        const binding = envelope.data;
        if (kind === "repository") {
          const repository = state.config.repositories?.[0] || {};
          patchConfig({ repositories: [{ ...repository, bindingRef: binding.bindingRef, locator: binding.locator }] });
        } else if (kind === "knowledge") {
          const knowledge = state.config.knowledgeBindings?.[0] || {};
          patchConfig({ knowledgeBindings: [{ ...knowledge, bindingRef: binding.bindingRef, locator: binding.locator }] });
        } else {
          patchConfig({ artifact: { ...state.config.artifact, bindingRef: binding.bindingRef, locator: binding.locator } });
        }
      } catch (error) {
        state.notice = [{ code: "DIRECTORY_PICK_FAILED", severity: "error", message: errorText(error) }];
      } finally {
        state.busy = undefined;
        notify();
      }
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
        if (configEnvelope.status !== "ok") throw new Error(`${configEnvelope.errorCode || "PROJECT_LOAD_FAILED"}: ${diagnosticsOf(configEnvelope, "PROJECT_LOAD_FAILED", "Project could not be loaded")[0].message}`);
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
          state.notice = diagnosticsOf(envelope, "DRAFT_FAILED", "Draft could not be created");
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
        state.notice = envelope.status === "ok" ? [] : diagnosticsOf(envelope, "CONFIG_INVALID", "Configuration validation failed");
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
        state.notice = envelope.status === "ok" ? [] : diagnosticsOf(envelope, "PREVIEW_FAILED", "Configuration preview is not ready");
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
          state.notice = diagnosticsOf(envelope, "APPROVAL_REQUIRED", "Host approval is required");
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
          state.notice = [{ code: "CONFIG_APPLIED", severity: "info", message: "Configuration applied" }];
          state.approvalId = undefined;
          await loadProjects();
          if (state.selectedProjectId) await selectProject(state.selectedProjectId);
        } else state.notice = diagnosticsOf(envelope, "APPLY_FAILED", "Configuration was not applied");
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
          state.notice = envelope.diagnostics || [];
        } else {
          state.phase = phaseFor(envelope.status, envelope.diagnostics);
          state.notice = diagnosticsOf(envelope, "ROLLBACK_FAILED", "Rollback draft could not be prepared");
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
        state.notice = envelope.status === "ok" ? [{ code: "ROLLBACK_APPLIED", severity: "info", message: "Recorded configuration restored" }] : diagnosticsOf(envelope, "ROLLBACK_FAILED", "Rollback was not applied");
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
      return h("label", { className: "xb-config-field" }, h("span", null, label), h("select", { value: value ?? "", onChange: (event) => onChange(event.target.value) }, options.map((option) => h("option", { key: option, value: option }, option))));
    }

    function CheckField({ label, checked, onChange }) {
      return h("label", { className: "xb-config-check" }, h("input", { type: "checkbox", checked: checked === true, onChange: (event) => onChange(event.target.checked) }), h("span", null, label));
    }

    function Section({ title, children }) {
      return h("fieldset", { className: "xb-config-section" }, h("legend", null, title), children);
    }

    function ProjectList({ store }) {
      const projects = store.workspace?.projects || [];
      if (store.phase === "loading") return h("p", { className: "xb-config-muted" }, "Loading Projects...");
      if (projects.length === 0) return h("div", { className: "xb-config-empty" }, h("p", null, "No Project configuration."), h(Button, { primary: true, onClick: newProject }, "+ New Project"));
      return h("div", { className: "xb-config-projects", role: "list" }, projects.map((project) => h("div", { className: "xb-config-project", role: "listitem", key: project.projectId },
        h("div", { className: "xb-config-project-main" }, h("strong", null, project.displayName || project.projectId), h("span", { className: "xb-config-meta" }, `${project.status || "unknown"} · ${project.knowledgeStatus || "knowledge-unchecked"}`)),
        h(Button, { onClick: () => selectProject(project.projectId), title: "Open project configuration" }, "Configure"))));
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
        h("div", { className: "xb-config-editor-head" }, h("h2", null, editing ? "Project configuration" : "New Project"), h("button", { type: "button", className: "xb-config-icon-button", onClick: () => { clearEditor(); notify(); }, "aria-label": "Close project editor", title: "Close" }, "×")),
        h(Section, { title: "Identity" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "Key", value: config.key, disabled: editing || disabled, onChange: (value) => patchConfig({ key: value }) }),
          h(Field, { label: "Display name", value: config.displayName, disabled, onChange: (value) => patchConfig({ displayName: value }) }),
          h(Field, { label: "Owner", value: config.owner, disabled, onChange: (value) => patchConfig({ owner: value }) }),
          h(SelectField, { label: "Classification", value: config.classification, options: ["public", "internal", "confidential", "restricted"], onChange: (value) => patchConfig({ classification: value }) }),
        )),
        h(Section, { title: "Repository" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "Name", value: repository.name, disabled, onChange: (value) => updateArray("repositories", { ...repository, name: value }) }),
          h(SelectField, { label: "Source", value: repository.source, options: ["local", "mount", "remote"], onChange: (value) => updateArray("repositories", { ...repository, source: value }) }),
          h(Field, { label: "Locator", value: repository.locator, disabled, onChange: (value) => updateArray("repositories", { ...repository, locator: value }) }),
          h(CheckField, { label: "Read-only repository", checked: repository.readOnly, onChange: (value) => updateArray("repositories", { ...repository, readOnly: value }) }),
          h("div", { className: "xb-config-field-action" }, h(Button, { disabled, onClick: () => chooseBinding("repository") }, "Choose repository directory")),
        )),
        h(Section, { title: "Background Knowledge" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "Source", value: knowledge.source, disabled, onChange: (value) => updateArray("knowledgeBindings", { ...knowledge, source: value }) }),
          h(Field, { label: "Revision", value: knowledge.revision, disabled, onChange: (value) => updateArray("knowledgeBindings", { ...knowledge, revision: value }) }),
          h(Field, { label: "Digest", value: knowledge.digest, disabled, onChange: (value) => updateArray("knowledgeBindings", { ...knowledge, digest: value }) }),
          h(SelectField, { label: "Trust", value: knowledge.trust, options: ["bundled", "project", "external", "derived"], onChange: (value) => updateArray("knowledgeBindings", { ...knowledge, trust: value }) }),
          h(CheckField, { label: "Read-only Knowledge", checked: knowledge.readOnly, onChange: (value) => updateArray("knowledgeBindings", { ...knowledge, readOnly: value }) }),
          h("div", { className: "xb-config-field-action" }, h(Button, { disabled, onClick: () => chooseBinding("knowledge") }, "Choose Knowledge directory")),
        )),
        h(Section, { title: "Agent" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "Role", value: agent.role, disabled, onChange: (value) => updateArray("agentProfiles", { ...agent, role: value }) }),
          h(Field, { label: "Purpose", value: agent.purpose, disabled, onChange: (value) => updateArray("agentProfiles", { ...agent, purpose: value }) }),
          h(Field, { label: "Model policy", value: agent.modelPolicyRef, disabled, onChange: (value) => updateArray("agentProfiles", { ...agent, modelPolicyRef: value }) }),
          h(SelectField, { label: "Risk level", value: agent.riskLevel, options: ["low", "medium", "high", "critical"], onChange: (value) => updateArray("agentProfiles", { ...agent, riskLevel: value }) }),
          h(Field, { label: "Human gate policy", value: agent.humanGatePolicy, disabled, onChange: (value) => updateArray("agentProfiles", { ...agent, humanGatePolicy: value }) }),
          h(Field, { label: "Output contract", value: agent.outputContract, disabled, onChange: (value) => updateArray("agentProfiles", { ...agent, outputContract: value }) }),
        )),
        h(Section, { title: "Skill" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "Name", value: skill.name, disabled, onChange: (value) => updateArray("skills", { ...skill, name: value }) }),
          h(Field, { label: "Version", value: skill.version, disabled, onChange: (value) => updateArray("skills", { ...skill, version: value }) }),
          h(Field, { label: "Purpose", value: skill.purpose, disabled, onChange: (value) => updateArray("skills", { ...skill, purpose: value }) }),
          h(Field, { label: "Owner", value: skill.owner, disabled, onChange: (value) => updateArray("skills", { ...skill, owner: value }) }),
        )),
        h(Section, { title: "Memory and Artifacts" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "Memory namespace", value: memory.namespaceId, disabled, onChange: (value) => patchConfig({ memory: { ...memory, namespaceId: value } }) }),
          h(Field, { label: "Retention", value: memory.retention, disabled, onChange: (value) => patchConfig({ memory: { ...memory, retention: value } }) }),
          h(Field, { label: "Projection", value: memory.projection, disabled, onChange: (value) => patchConfig({ memory: { ...memory, projection: value } }) }),
          h(Field, { label: "Artifact locator", value: artifact.locator, disabled, onChange: (value) => patchConfig({ artifact: { ...artifact, locator: value } }) }),
          h(CheckField, { label: "Read-only artifacts", checked: artifact.readOnly, onChange: (value) => patchConfig({ artifact: { ...artifact, readOnly: value } }) }),
        )),
        h(Section, { title: "Quality commands" }, h("div", { className: "xb-config-fields" },
          h(Field, { label: "Validate", value: config.qualityCommands?.validate, disabled, onChange: (value) => patchConfig({ qualityCommands: { ...config.qualityCommands, validate: value } }) }),
          h(Field, { label: "Test", value: config.qualityCommands?.test, disabled, onChange: (value) => patchConfig({ qualityCommands: { ...config.qualityCommands, test: value } }) }),
        )),
        h("div", { className: "xb-config-actions" },
          h(Button, { primary: true, disabled, onClick: createDraft }, "Create draft"),
          h(Button, { disabled: disabled || !store.draft, onClick: validateDraft }, "Validate"),
          h(Button, { disabled: disabled || !store.draft, onClick: previewDraft }, "Preview"),
          h(Button, { disabled: disabled || !store.draft || store.preview?.status !== "ready", onClick: () => requestApprovalForDraft(store.draft) }, "Request approval"),
          h(Button, { primary: true, disabled: disabled || !store.approvalId, onClick: applyDraft }, "Apply"),
        ),
        store.validation ? h("div", { className: "xb-config-result" }, h("strong", null, `Validation: ${store.validation.valid ? "valid" : "invalid"}`), h(Diagnostics, { items: store.validation.diagnostics })) : null,
        store.preview ? h("div", { className: "xb-config-result" }, h("strong", null, `Preview: ${store.preview.status}`), h("span", { className: "xb-config-meta" }, `${store.preview.files?.length || 0} file(s) · ${store.preview.approvalRequired ? "approval required" : "no approval"}`), h(Diagnostics, { items: [...(store.preview.risks || []), ...(store.preview.diagnostics || [])] })) : null,
        h(HistoryPanel, { store }),
      );
    }

    function HistoryPanel({ store }) {
      if (!store.selectedProjectId) return null;
      if (!Array.isArray(store.history) || store.history.length === 0) return h("div", { className: "xb-config-history" }, h("h3", null, "History"), h("p", { className: "xb-config-muted" }, "No recorded revisions."));
      return h("div", { className: "xb-config-history" }, h("h3", null, "History"), store.history.map((entry) => h("div", { className: "xb-config-history-row", key: entry.revision }, h("div", null, h("strong", null, entry.revision), h("span", { className: "xb-config-meta" }, `${entry.operation} · ${entry.actor}`)), h(Button, { disabled: Boolean(store.busy) || !entry.canRollback, onClick: () => beginRollback(entry.revision) }, "Rollback"))), store.rollbackDraft ? h("div", { className: "xb-config-rollback" }, h("strong", null, `Rollback ${store.rollbackRevision}`), h("div", { className: "xb-config-actions" }, h(Button, { disabled: Boolean(store.busy), onClick: () => requestApprovalForDraft(store.rollbackDraft, true) }, "Request approval"), h(Button, { primary: true, disabled: Boolean(store.busy) || !store.rollbackApprovalId, onClick: applyRollback }, "Apply rollback"))) : null);
    }

    function WorkspaceConsole({ store }) {
      const editing = Boolean(store.config);
      return h("section", { className: "xb-config-console", "aria-label": "Xiaobai Workspace" },
        h("div", { className: "xb-config-header" }, h("h1", null, "Xiaobai Workspace"), h("span", { className: `xb-config-status xb-config-status-${store.phase}` }, store.phase)),
        h(Diagnostics, { items: store.notice }),
        store.phase === "missing" && !store.workspace ? h("div", { className: "xb-config-empty" }, h("p", null, "Select a Host Workspace to manage Projects."), h(Button, { primary: true, disabled: Boolean(store.busy), onClick: chooseWorkspace }, "Choose Workspace directory")) : null,
        store.workspace && !editing ? h("div", { className: "xb-config-list" }, h("div", { className: "xb-config-list-head" }, h("h2", null, "Projects"), h(Button, { primary: true, disabled: Boolean(store.busy), onClick: newProject }, "+ New Project")), h(ProjectList, { store })) : null,
        editing ? h(Editor, { store }) : null,
      );
    }

    function ConsoleView() {
      const store = useStore();
      useEffect(() => {
        if (store.remote && !store.workspace && !store.busy) void loadProjects();
      }, [store.remote]);
      return h(WorkspaceConsole, { store });
    }

    function SidebarShortcut({ wide }) {
      return h("button", { type: "button", className: `xb-config-shortcut${wide ? " wide" : ""}`, onClick: () => { state.overlay = true; notify(); }, title: "Open Xiaobai Workspace", "aria-label": "Open Xiaobai Workspace" }, "+ Xiaobai");
    }

    function OverlayView() {
      const store = useStore();
      useEffect(() => {
        if (!store.overlay) return undefined;
        const closeOnEscape = (event) => { if (event.key === "Escape") { state.overlay = false; notify(); } };
        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
      }, [store.overlay]);
      if (!store.overlay) return null;
      return h("div", { className: "xb-config-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Xiaobai Workspace" }, h("div", { className: "xb-config-overlay-panel" }, h("button", { type: "button", className: "xb-config-icon-button xb-config-overlay-close", onClick: () => { state.overlay = false; notify(); }, "aria-label": "Close Workspace console", title: "Close" }, "×"), h(WorkspaceConsole, { store })));
    }

    const OVERLAY_CSS = ".xb-config-overlay-panel{position:relative}.xb-config-overlay .xb-config-header{padding-right:92px}.xb-config-overlay-close{right:64px}";
    const CSS = `
.xb-config-console{box-sizing:border-box;width:100%;max-width:900px;padding:8px 0;color:var(--dsw-alias-label-primary);font:inherit}.xb-config-header,.xb-config-list-head,.xb-config-editor-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.xb-config-header h1,.xb-config-list-head h2,.xb-config-editor-head h2,.xb-config-history h3{margin:0;font-size:18px;line-height:26px;font-weight:600}.xb-config-history h3{font-size:14px;margin-bottom:8px}.xb-config-status,.xb-config-meta,.xb-config-muted{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.xb-config-status-conflict,.xb-config-status-invalid,.xb-config-status-error{color:var(--dsw-alias-state-error-primary)}.xb-config-status-loaded,.xb-config-status-approval{color:var(--dsw-alias-state-success-primary)}.xb-config-button{min-height:32px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}.xb-config-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.xb-config-button:disabled{opacity:.45;cursor:not-allowed}.xb-config-button.primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted)}.xb-config-icon-button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:22px;line-height:28px;cursor:pointer}.xb-config-projects{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}.xb-config-project{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.xb-config-project-main{display:flex;flex-direction:column;min-width:0;gap:3px}.xb-config-empty{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}.xb-config-editor{margin-top:12px}.xb-config-section{min-width:0;margin:16px 0 0;padding:12px 0 0;border:0;border-top:1px solid var(--dsw-alias-border-l1)}.xb-config-section legend{padding:0 8px 0 0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}.xb-config-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.xb-config-field{display:flex;flex-direction:column;gap:5px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.xb-config-field input,.xb-config-field select{box-sizing:border-box;width:100%;min-height:34px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}.xb-config-field input:disabled{opacity:.72}.xb-config-check{display:flex;align-items:center;align-self:end;min-height:34px;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px}.xb-config-check input{margin:0}.xb-config-field-action{display:flex;align-items:end;min-height:34px}.xb-config-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.xb-config-diagnostics{display:flex;flex-direction:column;gap:5px;margin-top:12px;font-size:12px;line-height:18px}.xb-config-diagnostic{padding:6px 8px;border-left:3px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}.xb-config-error{border-left-color:var(--dsw-alias-state-error-primary)}.xb-config-warning{border-left-color:var(--dsw-alias-state-warn-primary)}.xb-config-result,.xb-config-history{display:flex;flex-direction:column;gap:5px;margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:13px}.xb-config-history-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.xb-config-history-row>div{display:flex;flex-direction:column;gap:2px;min-width:0}.xb-config-rollback{margin-top:12px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}.xb-config-shortcut{margin:4px;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.xb-config-shortcut:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.xb-config-overlay{position:fixed;inset:0;z-index:100;display:flex;justify-content:flex-end;background:rgba(0,0,0,.22)}.xb-config-overlay-panel{box-sizing:border-box;width:min(820px,100vw);height:100%;overflow:auto;padding:24px;background:var(--dsw-alias-bg-base);box-shadow:-8px 0 24px rgba(0,0,0,.18)}.xb-config-overlay-close{position:absolute;top:14px;right:18px}@media(max-width:600px){.xb-config-fields{grid-template-columns:minmax(0,1fr)}.xb-config-empty{align-items:flex-start;flex-direction:column}.xb-config-overlay-panel{padding:16px}.xb-config-actions .xb-config-button{flex:1 1 140px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots) return;
      if (typeof document !== "undefined" && !document.querySelector("style[data-plugin-css='xiaobai-dsh-plugin']")) {
        const style = document.createElement("style");
        style.dataset.pluginCss = "xiaobai-dsh-plugin";
        style.textContent = `${CSS}${OVERLAY_CSS}`;
        document.head.appendChild(style);
      }
      ctx.effect(async () => {
        try {
          const dispose = await ctx.remote.$mount(REMOTE);
          state.remote = ctx.reflect.get("remote.xiaobaiConfig");
          state.remoteStatus = "mounted";
          notify();
          return () => { state.remote = undefined; state.remoteStatus = "unmounted"; notify(); void dispose?.(); };
        } catch (error) {
          state.remoteStatus = "error";
          state.phase = "error";
          state.notice = [{ code: "REMOTE_MOUNT_FAILED", severity: "error", message: errorText(error) }];
          notify();
          return undefined;
        }
      }, "xiaobai-dsh-plugin: remote");
      slots.inject("settings.section", () => slots.register({ name: "settings.section", id: "xiaobai-workspace", order: 60, label: "Xiaobai Workspace" }, ConsoleView));
      slots.inject("sidebar.footer.action", () => slots.register({ name: "sidebar.footer.action", id: "xiaobai-workspace-shortcut", order: 60, label: "Xiaobai Workspace" }, SidebarShortcut));
      slots.inject("shell.overlay", () => slots.register({ name: "shell.overlay", id: "xiaobai-workspace-overlay", order: 60, label: "Xiaobai Workspace" }, OverlayView));
    }

    exports.name = "@xiaobai/dsh-plugin";
    exports.inject = ["slots", "remote"];
    exports.apply = apply;
    return module.exports;
  },
});
