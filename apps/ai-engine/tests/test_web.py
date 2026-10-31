"""Focused tests for the keyless web-search provider path."""

import asyncio
import unittest
from unittest.mock import patch

from app.harness.web import _parse_bing_rss, search_web


_BING_RSS = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Kerala business registration guide</title>
    <link>https://example.gov.in/registration</link>
    <description>Steps for registering a business in Kerala.</description>
  </item>
  <item>
    <title>Ignored result</title>
    <link>javascript:alert(1)</link>
    <description>This link is not safe to return.</description>
  </item>
</channel></rss>"""


class _Response:
    def __init__(self, status_code: int, text: str) -> None:
        self.status_code = status_code
        self.text = text


class _FakeClient:
    def __init__(self, get_response: _Response, post_response: _Response | None = None) -> None:
        self.get_response = get_response
        self.post_response = post_response
        self.get_calls = 0
        self.post_calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, *_args, **_kwargs):
        self.get_calls += 1
        return self.get_response

    async def post(self, *_args, **_kwargs):
        self.post_calls += 1
        assert self.post_response is not None
        return self.post_response


class WebSearchTests(unittest.TestCase):
    def test_bing_rss_parser_returns_only_http_urls(self) -> None:
        self.assertEqual(
            _parse_bing_rss(_BING_RSS),
            [{
                "title": "Kerala business registration guide",
                "url": "https://example.gov.in/registration",
                "snippet": "Steps for registering a business in Kerala.",
            }],
        )

    def test_bing_results_do_not_trigger_fallback_provider(self) -> None:
        client = _FakeClient(_Response(200, _BING_RSS))
        with patch("app.harness.web.httpx.AsyncClient", return_value=client):
            result = asyncio.run(search_web("  tyre   shop  Kerala  ", limit=1))

        self.assertEqual(result["provider"], "Bing")
        self.assertEqual(result["query"], "tyre shop Kerala")
        self.assertEqual(len(result["results"]), 1)
        self.assertEqual(client.get_calls, 1)
        self.assertEqual(client.post_calls, 0)

    def test_duckduckgo_is_used_when_bing_is_unavailable(self) -> None:
        ddg_html = """
        <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fguide">Tyre business guide</a>
        <div class="result__snippet">A practical guide for a new shop.</div>
        """
        client = _FakeClient(_Response(503, ""), _Response(200, ddg_html))
        with patch("app.harness.web.httpx.AsyncClient", return_value=client):
            result = asyncio.run(search_web("tyre business Kerala"))

        self.assertEqual(result["provider"], "DuckDuckGo")
        self.assertEqual(result["results"][0]["url"], "https://example.com/guide")
        self.assertEqual(client.get_calls, 1)
        self.assertEqual(client.post_calls, 1)

    def test_provider_failures_remain_actionable(self) -> None:
        client = _FakeClient(_Response(503, ""), _Response(202, "bot challenge"))
        with patch("app.harness.web.httpx.AsyncClient", return_value=client):
            result = asyncio.run(search_web("tyre business Kerala"))

        self.assertEqual(result["results"], [])
        self.assertIn("Bing: returned HTTP 503", result["error"])
        self.assertIn("DuckDuckGo: returned HTTP 202", result["error"])

    def test_empty_query_never_calls_a_provider(self) -> None:
        self.assertEqual(
            asyncio.run(search_web("   ")),
            {"query": "   ", "results": [], "error": "A non-empty search query is required."},
        )


if __name__ == "__main__":
    unittest.main()
