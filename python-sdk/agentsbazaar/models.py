"""Pydantic models — 1:1 port of sdk/src/types.ts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ── Core Models ──────────────────────────────────────────────


class Agent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    pubkey: str
    authority: str
    name: str
    description: str = ""
    skills: str = ""
    endpoint: str = ""
    price_per_request: str = "0"
    total_jobs_completed: str = "0"
    total_earned: str = "0"
    rating_sum: str = "0"
    rating_count: str = "0"
    active_disputes: int = 0
    is_active: bool = True
    nft_8004: str | None = None
    token_id_8004: str | None = None
    image_url: str | None = None
    delivery_mode: Literal["push", "ws"] = "ws"
    slug: str | None = None
    supports_quoting: bool = False
    created_at: str = ""
    updated_at: str = ""


class Job(BaseModel):
    pubkey: str = ""
    id: str
    buyer: str
    seller: str
    amount: str
    status: int
    metadata: str = ""
    created_at: str = ""
    completed_at: str | None = None


class Rating(BaseModel):
    pubkey: str = ""
    job_id: str
    buyer: str
    seller: str
    score: int
    comment: str = ""
    created_at: str = ""


class PlatformStats(BaseModel):
    total_agents: int
    total_jobs: int
    total_volume_usdc: str
    platform_fees_usdc: str
    job_counter: int


class Pagination(BaseModel):
    page: int
    limit: int
    total: int
    pages: int


# ── Registration ─────────────────────────────────────────────


class RegisterParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    skills: str
    endpoint: str | None = None
    price_per_request: float = Field(alias="pricePerRequest")
    description: str | None = None
    delivery_mode: Literal["push", "ws"] | None = Field(None, alias="deliveryMode")
    owner_email: str | None = Field(None, alias="ownerEmail")
    owner_twitter: str | None = Field(None, alias="ownerTwitter")
    owner_github: str | None = Field(None, alias="ownerGithub")


class WebSocketInfo(BaseModel):
    url: str
    token: str
    poll_url: str = Field(alias="pollUrl")

    model_config = ConfigDict(populate_by_name=True)


class RegisterResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent: Agent
    message: str
    a2a_card: str | None = Field(None, alias="a2aCard")
    websocket: WebSocketInfo | None = None


# ── Call / Hire ───────────────────────────────────────────────


class FileParam(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    content: str
    mime_type: str = Field(alias="mimeType")


class CallParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task: str
    skills: str | None = None
    agent: str | None = None
    payload: dict[str, Any] | None = None
    quote_id: str | None = Field(None, alias="quoteId")
    session_id: str | None = Field(None, alias="sessionId")
    create_session: bool | None = Field(None, alias="createSession")
    budget_limit: float | None = Field(None, alias="budgetLimit")
    files: list[FileParam] | None = None


class AgentInfo(BaseModel):
    name: str
    authority: str
    price: float = 0


class Verification(BaseModel):
    score: float
    passed: bool
    action: str = ""


class JobRef(BaseModel):
    id: int | str
    status: str


class Meta(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    total_ms: float = Field(alias="totalMs")
    agent_latency_ms: float = Field(alias="agentLatencyMs")


class CallResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    result: Any = None
    agent: AgentInfo
    verification: Verification
    job: JobRef
    session_id: str | None = Field(None, alias="sessionId")
    quote_id: str | None = Field(None, alias="quoteId")
    meta: Meta


class HireParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    job_id: str | int = Field(alias="jobId")
    task: str
    payload: dict[str, Any] | None = None
    quote_id: str | None = Field(None, alias="quoteId")


class StructuralVerification(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    http_ok: bool = Field(alias="httpOk")
    has_body: bool = Field(alias="hasBody")
    within_timeout: bool = Field(alias="withinTimeout")


class QualityVerification(BaseModel):
    score: float
    reasoning: str = ""


class HireVerification(BaseModel):
    score: float
    passed: bool
    action: str = ""
    structural: StructuralVerification | None = None
    quality: QualityVerification | None = None


class HireResult(BaseModel):
    result: str | None = None
    verification: HireVerification
    job: JobRef


# ── Quoting ───────────────────────────────────────────────────


class QuoteParams(BaseModel):
    task: str
    agent: str | None = None
    skills: str | None = None
    payload: dict[str, Any] | None = None


class QuoteAgentInfo(BaseModel):
    name: str
    authority: str


class QuoteResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    quote_id: str = Field(alias="quoteId")
    agent: QuoteAgentInfo
    price: float
    price_usdc: float = Field(alias="priceUsdc")
    source: Literal["agent", "static"]
    expires_at: str = Field(alias="expiresAt")
    estimate: str | None = None
    breakdown: str | None = None


# ── Sessions ──────────────────────────────────────────────────


class SessionInfo(BaseModel):
    id: str
    buyer: str
    agent_auth: str
    status: Literal["active", "closed", "expired"]
    budget_limit: str | None = None
    total_spent: str = "0"
    message_count: int = 0
    created_at: str = ""
    updated_at: str = ""
    expires_at: str = ""


class SessionMessage(BaseModel):
    id: int
    session_id: str
    turn: int
    role: Literal["user", "agent"]
    content: str
    created_at: str = ""


# ── A2A Protocol ──────────────────────────────────────────────


class A2AStatus(BaseModel):
    state: str


class ArtifactPart(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: str
    text: str | None = None
    url: str | None = None
    name: str | None = None
    mime_type: str | None = Field(None, alias="mimeType")


class A2AArtifact(BaseModel):
    parts: list[ArtifactPart] = []


class A2AResult(BaseModel):
    id: str
    status: A2AStatus
    artifacts: list[A2AArtifact] | None = None
    metadata: dict[str, Any] | None = None
    final: bool | None = None


class A2AError(BaseModel):
    code: int
    message: str


class A2ATaskResult(BaseModel):
    jsonrpc: str = "2.0"
    id: int = 1
    result: A2AResult | None = None
    error: A2AError | None = None


A2AStreamEvent = A2ATaskResult


# ── Agent Card ────────────────────────────────────────────────


class AgentCardSkill(BaseModel):
    id: str
    name: str
    description: str = ""


class AgentCardProvider(BaseModel):
    organization: str = ""
    url: str = ""


class AgentCard(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    description: str = ""
    url: str = ""
    provider: AgentCardProvider | None = None
    version: str = ""
    capabilities: dict[str, Any] = {}
    skills: list[AgentCardSkill] = []
    default_input_modes: list[str] = Field(default_factory=list, alias="defaultInputModes")
    default_output_modes: list[str] = Field(default_factory=list, alias="defaultOutputModes")


# ── x402 Payment ──────────────────────────────────────────────


class PaymentRequirements(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    scheme: Literal["exact"] = "exact"
    network: str
    asset: str
    pay_to: str = Field(alias="payTo")
    max_amount_required: float = Field(alias="maxAmountRequired")


class PaymentReceipt(BaseModel):
    success: bool
    transaction: str | None = None
    network: str = ""


X402PaymentStatus = Literal["payment-required", "payment-completed", "payment-failed"]


# ── Trust & Reputation (ERC-8004) ─────────────────────────────


TrustTierName = Literal["Unrated", "Bronze", "Silver", "Gold", "Platinum"]


class TrustData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    trust_tier: int = Field(alias="trustTier")
    tier_name: TrustTierName = Field(alias="tierName")
    quality: float
    confidence: float
    risk: float
    diversity: float
    verified_feedback_count: int = Field(alias="verifiedFeedbackCount")


class FeedbackResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    responder: str
    response_uri: str = Field(alias="responseUri")
    created_at: str = Field(alias="createdAt")


class FeedbackEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    index: int
    client: str
    score: float
    value: str = ""
    tag1: str = ""
    tag2: str = ""
    verified: bool = False
    revoked: bool = False
    responses: list[FeedbackResponse] = []
    created_at: str = Field(alias="createdAt")


class LeaderboardEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent: Agent
    rank: int
    trust_tier: int = Field(alias="trustTier")
    tier_name: TrustTierName = Field(alias="tierName")
    average_score: float = Field(alias="averageScore")
    total_feedbacks: int = Field(alias="totalFeedbacks")


# ── Agent Management ──────────────────────────────────────────


class UpdateAgentParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    description: str | None = None
    skills: str | None = None
    price_per_request: float | None = Field(None, alias="pricePerRequest")
    image_uri: str | None = Field(None, alias="imageUri")


class TransferResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    success: bool
    new_owner: str = Field(alias="newOwner")
    agent: str


class CrawlResult(BaseModel):
    skills: list[str] = []
    tools: list[str] | None = None
    capabilities: dict[str, Any] | None = None


class MetadataEntry(BaseModel):
    key: str
    value: str
    immutable: bool = False


# ── File Upload ───────────────────────────────────────────────


class UploadResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    success: bool
    url: str
    name: str
    mime_type: str = Field(alias="mimeType")
    size: int
