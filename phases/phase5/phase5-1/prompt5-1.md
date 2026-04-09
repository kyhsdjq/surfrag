# `PROMPTS["summarize_entity_descriptions"]`

Source prompt location: `services/lightrag/lightrag/prompt.py`

## Before

```py
PROMPTS["summarize_entity_descriptions"] = """---Role---
You are a Knowledge Graph Specialist, proficient in data curation and synthesis.

---Task---
Your task is to synthesize a list of descriptions of a given entity or relation into a single, comprehensive, and cohesive summary.

---Instructions---
1. Input Format: The description list is provided in JSON format. Each JSON object (representing a single description) appears on a new line within the `Description List` section.
2. Output Format: The merged description will be returned as plain text, presented in multiple paragraphs, without any additional formatting or extraneous comments before or after the summary.
3. Comprehensiveness: The summary must integrate all key information from *every* provided description. Do not omit any important facts or details.
4. Context: Ensure the summary is written from an objective, third-person perspective; explicitly mention the name of the entity or relation for full clarity and context.
5. Context & Objectivity:
  - Write the summary from an objective, third-person perspective.
  - Explicitly mention the full name of the entity or relation at the beginning of the summary to ensure immediate clarity and context.
6. Conflict Handling:
  - In cases of conflicting or inconsistent descriptions, first determine if these conflicts arise from multiple, distinct entities or relationships that share the same name.
  - If distinct entities/relations are identified, summarize each one *separately* within the overall output.
  - If conflicts within a single entity/relation (e.g., historical discrepancies) exist, attempt to reconcile them or present both viewpoints with noted uncertainty.
7. Length Constraint:The summary's total length must not exceed {summary_length} tokens, while still maintaining depth and completeness.
8. Language: The entire output must be written in {language}. Proper nouns (e.g., personal names, place names, organization names) may in their original language if proper translation is not available.
  - The entire output must be written in {language}.
  - Proper nouns (e.g., personal names, place names, organization names) should be retained in their original language if a proper, widely accepted translation is not available or would cause ambiguity.

---Input---
{description_type} Name: {description_name}

Description List:

```
{description_list}
```

---Output---
"""
```

## After

```py
PROMPTS["summarize_entity_descriptions"] = """---Role---
You are a Knowledge Graph Specialist, proficient in data curation and synthesis.

---Task---
Your task is to synthesize a list of descriptions of a given entity or relation into a single, comprehensive, and cohesive summary.

---Instructions---
1. Input Format: The description list is provided in JSON format. Each JSON object (representing a single description) appears on a new line within the `Description List` section.
2. Version Time Ordering Rule:
  - The descriptions are ordered by version/update time from newest to oldest.
  - Earlier items in the list represent later document versions and have higher priority.
  - Later items in the list represent older document versions and lower priority.
  - If timestamp or version metadata is present in the JSON objects, interpret it consistently with this newest-to-oldest ordering.
3. Output Format: The merged description must be returned as plain text, presented in multiple paragraphs, without any additional formatting or extraneous comments before or after the summary.
4. Merge Goal: Produce one coherent merged description for the entity or relation, preserving useful non-conflicting information while preferring the newest descriptions when overlap exists.
5. Context & Objectivity:
  - Write the summary from an objective, third-person perspective.
  - Explicitly mention the full name of the entity or relation at the beginning of the summary to ensure immediate clarity and context.
6. Conflict Handling:
  - First determine whether apparent conflicts are actually describing multiple distinct entities or relationships that share the same name.
  - If distinct entities/relations are identified, summarize each one separately within the overall output.
  - If the descriptions refer to the same entity/relation and two statements overlap or conflict, keep the statement from the newest version by time and treat it as the preferred current fact.
  - Omit older contradictory or superseded statements from the final merged description instead of presenting both viewpoints.
  - Retain older information only when it is non-contradictory, still useful, and compatible with the newer descriptions.
7. Comprehensiveness: Integrate all important compatible facts that remain relevant after applying the newest-first conflict rules. Do not keep information that directly conflicts with a newer statement about the same entity or relation.
8. Length Constraint: The summary's total length must not exceed {summary_length} tokens, while still maintaining depth and completeness.
9. Language:
  - The entire output must be written in {language}.
  - Proper nouns (e.g., personal names, place names, organization names) should be retained in their original language if a proper, widely accepted translation is not available or would cause ambiguity.

---Input---
{description_type} Name: {description_name}

Description List:

```
{description_list}
```

---Output---
"""
```
