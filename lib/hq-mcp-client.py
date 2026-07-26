#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["mcp==1.28.1"]
# ///
"""Small, authenticated Streamable HTTP client for Severino HQ MCP."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


DEFAULT_CONFIG = Path.home() / ".config" / "severino-mcp" / "client.json"
DEFAULT_AUTH_HELPER = Path.home() / ".config" / "severino-mcp" / "auth"


def fail(message: str) -> "NoReturn":
    print(f"hq: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_config() -> dict[str, object]:
    path = Path(os.environ.get("HQ_MCP_CLIENT_CONFIG", DEFAULT_CONFIG))
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        value = {}
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"invalid MCP client config {path}: {exc}")
    if not isinstance(value, dict):
        fail(f"MCP client config {path} must contain a JSON object")
    return value


def endpoint(config: dict[str, object]) -> str:
    url = os.environ.get("HQ_MCP_URL") or config.get("url")
    if not isinstance(url, str) or not url:
        fail("HQ_MCP_URL is unset and ~/.config/severino-mcp/client.json has no url")
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        fail("HQ MCP URL must be an absolute HTTP(S) URL")
    if parsed.scheme == "http":
        try:
            address = ipaddress.ip_address(parsed.hostname)
        except ValueError:
            address = None
        if not address or not (
            address.is_loopback
            or address.is_private
            or address in ipaddress.ip_network("100.64.0.0/10")
        ):
            fail("unencrypted HQ MCP transport is allowed only on local/private networks")
    return url


def auth_headers(config: dict[str, object]) -> dict[str, str]:
    token = os.environ.get("HQ_MCP_TOKEN") or os.environ.get("SEVERINO_MCP_TOKEN")
    if token:
        return {"Authorization": f"Bearer {token}"}
    helper_value = os.environ.get("HQ_MCP_AUTH_HELPER") or config.get("auth_helper")
    helper = Path(str(helper_value or DEFAULT_AUTH_HELPER)).expanduser()
    try:
        result = subprocess.run(
            [str(helper), "headers"],
            check=True,
            capture_output=True,
            text=True,
        )
        headers = json.loads(result.stdout)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        fail(f"could not obtain MCP credentials from {helper}: {exc}")
    if not isinstance(headers, dict) or not isinstance(headers.get("Authorization"), str):
        fail(f"auth helper {helper} did not return an Authorization header")
    return {str(key): str(value) for key, value in headers.items()}


def request() -> tuple[str, dict[str, object]]:
    try:
        value = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        fail(f"invalid request JSON: {exc}")
    if not isinstance(value, dict) or not isinstance(value.get("tool"), str):
        fail("request must contain a string tool name")
    arguments = value.get("arguments", {})
    if not isinstance(arguments, dict):
        fail("request arguments must be a JSON object")
    return value["tool"], arguments


async def call() -> None:
    config = load_config()
    tool, arguments = request()
    async with httpx.AsyncClient(
        headers=auth_headers(config),
        follow_redirects=False,
        timeout=httpx.Timeout(30.0),
    ) as client:
        async with streamable_http_client(
            endpoint(config), http_client=client
        ) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool, arguments)
    if result.isError:
        message = "\n".join(
            block.text for block in result.content if getattr(block, "type", None) == "text"
        )
        fail(message or f"MCP tool {tool!r} failed")
    value = result.structuredContent
    if value is None:
        texts = [
            block.text for block in result.content if getattr(block, "type", None) == "text"
        ]
        if len(texts) != 1:
            fail(f"MCP tool {tool!r} returned no structured result")
        try:
            value = json.loads(texts[0])
        except json.JSONDecodeError as exc:
            fail(f"MCP tool {tool!r} returned invalid JSON: {exc}")
    json.dump(value, sys.stdout, separators=(",", ":"), default=str)
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        asyncio.run(call())
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as exc:
        while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
            exc = exc.exceptions[0]
        fail(f"MCP request failed: {exc}")
