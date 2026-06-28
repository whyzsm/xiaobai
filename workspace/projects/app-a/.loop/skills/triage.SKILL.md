# Triage Skill

## Purpose

Read CI failures, open issues, recent commits, and previous loop memory. Select findings that are worth action today.

## Inputs

- CI status
- Open issues
- Recent commits
- Previous state file
- Existing inbox

## Decision Rules

Prioritize:

1. Broken main branch
2. Repeated CI failure
3. User-facing regression
4. Issue with clear reproduction

Do not act on:

1. Vague issue without reproduction
2. Large refactor request
3. Security-sensitive change without human approval

## Output

Write a finding list with:

- title
- evidence
- suspected area
- suggested next action
- risk level
