# Fix Tests Skill

## Purpose

Diagnose failing test jobs and produce one isolated repair plan per failure cluster.

## Decision Rules

1. Prefer a failing test with a direct stack trace.
2. Check recent commits before changing production code.
3. Add coverage for regressions, not only snapshots.
