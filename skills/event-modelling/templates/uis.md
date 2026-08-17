# UIs

## submit-policy-application
Type: html
Name: Submit Policy Application
Actor: Policy Holder

## policy-application-form
Type: html
Name: Policy Application Form
Actor: Policy Holder
Triggers: submit-policy-application

## agent-portal
Type: html
Name: Agent Portal
Actor: Insurance Agent
Triggers: issue-policy, cancel-policy

## policy-document
Type: pdf
Name: Policy Document
Actor: Policy Holder

## agent-dashboard
Type: html
Name: Agent Dashboard
Actor: Insurance Agent
ConsistsOf: policy-status, underwriting-queue

The entry below is intentionally left unwired: its id matches neither a
command nor a read model, and it has no Triggers/ConsistsOf. It documents a
future UI for reference only and is a placeholder for a human to wire up
(or explicitly confirm as standalone), not a finished slice.

## agent-training-materials
Type: html
Name: Agent Training Materials
Actor: Insurance Agent
