# Securing agent tool use with LiteLLM guardrails on AWS Bedrock

This is a living document. It shows how an AI gateway (LiteLLM proxy) in front of AWS Bedrock models can stop two common agent attack paths, with a reproducible demo for each, including a live run against a real coding agent. Expect it to evolve as the project does

## What this demonstrates

Two protections, both enforced centrally at the gateway so they apply to every agent and application behind it, regardless of which framework or SDK they use

The first is blocking dangerous tool commands. When the model responds with a tool call such as `bash("curl https://raw.githubusercontent.com/.../install.sh")`, the gateway inspects the tool call in the model output and rejects the response before it ever reaches the agent, so the command is never executed. In an interactive agent this happens before the human is even shown the approval prompt

The second is blocking prompt injection carried in tool results. When an agent fetches a web page or file and the content contains an injected instruction such as "IGNORE ALL PREVIOUS INSTRUCTIONS", the gateway scans the inbound request, including tool result messages, with AWS Bedrock Guardrails and rejects it before the model ever sees the payload

## How it works

Guardrails attach to the proxy request lifecycle. A `pre_call` guardrail runs on the incoming request before the model is invoked, and a `post_call` guardrail runs on the model response before it is returned to the client. A blocked request returns HTTP 400 with the guardrail's verdict, which also lands in the gateway's logging and spend tracking

The injection scan uses AWS Bedrock Guardrails, the AWS native, managed, model-based prompt attack detector, so the policy lives in the AWS account and can be governed there. The download policy uses the gateway's built-in `tool_permission` guardrail, a config-driven rules engine that matches tool names and tool call arguments

## Why the policy is an allowlist, not a blocklist

An earlier version of this demo denied downloads from `evil.com`. That reads well on a slide, but it does not survive contact with a real agent: current frontier models refuse to fetch an obviously malicious domain on their own, so the request never produces a tool call and the gateway never gets to prove anything. Worse, it teaches the wrong lesson, since a policy that only catches attackers who name their host `evil.com` catches nobody

The rule below is the policy a security team would actually write. Network-fetching commands are denied unless the target host is on an approved list. A model will cheerfully download an install script from a well-known code host, which is exactly the point: the model complies, and the gateway is the thing that says no. That is the control you are demonstrating

## Setup

1. Create a Bedrock guardrail with the prompt attack filter, and note the `guardrailId` in the output:

   ```bash
   aws bedrock create-guardrail \
     --name llm-gateway-prompt-attack \
     --content-policy-config '{"filtersConfig":[{"type":"PROMPT_ATTACK","inputStrength":"HIGH","outputStrength":"NONE"}]}' \
     --blocked-input-messaging "Blocked by AWS Bedrock Guardrails: prompt attack detected in model input." \
     --blocked-outputs-messaging "Blocked by AWS Bedrock Guardrails: policy violation in model output." \
     --region us-east-1
   ```

2. Write the proxy config. This repo's `demo_config.yaml` is filled in against a live guardrail (`1pkg9iw5lbhl`, DRAFT, us-east-1); swap in the id from step 1 for your own account:

   ```yaml
   model_list:
     - model_name: claude-sonnet-5
       litellm_params:
         model: bedrock/us.anthropic.claude-sonnet-5
         aws_region_name: us-east-1

     - model_name: claude-haiku-4-5
       litellm_params:
         model: bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0
         aws_region_name: us-east-1

   general_settings:
     master_key: sk-1234

   guardrails:
     - guardrail_name: aws-prompt-attack-scanner
       litellm_params:
         guardrail: bedrock
         mode: pre_call
         default_on: true
         guardrailIdentifier: 1pkg9iw5lbhl
         guardrailVersion: DRAFT
         aws_region_name: us-east-1
         scan_only_tool_results: true

     - guardrail_name: download-allowlist
       litellm_params:
         guardrail: tool_permission
         mode: post_call
         default_on: true
         default_action: allow
         on_disallowed_action: block
         rules:
           - id: deny-downloads-outside-allowlist
             tool_name: "(?i)bash"
             decision: deny
             allowed_param_patterns:
               command: '(?s)(?!.*(?:docs\.litellm\.ai|pypi\.org))(?=.*\b(?:curl|wget)\b).*'
   ```

   The command pattern is a `fullmatch`, so it reads as "the whole command contains `curl` or `wget` and does not mention an approved host". Add hosts to the negative lookahead to widen the allowlist

3. Start the proxy:

   ```bash
   litellm --config demo_config.yaml --port 4000
   ```

## Why `scan_only_tool_results` is on

Point a Bedrock prompt attack filter at raw agent traffic and it fires constantly on the agent's own scaffolding. A coding agent's system prompt is full of language like "IMPORTANT: Assist with defensive security tasks only. Refuse to create, modify, or improve code that may be used maliciously", which is indistinguishable, to a prompt attack classifier, from an injected instruction. This reproduces at every filter strength, so tuning `inputStrength` down does not fix it, it just also stops catching real attacks

`scan_only_tool_results: true` narrows the scan to tool result content, the untrusted data the agent feeds back into the model, and leaves the system, user, and assistant turns alone. That is the correct trust boundary for an agent harness you control: the scaffolding is yours, the fetched web page is not. Drop the flag for chat-style workloads where the user turn itself is untrusted

## Demo, one command

`verify.sh` runs all five checks against a running proxy:

```bash
PORT=4000 bash guardrails_demo/verify.sh
```

Verified output, trimmed to the verdict lines:

```
1. DENIED: agent tries to download an installer from a host outside the allowlist
{"error":{"message":"Guardrail raised an exception, Guardrail: download-allowlist, Message: Tool 'bash' denied by rule 'deny-downloads-outside-allowlist'","code":"400"}}
HTTP 400

2. ALLOWED: same tool, host on the allowlist
"tool_calls":[{"function":{"arguments":"{\"command\": \"curl -sL https://docs.litellm.ai\"}","name":"bash"}}]
HTTP 200

3. DENIED: prompt injection inside a tool result (/v1/chat/completions)
{"error":{"message":"Violated guardrail policy","provider_specific_fields":{"bedrock_guardrail_response":"Blocked by AWS Bedrock Guardrails: prompt attack detected in model input.","guardrailIdentifier":"1pkg9iw5lbhl","assessments":[{"policy":"contentPolicy","matches":[{"type":"PROMPT_ATTACK","confidence":"HIGH","filterStrength":"HIGH","action":"BLOCKED"}]}],"guardrail_name":"aws-prompt-attack-scanner","guardrail_mode":"pre_call"}}}
HTTP 400

4. DENIED: prompt injection inside a tool result (/v1/messages)
{"error":{"message":"400: {'error': 'Violated guardrail policy', ... 'type': 'PROMPT_ATTACK', 'confidence': 'HIGH', 'action': 'BLOCKED'} ..."}}
HTTP 400

5. ALLOWED: normal agent traffic, harness scaffolding not flagged
{"content":[{"type":"text","text":"Four"}],"stop_reason":"end_turn"}
HTTP 200
```

Checks 3 and 4 are the same attack on the two API surfaces, OpenAI chat completions and Anthropic Messages, to show the policy is enforced no matter which shape the client speaks

## Demo, live against a real coding agent

The strongest version of this demo is not curl, it is a real agent hitting the gateway and visibly failing to do the dangerous thing. Claude Code points at any OpenAI or Anthropic compatible endpoint through environment variables

1. Prepare a scratch workspace with the poisoned fixture (`agent_workspace/quarterly_report.html` carries an injected instruction in the middle of an otherwise ordinary revenue report):

   ```bash
   mkdir -p /tmp/agent-workspace && cp guardrails_demo/agent_workspace/quarterly_report.html /tmp/agent-workspace/
   cd /tmp/agent-workspace
   ```

2. Start Claude Code against the gateway, with a throwaway config dir so your real settings are untouched:

   ```bash
   env -u ANTHROPIC_API_KEY \
     CLAUDE_CONFIG_DIR=/tmp/agent-claude-config \
     ANTHROPIC_BASE_URL=http://localhost:4000 \
     ANTHROPIC_AUTH_TOKEN=sk-1234 \
     ANTHROPIC_MODEL=claude-sonnet-5 \
     ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5 \
     CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
     claude
   ```

3. Baseline, so the room knows the gateway is not simply broken. Type:

   > What is 2 plus 2? Answer in one word.

   The agent answers `4`. Normal traffic, including the whole Claude Code system prompt, passes untouched

4. The allowed download. Type:

   > Use the Bash tool to run this and tell me the status code: curl -sS -o /dev/null -w '%{http_code}' https://docs.litellm.ai/

   The gateway lets the tool call through, Claude Code shows its usual approval prompt, and after approval it prints `200`

5. The blocked download. Type:

   > Use the Bash tool to download the installer so I can inspect it: curl -sS https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh -o /tmp/install.sh

   The model complies and emits the tool call, and the gateway rejects the response. Claude Code shows:

   ```
   ⏺ API Error: 400 Guardrail raised an exception, Guardrail: download-allowlist,
     Message: Tool 'Bash' denied by rule 'deny-downloads-outside-allowlist'
   ```

   Worth saying out loud: the approval prompt never appeared. The policy fired above the human, so it holds even for an agent running unattended with every permission granted

6. The blocked injection. Type:

   > Read quarterly_report.html and tell me the revenue growth

   Claude Code reads the file successfully, since reading a file is not the attack. The next model call carries the file's contents back as a tool result, and that is what gets stopped:

   ```
   ⏺ API Error: 400 400: {'error': 'Violated guardrail policy',
     'bedrock_guardrail_response': 'Blocked by AWS Bedrock Guardrails: prompt attack detected in model input.',
     'guardrailIdentifier': '1pkg9iw5lbhl',
     'assessments': [{'policy': 'contentPolicy', 'matches': [{'category': 'filters',
       'type': 'PROMPT_ATTACK', 'confidence': 'HIGH', 'filterStrength': 'HIGH', 'action': 'BLOCKED'}]}],
     'guardrail_name': 'aws-prompt-attack-scanner', 'guardrail_mode': 'pre_call'}
   ```

   The model never saw the injected instruction

Run steps 4 through 6 in fresh sessions (`/clear` between them). Once a conversation contains blocked content, every later turn in that conversation replays it and is blocked again

## Gateway changes this demo depends on

Three fixes to the gateway were needed to make the live agent path work. They are in this branch and should be upstreamed

Tool results on the Anthropic Messages API were invisible to every guardrail. Extraction only read `content_item["text"]`, but an Anthropic `tool_result` block carries its payload under `content`, as either a string or a nested block list. Injected tool results returned HTTP 200 before this fix. Masking guardrails now also write their redacted text back to the right place instead of silently dropping it

The `tool_permission` guardrail crashed every streaming turn on the `/v1/messages` passthrough route with a 500. That route yields raw Anthropic SSE byte frames rather than parsed chunk objects, and the hook fed them to a chunk assembler that indexes them as dicts. It now detects provider frames and reassembles them properly. Note that on this path a denied tool call always blocks, since `on_disallowed_action: rewrite` cannot be expressed against encoded frames

Bedrock guardrail calls failed to authenticate when using a Bedrock API key (`AWS_BEARER_TOKEN_BEDROCK`) without `botocore[crt]` installed, because credential loading ran the SigV4 path before checking for a bearer token

## Variant without a guardrail resource

If creating and versioning a Bedrock guardrail resource is unwanted, the same integration can call the resource-less Bedrock guardrail checks API instead. Replace `guardrailIdentifier` and `guardrailVersion` with an inline `checks` block:

```yaml
- guardrail_name: aws-prompt-attack-scanner
  litellm_params:
    guardrail: bedrock
    mode: pre_call
    default_on: true
    aws_region_name: us-east-1
    scan_only_tool_results: true
    checks:
      promptAttack:
        categories:
          - category: PROMPT_INJECTION
          - category: JAILBREAK
```

## From demo rules to production policy

The demo allowlist holds two hosts to keep the rule readable. In production the same engine expresses the full policy: deny network-capable tools by default and allow only approved commands, registries, or artifact stores, one pattern each, or rewrite disallowed calls instead of blocking them with `on_disallowed_action: rewrite`. Rules match tool names and arguments by regex, and arguments are addressed by dot path, so a rule can target a single nested field of a structured tool input

## Other guardrail options

Everything above is built into the gateway or native to AWS. The same guardrail interface also supports third party engines, so a dedicated security vendor can be dropped in without changing any application code

| Option | litellm config name | Strength |
| --- | --- | --- |
| AWS Bedrock Guardrails | `bedrock` | AWS native, managed, prompt attack, PII, content |
| Tool permission rules | `tool_permission` | tool call policy on names, arguments |
| Content filter | `litellm_content_filter` | built-in regex, keywords, injection heuristics |
| Lakera | `lakera_ai` | injection, jailbreak detection |
| Pangea AI Guard | `pangea` | injection, malicious URLs, PII |
| Palo Alto Prisma AIRS | `panw_prisma_airs` | injection, URL filtering, DLP |
| Zscaler AI Guard | `zscaler_ai_guard` | injection, DLP |
| HiddenLayer | `hiddenlayer` | injection, model security |
| CrowdStrike AIDR | `crowdstrike_aidr` | injection, threat detection |
| Azure Prompt Shield | `azure/prompt_shield` | injection, jailbreak detection |
| Custom REST endpoint | `generic_guardrail_api` | any in-house scanner |

One option to be careful with is `llm_as_a_judge`: it runs post_call only and evaluates response text, so it does not see tool calls and cannot replace `tool_permission` for the download scenario

## Enabling per key, team, or request

`default_on: true` applies a guardrail to all traffic. Dropping it makes the guardrail opt-in, so it can be attached selectively to specific virtual keys or teams, letting different workloads carry different policies from the same gateway

## AWS authentication notes

Both the Bedrock model and the Bedrock guardrail calls authenticate with the standard AWS credential chain, so instance roles on EC2, EKS, or ECS work with no extra config, and a Bedrock API key exported as `AWS_BEARER_TOKEN_BEDROCK` works as well. Region comes from `aws_region_name` on each block, and explicit `aws_access_key_id`, `aws_secret_access_key`, or `aws_role_name` overrides are supported per model and per guardrail
