#!/usr/bin/env python3
import html
import re
import time

from common import API_SLEEP_SEC, JiraClient, chunks, issue_key_range, log_err, log_ok

CONFLUENCE_PAGE_ID = "163842"
DEFAULT_DOD_ITEMS = [
    "Code covered with unit tests (>= 80% for new lines)",
    "Integration tests updated or added",
    "E2E test added for critical user flow (if affected)",
    "PR reviewed with at least 1 approval",
    "All automated checks passed (lint + unit + integration + SAST)",
    "Functionality verified on staging",
    "Documentation updated if API changed",
    "Acceptance Criteria confirmed by PO",
]


def strip_tags(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def parse_dod_items(storage_html: str):
    items = []

    # Prefer explicit list items.
    for li in re.findall(r"<li[^>]*>(.*?)</li>", storage_html, flags=re.IGNORECASE | re.DOTALL):
        cleaned = strip_tags(li)
        if cleaned:
            items.append(cleaned)

    # Fallback: checkbox-style lines.
    if not items:
        plain = strip_tags(storage_html)
        for line in plain.splitlines():
            line = line.strip()
            if re.match(r"^[☐☑✅]\s+", line):
                items.append(re.sub(r"^[☐☑✅]\s+", "", line).strip())

    deduped = []
    seen = set()
    for item in items:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped


def dod_section(dod_items):
    return [
        {
            "type": "heading",
            "attrs": {"level": 3},
            "content": [{"type": "text", "text": "Definition of Done"}],
        },
        {
            "type": "bulletList",
            "content": [
                {
                    "type": "listItem",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": item}]}],
                }
                for item in dod_items
            ],
        },
    ]


def has_dod_heading(description):
    if not description:
        return False
    for node in description.get("content", []):
        if node.get("type") == "heading":
            text = ""
            for c in node.get("content", []):
                if c.get("type") == "text":
                    text += c.get("text", "")
            if text.strip().lower() == "definition of done":
                return True
    return False


def main():
    client = JiraClient()
    conf = client.request(
        "GET",
        f"/wiki/rest/api/content/{CONFLUENCE_PAGE_ID}?expand=body.storage",
        expect=(200,),
    )
    storage_html = conf.get("body", {}).get("storage", {}).get("value", "")
    items = parse_dod_items(storage_html)
    if not items:
        items = list(DEFAULT_DOD_ITEMS)

    for batch in chunks(issue_key_range(44, 112), 10):
        for key in batch:
            try:
                issue = client.request(
                    "GET",
                    f"/rest/api/3/issue/{key}?fields=description",
                    expect=(200,),
                )
                description = issue.get("fields", {}).get("description")
                if has_dod_heading(description):
                    log_ok(key, "DoD already present")
                    continue
                if not description:
                    description = {"type": "doc", "version": 1, "content": []}
                description.setdefault("content", [])
                description["content"].extend(dod_section(items))

                client.request(
                    "PUT",
                    f"/rest/api/3/issue/{key}",
                    {"fields": {"description": description}},
                    expect=(204,),
                )
                log_ok(key, "DoD checklist appended")
            except Exception as e:
                log_err(key, e)
            time.sleep(API_SLEEP_SEC)


if __name__ == "__main__":
    main()
