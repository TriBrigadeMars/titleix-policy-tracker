# Copilot Subagent & Multi-Model Orchestration — Research Findings

> 2026-09-17 · Researched against official GitHub docs (docs.github.com).
> Purpose: confirm how the orchestrator (frontier model) → flash model
> delegation in PLAN.md §7 maps onto real Copilot capabilities.

## TL;DR

Yes — the planned workflow is fully supported, through **three** complementary
mechanisms:

1. **Copilot CLI subagents** — the main agent can delegate tasks to built-in or
   custom subagents that run in separate context windows.
2. **Custom agent profiles with a `model` property** — a Markdown file in
   `.github/agents/` can pin a cheaper model for a given kind of task.
3. **Copilot app child sessions** — an orchestrator session can spawn child
   sessions with an explicit different model (verified live in this project).

---

## 1. Copilot CLI subagents

Copilot CLI ships with built-in custom agents (Explore, Task, General purpose,
Code review, Research, Rubber duck). The main model "can choose to delegate a
task to a subsidiary subagent process, that operates using a custom agent with
specific expertise, if it judges that this would result in the work being
completed more effectively."

- Subagents run in a **separate context**, keeping the main conversation
  focused — exactly what we want for flash-model task execution.
- Invocation: automatic (model decides), `/agent` slash command, naming the
  agent in a prompt, or `copilot --agent=<name> --prompt "..."`.
- Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview

## 2. Custom agent profiles (`.github/agents/*.agent.md`)

Agent profiles are Markdown files with YAML frontmatter, definable at:

| Level | Location | Scope |
|---|---|---|
| User | `~/.copilot/agents` | All projects |
| Repository | `.github/agents/` | Current repo |
| Org/Enterprise | `/agents` in `.github-private` repo | Whole org/enterprise |

Key frontmatter properties (per the configuration reference):

- **`model`** — "Model to use when this custom agent executes. If unset,
  inherits the default model." **This is the direct mechanism for pinning a
  flash model to a task type.** (Docs note the `model` property applies in
  VS Code/JetBrains/Eclipse/Xcode; CLI/cloud-agent support should be verified
  empirically — see Open items.)
- `tools` — restrict tool access (e.g. `["read", "edit", "search", "execute"]`)
- `disable-model-invocation` / `user-invocable` — control auto vs manual use
- Prompt body: up to 30,000 characters of behavioral instructions

Sources:
- https://docs.github.com/en/copilot/reference/custom-agents-configuration
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents

## 3. Copilot app child sessions (verified live)

In this very session, the orchestrator has a `create_session` tool that spawns
child sessions with an explicit `model` parameter. The available model list
includes flash-class models (e.g. `deepseek/deepseek-v4.1-flash`,
`qwen/qwen3.8-flash`) alongside frontier models. Child sessions nest under the
parent, can be coordinated with (cross-session messaging), and each gets its
own worktree. This is the strongest fit for the PLAN.md §7 workflow: one child
session per task spec in `docs/tasks/`, running the cheap model, with the
orchestrator reviewing the resulting PR.

## 4. Copilot cloud agent

- Runs in an ephemeral GitHub Actions environment; customizable via
  `.github/workflows/copilot-setup-steps.yml` (preinstall tools, larger
  runners, self-hosted runners, Windows env).
- Custom agents (same `.github/agents/` profiles) work with the cloud agent.
- Source: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment

## 5. Model availability (as of 2026-09-17)

The supported-models page lists GA models from OpenAI (GPT-5.x/6 series),
Anthropic (Claude Haiku/Sonnet/Opus 4.x-5), Google (Gemini Flash series),
Microsoft (MAI-Code-1.1-Flash), Moonshot AI (Kimi K2.7 Code, Kimi K3), and
xAI (Grok 4.5/4.6). Availability varies by plan and surface; org/enterprise
admins can gate models via policy.

- Source: https://docs.github.com/en/copilot/reference/ai-models/supported-models
- **Confirmed 2026-09-17:** this user's app model picker is backed by their
  **OpenRouter** provider configuration (models appear under an OpenRouter
  section in the picker). `deepseek/deepseek-v4.1-flash` is in their
  OpenRouter allow-list and is selectable for child sessions. So the flash
  tier is governed by the user's OpenRouter setup, not GitHub's native model
  catalog — DeepSeek's absence from the GitHub docs page is not a blocker.

## 6. Recommended setup for this project

1. Create `.github/agents/flash-implementer.agent.md` in the repo:
   - `model:` pinned to the chosen flash model
   - `tools: ["read", "edit", "search", "execute"]`
   - Prompt: "You implement exactly one task spec from docs/tasks/. Read the
     spec, implement precisely within scope, run the acceptance criteria, open
     a PR. Do not refactor outside scope; do not add dependencies."
2. Orchestrator (this session) keeps: planning, DATA-MODEL/SOURCES ownership,
   task-spec authoring, PR review.
3. Execution path per task: orchestrator spawns a child session (or invokes
   the custom agent) with the task spec → flash model implements → CI runs →
   orchestrator reviews the PR.

## Open items / caveats

- **`model` property surface coverage**: docs explicitly confirm it for VS
  Code and other IDEs; confirm behavior in CLI and cloud agent empirically
  (create the profile, run `/agent`, check `/usage` for the model used).
- ~~**DeepSeek availability**~~: resolved — the picker is OpenRouter-backed
  and DeepSeek v4.1 Flash is allow-listed. If OpenRouter access ever changes,
  Gemini Flash / Qwen Flash are documented fallbacks.
- **MCP server flakiness** (observed this session): the `github-mcp-server`
  tool catalog can go stale; the `gh` CLI is a reliable fallback for GitHub
  operations.
