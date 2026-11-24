---
name: jn-contact-purpose-classification
description: Use when classifying JobNimbus contact records as plain contacts or contacts used as jobs, splitting contact data by account features (enabled_features Jobs / JobsV2), or defining populations for contact research, Snowflake queries or Contact Platform API decisions. Phrasings include "contact as job", "Contact Category", "Job Workflow", "CC vs CJ", "legacy contacts account", "JobsV2 account", "which contacts are jobs", "no active job", "account segment", "P7b classification".
---

# Contact purpose classification

Danny Warren's definitions for JobNimbus contact records. They are the authority for every classification of contacts; P7b's workflow rule (`job-management/docs/research/202610-contact-research/P7b-contact-job-separation.md` §1.2) is one input to it, never the whole rule.

Two separate concepts. Always state both for any contact or population.

## C1. Account features (segment)

Read from the account's `enabled_features`.

| Segment | `enabled_features` |
| --- | --- |
| **LC** Legacy Contacts | lacks Jobs and JobsV2 |
| **LJ** Legacy Jobs | contains Jobs, lacks JobsV2 |
| **J2** Jobs V2 | contains Jobs and JobsV2 |

An account with JobsV2 but not Jobs should not exist. If one does, treat it as **LC**.

## C2. Contact record's purpose

| Purpose | Meaning |
| --- | --- |
| **CC** | The contact belongs to a workflow defining categories. In J2 accounts these workflows often hold only New, Active, Inactive |
| **CJ** | The contact belongs to a workflow defining jobs: a contact used as a job |

- A contact associated to a job record is **CC**. The job link shows the contact's purpose is just a contact.
- A contact not associated to a job takes its purpose from its workflow.
- The workflow test looks at the workflow for lead/sales stages, financials and similar job payload. P7b §1.2 is the existing measured workflow-level rule; it applies neither the account segment nor the job link.

## The rule

```
segment(account):
  Jobs and JobsV2  -> J2
  Jobs, no JobsV2  -> LJ
  otherwise        -> LC

purpose(contact):
  J2 -> CC                              always
  LJ -> CC if associated to a job
        else workflow test
  LC -> workflow test                   job links are not used

workflow test: workflow defines categories -> CC; defines jobs -> CJ
```

Purpose is per contact, not per workflow: in LJ one workflow can hold both CC and CJ contacts.

## Examples

| Account `enabled_features` | Contact | Segment | Purpose |
| --- | --- | --- | --- |
| Jobs, JobsV2 | Workflow with Lead / Sold / In Production stages, on no job | J2 | CC |
| Jobs | Job-like workflow (schedule dates, invoices), primary on a job | LJ | CC |
| Jobs | Same workflow, on no job | LJ | CJ |
| none | Workflow New / Active / Inactive, no job payload | LC | CC |
| JobsV2 only | Workflow with Sold / Completed and invoices, on no job | LC | CJ |

## Using it in data work

- Every contact population carries both labels: segment (LC / LJ / J2) and purpose (CC / CJ). Query and report counts as segment × purpose, never by one label alone: purpose alone hides that J2 is CC by definition, segment alone mixes CC and CJ.
- Never report "has a job" / "no active job" as a population on its own. It mixes LJ/J2 contacts not yet on a job with LC contacts whose workflow makes them jobs.
- Agree the population with Danny before running any query that depends on it.

## Common mistakes

| Mistake | Correct |
| --- | --- |
| Classifying by P7b's workflow rule alone | Segment first; P7b only stands in for the workflow test |
| Calling a J2 contact a contact-as-job because its workflow has Sold / In Production stages | J2 contacts are always CC |
| Keeping a job-linked LJ contact as CJ because its workflow is job-like | A job link makes an LJ contact CC |
| Using job links in LC accounts | LC uses the workflow test only |
| Treating a JobsV2-only account as its own segment | It is LC |
