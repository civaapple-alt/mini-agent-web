"""Bounded, deterministic display titles derived from the first user prompt."""

from __future__ import annotations

AUTO_THREAD_TITLE_MAX_CHARS = 32


def is_default_thread_title(title: object, thread_id: object) -> bool:
    normalized_title = str(title or "").strip()
    normalized_thread_id = str(thread_id or "").strip()
    if not normalized_title:
        return True
    if normalized_title in {"默认会话", "默认会话 (Default Session)"}:
        return True
    if not normalized_thread_id:
        return False
    return normalized_title in {
        normalized_thread_id,
        f"会话 {normalized_thread_id}",
        f"新会话 {normalized_thread_id}",
    }


def build_auto_thread_title(
    prompt: object, max_chars: int = AUTO_THREAD_TITLE_MAX_CHARS
) -> str:
    normalized_prompt = " ".join(str(prompt or "").split())
    if not normalized_prompt:
        return ""
    bounded_chars = max(1, int(max_chars))
    if len(normalized_prompt) <= bounded_chars:
        return normalized_prompt
    return f"{normalized_prompt[:bounded_chars].rstrip()}…"
