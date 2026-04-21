#!/usr/bin/env python3
import re
import time

from common import API_SLEEP_SEC, JiraClient, chunks, issue_key_range, log_err, log_ok

HIGHEST = 1
HIGH = 2
MEDIUM = 3
LOW = 4
LOWEST = 5

STORY_PRIORITIES = {
    **{f"CAS-{i}": HIGHEST for i in [21, 22, 23, 25, 26]},
    **{f"CAS-{i}": HIGH for i in [24, 27, 28, 29, 30, 32, 33]},
    **{f"CAS-{i}": MEDIUM for i in [31, 34, 35, 36, 37, 38, 39]},
    **{f"CAS-{i}": LOW for i in [40, 41, 42, 43]},
}


def parse_prefix(summary: str):
    m = re.match(r"^\[(Frontend|Backend|QA|Infra|Product)\]", summary.strip(), re.IGNORECASE)
    return m.group(1).lower() if m else None


def downgrade_one(priority: int) -> int:
    return min(priority + 1, LOWEST)


def subtask_priority(parent_priority: int, summary: str) -> int:
    prefix = parse_prefix(summary or "")
    if prefix == "frontend" and parent_priority == HIGHEST:
        return HIGH
    if prefix == "qa":
        return downgrade_one(parent_priority)
    if prefix == "infra":
        return parent_priority
    if prefix == "backend" and parent_priority == HIGHEST:
        return HIGHEST
    return parent_priority


def set_priority(client: JiraClient, key: str, priority_id: int):
    payload = {"fields": {"priority": {"id": str(priority_id)}}}
    client.request("PUT", f"/rest/api/3/issue/{key}", payload, expect=(204,))


def main():
    client = JiraClient()

    for key in issue_key_range(21, 43):
        pid = STORY_PRIORITIES.get(key)
        if pid is None:
            continue
        try:
            set_priority(client, key, pid)
            log_ok(key, f"priority={pid}")
        except Exception as e:
            log_err(key, e)
        time.sleep(API_SLEEP_SEC)

    subtask_keys = issue_key_range(44, 112)
    for batch in chunks(subtask_keys, 10):
        jql = f"key in ({','.join(batch)})"
        try:
            issues = client.search_issues(jql, fields=["summary", "parent"])
        except Exception as e:
            log_err(",".join(batch), e)
            time.sleep(API_SLEEP_SEC)
            continue

        for issue in issues:
            key = issue["key"]
            fields = issue.get("fields", {})
            parent_key = (fields.get("parent") or {}).get("key")
            summary = fields.get("summary", "") or ""
            parent_priority = STORY_PRIORITIES.get(parent_key, MEDIUM)
            pid = subtask_priority(parent_priority, summary)
            try:
                set_priority(client, key, pid)
                log_ok(key, f"priority={pid} (parent={parent_key})")
            except Exception as e:
                log_err(key, e)
            time.sleep(API_SLEEP_SEC)


if __name__ == "__main__":
    main()

