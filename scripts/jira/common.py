#!/usr/bin/env python3
import base64
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Iterable, List

JIRA_BASE_URL = os.environ.get("JIRA_BASE_URL", "https://cccasess.atlassian.net")
JIRA_EMAIL = os.environ.get("JIRA_EMAIL", "rotmansstan@gmail.com")
JIRA_TOKEN_PATH = os.environ.get("JIRA_TOKEN_PATH", os.path.expanduser("~/.jira_token"))
REQUEST_TIMEOUT_SEC = 30
RETRY_COUNT = 3
RETRY_SLEEP_SEC = 2
API_SLEEP_SEC = 0.4
BATCH_SIZE = 10


def load_token() -> str:
    with open(JIRA_TOKEN_PATH, "r", encoding="utf-8") as f:
        token = f.read().strip()
    if not token:
        raise RuntimeError(f"Empty Jira token in {JIRA_TOKEN_PATH}")
    return token


def auth_header(email: str, token: str) -> str:
    raw = f"{email}:{token}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("utf-8")


class JiraClient:
    def __init__(self) -> None:
        self._ssl = ssl.create_default_context()
        token = load_token()
        self._auth = auth_header(JIRA_EMAIL, token)

    def request(self, method: str, path: str, data=None, expect=(200, 201, 204)):
        url = JIRA_BASE_URL + path
        payload = None
        headers = {
            "Authorization": self._auth,
            "Accept": "application/json",
        }
        if data is not None:
            payload = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"

        last_err = None
        for attempt in range(1, RETRY_COUNT + 1):
            req = urllib.request.Request(url=url, data=payload, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, context=self._ssl, timeout=REQUEST_TIMEOUT_SEC) as resp:
                    status = resp.getcode()
                    body = resp.read().decode("utf-8", errors="replace")
                    if status not in expect:
                        raise RuntimeError(f"HTTP {status}: {body[:500]}")
                    if not body:
                        return {}
                    return json.loads(body)
            except (urllib.error.URLError, TimeoutError, ssl.SSLError) as e:
                last_err = e
                if attempt < RETRY_COUNT:
                    time.sleep(RETRY_SLEEP_SEC)
                    continue
                raise
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"HTTP {e.code}: {body[:500]}")
        if last_err:
            raise last_err
        raise RuntimeError("Unknown request failure")

    def search_issues(self, jql: str, fields: List[str], max_results: int = 100) -> List[Dict]:
        start_at = 0
        issues: List[Dict] = []
        while True:
            params = urllib.parse.urlencode(
                {
                    "jql": jql,
                    "startAt": start_at,
                    "maxResults": max_results,
                    "fields": ",".join(fields),
                }
            )
            data = self.request("GET", f"/rest/api/3/search/jql?{params}", data=None, expect=(200,))
            chunk = data.get("issues", [])
            issues.extend(chunk)
            if start_at + len(chunk) >= int(data.get("total", 0)):
                break
            start_at += len(chunk)
            time.sleep(API_SLEEP_SEC)
        return issues


def chunks(seq: List[str], size: int = BATCH_SIZE) -> Iterable[List[str]]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def issue_key_range(start: int, end: int) -> List[str]:
    return [f"CAS-{i}" for i in range(start, end + 1)]


def log_ok(key: str, message: str) -> None:
    print(f"✅ {key} {message}")


def log_err(key: str, err: Exception) -> None:
    print(f"❌ {key}: {err}")
