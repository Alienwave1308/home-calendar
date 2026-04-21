#!/usr/bin/env python3
import datetime as dt
import time

from common import API_SLEEP_SEC, JiraClient, chunks, log_err, log_ok

BOARD_ID = 1

SPRINT_STORIES = {
    "Sprint 1 — Security & Compliance": [f"CAS-{i}" for i in range(21, 28)],
    "Sprint 2 — Trust & Payments": [f"CAS-{i}" for i in range(28, 34)],
    # Jira instance has 30-char sprint-name limit.
    "Sprint 3 — Retention": [f"CAS-{i}" for i in range(34, 40)],
    "Sprint 4 — Growth & Monitoring": [f"CAS-{i}" for i in range(40, 44)],
}


def iso_utc(d: dt.datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def build_sprint_dates():
    start = dt.datetime.utcnow().replace(hour=9, minute=0, second=0, microsecond=0)
    schedule = {}
    for idx, name in enumerate(SPRINT_STORIES.keys()):
        s = start + dt.timedelta(days=14 * idx)
        e = s + dt.timedelta(days=14)
        schedule[name] = (iso_utc(s), iso_utc(e))
    return schedule


def load_existing_sprints(client: JiraClient):
    by_name = {}
    start_at = 0
    while True:
        data = client.request(
            "GET",
            f"/rest/agile/1.0/board/{BOARD_ID}/sprint?startAt={start_at}&maxResults=50&state=active,future,closed",
            expect=(200,),
        )
        values = data.get("values", [])
        for s in values:
            by_name[s.get("name")] = s.get("id")
        if data.get("isLast", False):
            break
        start_at += len(values)
        time.sleep(API_SLEEP_SEC)
    return by_name


def resolve_existing_sprint_id(name: str, existing: dict):
    if name in existing:
        return existing[name]
    # Localized default sprint naming in some team-managed boards.
    if name.startswith("Sprint 1"):
        for n, sid in existing.items():
            low = (n or "").lower()
            if "спринт 1" in low or "sprint 1" in low:
                return sid
    return None


def main():
    client = JiraClient()
    dates = build_sprint_dates()
    existing = load_existing_sprints(client)
    sprint_ids = {}

    for name in SPRINT_STORIES:
        resolved = resolve_existing_sprint_id(name, existing)
        if resolved:
            sprint_ids[name] = resolved
            log_ok(name, f"already exists (id={resolved})")
            continue
        start_date, end_date = dates[name]
        payload = {
            "name": name,
            "originBoardId": BOARD_ID,
            "startDate": start_date,
            "endDate": end_date,
        }
        try:
            resp = client.request("POST", "/rest/agile/1.0/sprint", payload, expect=(200, 201))
            sid = resp["id"]
            sprint_ids[name] = sid
            log_ok(name, f"created sprint id={sid}")
        except Exception as e:
            log_err(name, e)
        time.sleep(API_SLEEP_SEC)

    for sprint_name, issues in SPRINT_STORIES.items():
        sid = sprint_ids.get(sprint_name)
        if not sid:
            log_err(sprint_name, RuntimeError("missing sprint id, skip issue assignment"))
            continue
        for batch in chunks(issues, 10):
            try:
                client.request(
                    "POST",
                    f"/rest/agile/1.0/sprint/{sid}/issue",
                    {"issues": batch},
                    expect=(200, 201, 204),
                )
                log_ok(sprint_name, f"assigned issues: {', '.join(batch)}")
            except Exception as e:
                log_err(",".join(batch), e)
            time.sleep(API_SLEEP_SEC)


if __name__ == "__main__":
    main()
