# Pending decision JSON format

## Output pending

**Output pending** downloads a JSON array. Each pending paper contains only its versioned arXiv ID and every detected disclosure passage.

```json
[
  {
    "arxiv_id": "2608.19483v1",
    "disclosures": [
      {
        "quotation": "Exact detected passage",
        "location": "PDF page 9",
        "page": 9
      }
    ]
  }
]
```

## Input decisions

**Input decisions** accepts one JSON array. Each `arxiv_id` must exactly match a currently pending versioned arXiv ID. An arXiv ID may appear only once.

Reject:

```json
[
  {
    "arxiv_id": "2608.00001v1",
    "decision": "reject"
  }
]
```

Approve:

```json
[
  {
    "arxiv_id": "2608.19483v1",
    "decision": "approve",
    "quotation": "Exact detected passage",
    "location": "PDF page 9",
    "page": 9,
    "disclosure_classification": "substantial_proof_generation"
  }
]
```

For approval, `quotation`, `location`, and `page` must exactly match one disclosure entry from the exported pending file.

Supported `disclosure_classification` values:

| Value | Multiplier |
| --- | ---: |
| `proofreading_grammar` | 1 |
| `translation` | 1 |
| `formatting_typesetting` | 1 |
| `literature_search` | 2 |
| `citation_assistance` | 2 |
| `brainstorming_outlining` | 2 |
| `code_assistance` | 2 |
| `computational_support` | 3 |
| `rewriting_existing_text` | 4 |
| `limited_text_drafting` | 5 |
| `mathematical_examples_conjectures` | 6 |
| `substantial_text_generation` | 7 |
| `proof_ideas_steps` | 8 |
| `complete_proof_drafting` | 9 |
| `substantial_proof_generation` | 10 |
| `substantial_mathematical_content` | 10 |

The dashboard validates the complete file before applying any decision. It processes valid decisions in file order and stays on the pending list afterward.
