#!/usr/bin/env python3
import re
import time

from common import API_SLEEP_SEC, JiraClient, chunks, issue_key_range, log_err, log_ok

STORY_THEME_LABELS = {
    **{f"CAS-{i}": "security" for i in range(21, 24)},
    **{f"CAS-{i}": "compliance" for i in range(24, 28)},
    **{f"CAS-{i}": "trust" for i in range(28, 32)},
    **{f"CAS-{i}": "payments" for i in range(32, 35)},
    **{f"CAS-{i}": "retention" for i in range(35, 38)},
    **{f"CAS-{i}": "analytics" for i in range(38, 41)},
    **{f"CAS-{i}": "acquisition" for i in range(41, 44)},
}

PREFIX_LABELS = {
    "frontend": "frontend",
    "backend": "backend",
    "qa": "qa",
    "infra": "infra",
    "product": "design",
}


def parse_prefix(summary: str):
    m = re.match(r"^\[(Frontend|Backend|QA|Infra|Product)\]", summary.strip(), re.IGNORECASE)
    if not m:
        return None
    return PREFIX_LABELS[m.group(1).lower()]


def update_labels(client: JiraClient, issue_key: str, labels):
    payload = {"fields": {"labels": sorted(set(labels))}}
    client.request("PUT", f"/rest/api/3/issue/{issue_key}", payload, expect=(204,))


def main():
    client = JiraClient()

    story_keys = issue_key_range(21, 43)
    for key in story_keys:
        try:
            issue = client.request("GET", f"/rest/api/3/issue/{key}?fields=labels", expect=(200,))
            current = issue.get("fields", {}).get("labels", []) or []
            theme = STORY_THEME_LABELS[key]
            update_labels(client, key, current + [theme])
            log_ok(key, f"labels updated (+{theme})")
        except Exception as e:
            log_err(key, e)
        time.sleep(API_SLEEP_SEC)

    subtask_keys = issue_key_range(44, 112)
    for batch in chunks(subtask_keys, 10):
        jql = f"key in ({','.join(batch)})"
        try:
            issues = client.search_issues(jql, fields=["summary", "labels", "parent"])
        except Exception as e:
            log_err(",".join(batch), e)
            time.sleep(API_SLEEP_SEC)
            continue

        for issue in issues:
            key = issue["key"]
            f = issue.get("fields", {})
            summary = f.get("summary", "") or ""
            parent_key = (f.get("parent") or {}).get("key")
            labels = list(f.get("labels", []) or [])
            prefix = parse_prefix(summary)
            if prefix:
                labels.append(prefix)
            if parent_key in STORY_THEME_LABELS:
                labels.append(STORY_THEME_LABELS[parent_key])
            try:
                update_labels(client, key, labels)
                log_ok(key, f"labels updated (+{prefix or 'no-prefix'} +theme)")
            except Exception as e:
                log_err(key, e)
            time.sleep(API_SLEEP_SEC)


if __name__ == "__main__":
    main()

