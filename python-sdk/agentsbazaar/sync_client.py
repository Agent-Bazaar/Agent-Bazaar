"""Synchronous client for the AgentBazaar API — wraps the same endpoints as the async client."""

from __future__ import annotations

import base64
import mimetypes
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote as urlquote

import httpx
from solders.keypair import Keypair  # type: ignore[import-untyped]
from solders.transaction import Transaction  # type: ignore[import-untyped]

from .auth import sign_message
from .exceptions import APIError, AuthenticationError
from .models import (
    A2AStreamEvent,
    A2ATaskResult,
    Agent,
    AgentCard,
    CallResult,
    CrawlResult,
    HireResult,
    PlatformStats,
    QuoteResponse,
    RegisterResult,
    SessionInfo,
    TransferResult,
    TrustData,
    UploadResult,
)

_DEFAULT_BASE = "https://agentbazaar.dev"
_TIMEOUT = 60.0


class SyncAgentBazaarClient:
    """Synchronous client for the AgentBazaar platform.

    Usage::

        with SyncAgentBazaarClient(keypair=kp) as client:
            agents = client.list_agents()
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        keypair: Keypair | None = None,
        api_key: str | None = None,
        timeout: float = _TIMEOUT,
    ) -> None:
        import os

        raw = base_url or os.environ.get("AGENTBAZAAR_API", _DEFAULT_BASE)
        self.base_url = raw.rstrip("/")
        self.keypair = keypair
        self.api_key = api_key
        self._timeout = timeout
        self._client: httpx.Client | None = None

    def __enter__(self) -> SyncAgentBazaarClient:
        self._client = httpx.Client(timeout=self._timeout)
        return self

    def __exit__(self, *exc: object) -> None:
        if self._client:
            self._client.close()
            self._client = None

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=self._timeout)
        return self._client

    def _require_keypair(self) -> Keypair:
        if not self.keypair:
            raise AuthenticationError("Keypair required for authenticated operations")
        return self.keypair

    def _auth_headers(self, action: str) -> dict[str, str]:
        kp = self._require_keypair()
        headers = sign_message(kp, action)
        headers["Content-Type"] = "application/json"
        return headers

    def _api_key_headers(self) -> dict[str, str]:
        if not self.api_key:
            raise AuthenticationError("API key required for custodial wallet operations")
        return {"Authorization": f"Bearer {self.api_key}"}

    def _request(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str] | None = None,
        json: Any = None,
        data: Any = None,
        files: Any = None,
    ) -> Any:
        client = self._get_client()
        url = f"{self.base_url}{path}"
        resp = client.request(method, url, headers=headers, json=json, content=data, files=files)
        try:
            body = resp.json()
        except Exception:
            raise APIError(f"HTTP {resp.status_code}: invalid response", resp.status_code)
        if not resp.is_success:
            msg = body.get("error", f"HTTP {resp.status_code}") if isinstance(body, dict) else f"HTTP {resp.status_code}"
            raise APIError(msg, resp.status_code)
        return body

    @staticmethod
    def _qs(params: dict[str, Any]) -> str:
        filtered = {k: str(v) for k, v in params.items() if v is not None}
        if not filtered:
            return ""
        return "?" + "&".join(f"{k}={v}" for k, v in filtered.items())

    # ── Registration ─────────────────────────────────────────

    def register(self, *, name: str, skills: str, price_per_request: float, **kwargs: Any) -> RegisterResult:
        body: dict[str, Any] = {"name": name, "skills": skills, "pricePerRequest": price_per_request}
        for py_key, api_key in [
            ("endpoint", "endpoint"), ("description", "description"), ("delivery_mode", "deliveryMode"),
            ("owner_email", "ownerEmail"), ("owner_twitter", "ownerTwitter"), ("owner_github", "ownerGithub"),
        ]:
            if kwargs.get(py_key) is not None:
                body[api_key] = kwargs[py_key]
        data = self._request("POST", "/agents/register", headers=self._auth_headers("register"), json=body)
        return RegisterResult.model_validate(data)

    def update_agent(self, **kwargs: Any) -> dict[str, Any]:
        body: dict[str, Any] = {}
        for py_key, api_key in [
            ("name", "name"), ("description", "description"), ("skills", "skills"),
            ("price_per_request", "pricePerRequest"), ("image_uri", "imageUri"),
        ]:
            if kwargs.get(py_key) is not None:
                body[api_key] = kwargs[py_key]
        return self._request("PUT", "/agents/me/metadata", headers=self._auth_headers("update"), json=body)

    def transfer_agent(self, new_owner: str) -> TransferResult:
        data = self._request("POST", "/agents/me/transfer", headers=self._auth_headers("transfer"), json={"newOwner": new_owner, "confirm": True})
        return TransferResult.model_validate(data)

    def set_operational_wallet(self, wallet: str, deadline: int) -> dict[str, Any]:
        return self._request("POST", "/agents/me/wallet", headers=self._auth_headers("wallet"), json={"operationalWallet": wallet, "deadline": deadline})

    def set_parent_agent(self, parent_pubkey: str) -> dict[str, Any]:
        return self._request("POST", "/agents/me/parent", headers=self._auth_headers("parent"), json={"parentAgent": parent_pubkey})

    def my_agents(self) -> dict[str, Any]:
        return self._request("GET", "/agents/my", headers=self._auth_headers("agents"))

    def claim_agent(self, agent_pubkey: str, access_code: str) -> dict[str, Any]:
        return self._request("POST", "/agents/claim", headers=self._auth_headers("claim"), json={"agentPubkey": agent_pubkey, "accessCode": access_code})

    def crawl_endpoint(self, endpoint: str) -> CrawlResult:
        data = self._request("POST", "/agents/crawl", json={"endpoint": endpoint}, headers={"Content-Type": "application/json"})
        return CrawlResult.model_validate(data)

    # ── Discovery ────────────────────────────────────────────

    def list_agents(self, *, page: int | None = None, limit: int | None = None, skills: str | None = None, active_only: bool | None = None, min_rating: float | None = None) -> dict[str, Any]:
        qs = self._qs({"page": page, "limit": limit, "skills": skills, "active_only": active_only, "min_rating": min_rating})
        return self._request("GET", f"/agents{qs}")

    def get_agent(self, pubkey: str) -> Agent:
        data = self._request("GET", f"/agents/{pubkey}")
        return Agent.model_validate(data)

    def get_agent_by_wallet(self, wallet: str) -> dict[str, Any]:
        return self._request("GET", f"/agents/authority/{wallet}")

    def get_agent_card(self, slug: str) -> AgentCard:
        data = self._request("GET", f"/a2a/{slug}/.well-known/agent.json")
        return AgentCard.model_validate(data)

    def discover(self, skills: str) -> list[Agent]:
        data = self._request("GET", f"/discover?skills={urlquote(skills)}")
        return [Agent.model_validate(a) for a in data] if isinstance(data, list) else []

    def get_ratings(self, pubkey: str, *, page: int | None = None, limit: int | None = None) -> dict[str, Any]:
        qs = self._qs({"page": page, "limit": limit})
        return self._request("GET", f"/agents/{pubkey}/ratings{qs}")

    # ── Jobs ─────────────────────────────────────────────────

    def list_jobs(self, *, page: int | None = None, limit: int | None = None, buyer: str | None = None, seller: str | None = None, status: int | None = None) -> dict[str, Any]:
        qs = self._qs({"page": page, "limit": limit, "buyer": buyer, "seller": seller, "status": status})
        return self._request("GET", f"/jobs{qs}")

    # ── Stats ────────────────────────────────────────────────

    def stats(self) -> PlatformStats:
        data = self._request("GET", "/stats")
        return PlatformStats.model_validate(data)

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/health")

    # ── Execution ────────────────────────────────────────────

    def call(self, *, task: str, **kwargs: Any) -> CallResult:
        body: dict[str, Any] = {"task": task}
        for py_key, api_key in [
            ("skills", "skills"), ("agent", "agent"), ("payload", "payload"),
            ("quote_id", "quoteId"), ("session_id", "sessionId"),
            ("create_session", "createSession"), ("budget_limit", "budgetLimit"), ("files", "files"),
        ]:
            if kwargs.get(py_key) is not None:
                body[api_key] = kwargs[py_key]
        data = self._request("POST", "/call", json=body, headers={"Content-Type": "application/json"})
        return CallResult.model_validate(data)

    def hire(self, *, job_id: str | int, task: str, payload: dict[str, Any] | None = None, quote_id: str | None = None) -> HireResult:
        body: dict[str, Any] = {"jobId": job_id, "task": task}
        if payload is not None:
            body["payload"] = payload
        if quote_id is not None:
            body["quoteId"] = quote_id
        data = self._request("POST", "/jobs/hire", json=body, headers={"Content-Type": "application/json"})
        return HireResult.model_validate(data)

    # ── Quoting ──────────────────────────────────────────────

    def quote(self, *, task: str, agent: str | None = None, skills: str | None = None, payload: dict[str, Any] | None = None) -> QuoteResponse:
        body: dict[str, Any] = {"task": task}
        if agent is not None:
            body["agent"] = agent
        if skills is not None:
            body["skills"] = skills
        if payload is not None:
            body["payload"] = payload
        data = self._request("POST", "/quote", json=body, headers={"Content-Type": "application/json"})
        return QuoteResponse.model_validate(data)

    def get_quote(self, quote_id: str) -> QuoteResponse:
        data = self._request("GET", f"/quote/{quote_id}")
        return QuoteResponse.model_validate(data)

    # ── Sessions ─────────────────────────────────────────────

    def start_session(self, agent_pubkey: str, budget_limit: float | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"agent": agent_pubkey}
        if budget_limit is not None:
            body["budgetLimit"] = budget_limit
        return self._request("POST", "/chat/start", headers=self._auth_headers("chat"), json=body)

    def send_message(self, session_id: str, task: str, file_url: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"sessionId": session_id, "task": task}
        if file_url is not None:
            body["fileUrl"] = file_url
        return self._request("POST", "/chat/send", headers=self._auth_headers("chat"), json=body)

    def pay_session(self, payment_id: str, signed_transaction: str) -> dict[str, Any]:
        return self._request("POST", "/chat/pay", headers=self._auth_headers("chat"), json={"paymentId": payment_id, "signedTransaction": signed_transaction})

    def list_sessions(self, buyer: str | None = None, status: str | None = None) -> dict[str, Any]:
        qs = self._qs({"buyer": buyer, "status": status})
        return self._request("GET", f"/sessions{qs}", headers=self._auth_headers("session"))

    def get_session(self, session_id: str) -> SessionInfo:
        data = self._request("GET", f"/sessions/{session_id}", headers=self._auth_headers("session"))
        return SessionInfo.model_validate(data)

    def get_session_messages(self, session_id: str, limit: int | None = None) -> dict[str, Any]:
        qs = f"?limit={limit}" if limit else ""
        return self._request("GET", f"/sessions/{session_id}/messages{qs}", headers=self._auth_headers("session"))

    def close_session(self, session_id: str) -> dict[str, Any]:
        return self._request("POST", f"/sessions/{session_id}/close", headers=self._auth_headers("session"))

    # ── Prepaid Sessions ─────────────────────────────────────

    def create_prepaid_session(self, agent_pubkey: str, budget_usdc: float) -> dict[str, Any]:
        return self._request("POST", "/sessions/prepaid", headers=self._auth_headers("chat"), json={"agent": agent_pubkey, "budgetUsdc": budget_usdc})

    def open_prepaid_session(self, agent_pubkey: str, budget_usdc: float, signed_transaction: str) -> dict[str, Any]:
        return self._request("POST", "/sessions/prepaid", headers=self._auth_headers("chat"), json={"agent": agent_pubkey, "budgetUsdc": budget_usdc, "signedTransaction": signed_transaction})

    def extend_session(self, session_id: str, additional_usdc: float) -> dict[str, Any]:
        return self._request("POST", f"/sessions/{session_id}/extend", headers=self._auth_headers("chat"), json={"additionalUsdc": additional_usdc})

    def send_message_with_budget(self, session_id: str, task: str, max_budget: float, file_url: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"sessionId": session_id, "task": task, "maxBudget": max_budget}
        if file_url is not None:
            body["fileUrl"] = file_url
        return self._request("POST", "/chat/send", headers=self._auth_headers("chat"), json=body)

    # ── A2A Protocol ─────────────────────────────────────────

    def a2a_send(self, slug: str, task: str, *, files: list[dict[str, str]] | None = None) -> A2ATaskResult:
        parts: list[dict[str, Any]] = [{"type": "text", "text": task}]
        if files:
            for f in files:
                parts.append({"type": "file", "url": f["url"], "name": f.get("name"), "mimeType": f.get("mimeType")})
        body = {"jsonrpc": "2.0", "id": 1, "method": "tasks/send", "params": {"message": {"parts": parts}}}
        data = self._request("POST", f"/a2a/{slug}/", json=body, headers={"Content-Type": "application/json"})
        return A2ATaskResult.model_validate(data)

    def a2a_get(self, slug: str, task_id: str) -> A2ATaskResult:
        body = {"jsonrpc": "2.0", "id": 1, "method": "tasks/get", "params": {"id": task_id}}
        data = self._request("POST", f"/a2a/{slug}/", json=body, headers={"Content-Type": "application/json"})
        return A2ATaskResult.model_validate(data)

    def a2a_cancel(self, slug: str, task_id: str) -> A2ATaskResult:
        body = {"jsonrpc": "2.0", "id": 1, "method": "tasks/cancel", "params": {"id": task_id}}
        data = self._request("POST", f"/a2a/{slug}/", json=body, headers={"Content-Type": "application/json"})
        return A2ATaskResult.model_validate(data)

    def a2a_stream(self, slug: str, task: str, *, files: list[dict[str, str]] | None = None, timeout_ms: int = 60_000) -> Iterator[A2AStreamEvent]:
        parts: list[dict[str, Any]] = [{"type": "text", "text": task}]
        if files:
            for f in files:
                parts.append({"type": "file", "url": f["url"], "name": f.get("name"), "mimeType": f.get("mimeType")})
        body = {"jsonrpc": "2.0", "id": 1, "method": "tasks/sendSubscribe", "params": {"message": {"parts": parts}}}

        client = self._get_client()
        with client.stream("POST", f"{self.base_url}/a2a/{slug}/", json=body, headers={"Content-Type": "application/json"}, timeout=timeout_ms / 1000) as resp:
            if not resp.is_success:
                raise APIError(f"A2A stream failed: HTTP {resp.status_code}", resp.status_code)
            buf = ""
            for chunk in resp.iter_text():
                buf += chunk
                lines = buf.split("\n")
                buf = lines.pop()
                for line in lines:
                    stripped = line.strip()
                    if stripped.startswith("data: "):
                        data_str = stripped[6:]
                        if data_str == "[DONE]":
                            return
                        try:
                            yield A2AStreamEvent.model_validate_json(data_str)
                        except Exception:
                            pass

    # ── File Upload ──────────────────────────────────────────

    def upload_file(self, file_path: str) -> UploadResult:
        p = Path(file_path)
        mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        kp = self._require_keypair()
        auth = sign_message(kp, "upload")
        data = self._request("POST", "/upload", headers={"X-Wallet-Address": auth["X-Wallet-Address"], "X-Wallet-Signature": auth["X-Wallet-Signature"], "X-Wallet-Message": auth["X-Wallet-Message"]}, files={"file": (p.name, p.read_bytes(), mime)})
        return UploadResult.model_validate(data)

    def upload_image(self, image_path: str) -> dict[str, Any]:
        p = Path(image_path)
        kp = self._require_keypair()
        auth = sign_message(kp, "upload")
        return self._request("POST", "/agents/me/image", headers={"X-Wallet-Address": auth["X-Wallet-Address"], "X-Wallet-Signature": auth["X-Wallet-Signature"], "X-Wallet-Message": auth["X-Wallet-Message"]}, files={"image": (p.name, p.read_bytes(), "image/webp")})

    def get_presigned_upload_url(self, file_name: str, mime_type: str, size: int | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"fileName": file_name, "mimeType": mime_type}
        if size is not None:
            body["size"] = size
        return self._request("POST", "/upload/presigned", headers=self._auth_headers("upload"), json=body)

    def confirm_upload(self, file_id: str) -> dict[str, Any]:
        return self._request("POST", "/upload/confirm", headers=self._auth_headers("upload"), json={"fileId": file_id})

    # ── Reviews / Trust ──────────────────────────────────────

    def submit_review(self, agent_pubkey: str, job_id: int, score: int, comment: str | None = None) -> dict[str, Any]:
        kp = self._require_keypair()
        build_data = self._request("POST", "/feedback/build", headers=self._auth_headers("feedback"), json={"agentPubkey": agent_pubkey, "jobId": job_id, "score": score, "comment": comment})
        tx_bytes = base64.b64decode(build_data["transaction"])
        tx = Transaction.from_bytes(tx_bytes)
        tx.partial_sign([kp], tx.message.recent_blockhash)
        signed_b64 = base64.b64encode(bytes(tx)).decode("ascii")
        return self._request("POST", "/feedback/submit", headers=self._auth_headers("feedback"), json={"signedTransaction": signed_b64, "jobId": job_id, "agentPubkey": agent_pubkey, "score": score, "comment": comment})

    def get_trust_data(self, pubkey: str) -> TrustData:
        data = self._request("GET", f"/agents/{pubkey}/trust")
        return TrustData.model_validate(data)

    def get_leaderboard(self, *, limit: int | None = None, min_tier: int | None = None) -> dict[str, Any]:
        qs = self._qs({"limit": limit, "minTier": min_tier})
        return self._request("GET", f"/leaderboard{qs}")

    def get_feedback(self, pubkey: str) -> dict[str, Any]:
        return self._request("GET", f"/agents/{pubkey}/feedback")

    def revoke_feedback(self, pubkey: str, feedback_index: int) -> dict[str, Any]:
        return self._request("POST", f"/agents/{pubkey}/feedback/{feedback_index}/revoke", headers=self._auth_headers("feedback"))

    def respond_to_feedback(self, pubkey: str, feedback_index: int, response: str) -> dict[str, Any]:
        return self._request("POST", f"/agents/{pubkey}/feedback/{feedback_index}/respond", headers=self._auth_headers("feedback"), json={"response": response})

    # ── Custodial Wallets ────────────────────────────────────

    @staticmethod
    def create_wallet(base_url: str | None = None, label: str | None = None) -> dict[str, Any]:
        url = (base_url or _DEFAULT_BASE).rstrip("/")
        with httpx.Client() as c:
            resp = c.post(f"{url}/wallets/create", json={"label": label})
        body = resp.json()
        if not resp.is_success:
            raise APIError(body.get("error", f"HTTP {resp.status_code}"), resp.status_code)
        return body

    def get_wallet(self) -> dict[str, Any]:
        return self._request("GET", "/wallets/me", headers=self._api_key_headers())

    def export_key(self) -> dict[str, Any]:
        return self._request("GET", "/wallets/me/export", headers=self._api_key_headers())

    # ── Email ────────────────────────────────────────────────

    def get_inbox(self, *, limit: int | None = None, offset: int | None = None) -> dict[str, Any]:
        qs = self._qs({"limit": limit, "offset": offset})
        return self._request("GET", f"/agents/me/inbox{qs}", headers=self._auth_headers("inbox"))

    def read_email(self, message_id: str) -> dict[str, Any]:
        return self._request("GET", f"/agents/me/inbox/{urlquote(message_id, safe='')}", headers=self._auth_headers("inbox"))

    def send_email(self, *, to: str, subject: str, text: str, html: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"to": to, "subject": subject, "text": text}
        if html is not None:
            body["html"] = html
        return self._request("POST", "/agents/me/inbox/send", headers=self._auth_headers("inbox"), json=body)

    # ── Credits ──────────────────────────────────────────────

    def get_credit_balance(self) -> dict[str, Any]:
        return self._request("GET", "/credits/balance", headers=self._auth_headers("credits"))

    def get_credit_history(self, limit: int | None = None) -> dict[str, Any]:
        qs = f"?limit={limit}" if limit else ""
        return self._request("GET", f"/credits/history{qs}", headers=self._auth_headers("credits"))

    def deposit_credits(self, stripe_payment_intent_id: str) -> dict[str, Any]:
        return self._request("POST", "/credits/deposit", headers=self._auth_headers("credits"), json={"stripePaymentIntentId": stripe_payment_intent_id})

    # ── Notifications ────────────────────────────────────────

    def get_notifications(self, limit: int | None = None) -> dict[str, Any]:
        qs = f"?limit={limit}" if limit else ""
        return self._request("GET", f"/notifications{qs}", headers=self._auth_headers("notifications"))

    def get_unread_count(self) -> dict[str, Any]:
        return self._request("GET", "/notifications/unread-count", headers=self._auth_headers("notifications"))

    def mark_notifications_read(self, ids: list[int] | None = None) -> dict[str, Any]:
        return self._request("POST", "/notifications/mark-read", headers=self._auth_headers("notifications"), json={"ids": ids})

    # ── Webhooks ─────────────────────────────────────────────

    def register_webhook(self, url: str, events: list[str] | None = None) -> dict[str, Any]:
        return self._request("POST", "/notifications/webhook", headers=self._auth_headers("webhook"), json={"url": url, "events": events})

    def get_webhook(self) -> dict[str, Any]:
        return self._request("GET", "/notifications/webhook", headers=self._auth_headers("webhook"))

    def delete_webhook(self) -> dict[str, Any]:
        return self._request("DELETE", "/notifications/webhook", headers=self._auth_headers("webhook"))

    # ── Swap ─────────────────────────────────────────────────

    def get_swap_quote(self, input_mint: str, output_mint: str, amount: int) -> dict[str, Any]:
        return self._request("GET", f"/swap/quote?inputMint={input_mint}&outputMint={output_mint}&amount={amount}")

    def build_swap_transaction(self, input_mint: str, output_mint: str, amount: int) -> dict[str, Any]:
        return self._request("POST", "/swap/build", headers=self._auth_headers("swap"), json={"inputMint": input_mint, "outputMint": output_mint, "amount": amount})

    def get_token_price(self, token: str) -> dict[str, Any]:
        return self._request("GET", f"/swap/price/{token}")

    def get_token_prices(self) -> dict[str, Any]:
        return self._request("GET", "/swap/prices")

    # ── Solana Pay / Blinks ──────────────────────────────────

    def get_solana_pay_qr(self, agent_slug: str) -> dict[str, Any]:
        return self._request("GET", f"/pay/qr/{agent_slug}")

    def get_blink(self, agent_slug: str) -> dict[str, Any]:
        return self._request("GET", f"/blink/{agent_slug}")

    # ── Recurring Tasks ──────────────────────────────────────

    def create_recurring_task(self, *, agent_auth: str, task: str, interval_ms: int, budget_per_execution: float, max_executions: int | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"agentAuth": agent_auth, "task": task, "intervalMs": interval_ms, "budgetPerExecution": budget_per_execution}
        if max_executions is not None:
            body["maxExecutions"] = max_executions
        return self._request("POST", "/recurring/create", headers=self._auth_headers("recurring"), json=body)

    def list_recurring_tasks(self) -> dict[str, Any]:
        return self._request("GET", "/recurring", headers=self._auth_headers("recurring"))

    def pause_recurring_task(self, id: int) -> dict[str, Any]:
        return self._request("POST", f"/recurring/{id}/pause", headers=self._auth_headers("recurring"))

    def resume_recurring_task(self, id: int) -> dict[str, Any]:
        return self._request("POST", f"/recurring/{id}/resume", headers=self._auth_headers("recurring"))

    def stop_recurring_task(self, id: int) -> dict[str, Any]:
        return self._request("POST", f"/recurring/{id}/stop", headers=self._auth_headers("recurring"))

    # ── Balance ──────────────────────────────────────────────

    def get_agent_balance(self) -> dict[str, Any]:
        return self._request("GET", "/agents/actions/balance", headers=self._auth_headers("balance"))

    def get_agent_spend_history(self) -> dict[str, Any]:
        return self._request("GET", "/agents/spend/history", headers=self._auth_headers("spend"))

    def get_transaction_history(self) -> dict[str, Any]:
        return self._request("GET", "/transactions/history", headers=self._auth_headers("transactions"))

    # ── Mandates ─────────────────────────────────────────────

    def create_mandate(self, *, agent_auth: str, budget_limit: float, expires_in_ms: int, allowed_actions: list[str] | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"agentAuth": agent_auth, "budgetLimit": budget_limit, "expiresInMs": expires_in_ms}
        if allowed_actions is not None:
            body["allowedActions"] = allowed_actions
        return self._request("POST", "/mandates/create", headers=self._auth_headers("mandate"), json=body)

    def list_mandates(self) -> dict[str, Any]:
        return self._request("GET", "/mandates", headers=self._auth_headers("mandate"))

    def revoke_mandate(self, id: int) -> dict[str, Any]:
        return self._request("POST", f"/mandates/{id}/revoke", headers=self._auth_headers("mandate"))
