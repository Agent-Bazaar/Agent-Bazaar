export interface AgentRow {
  pubkey: string;
  authority: string;
  name: string;
  description: string;
  skills: string;
  endpoint: string;
  price_per_request: string;
  total_jobs_completed: string;
  total_earned: string;
  rating_sum: string;
  rating_count: string;
  active_disputes: number;
  is_active: boolean;
  nft_8004: string | null;
  image_url: string | null;
  delivery_mode: "push" | "ws";
  api_token: string | null;
  slug: string | null;
  supports_quoting: boolean;
  created_at: string;
  updated_at: string;
}

export interface JobRow {
  id: string;
  buyer: string;
  seller: string;
  amount: string;
  status: number;
  metadata: string;
  created_at: string;
  completed_at: string | null;
}

export interface RatingRow {
  pubkey: string;
  job_id: string;
  buyer: string;
  seller: string;
  rater: string;
  score: number;
  comment: string;
  created_at: string;
}

export function formatUsdc(raw: string | number): string {
  return (Number(raw) / 1_000_000).toFixed(2);
}

export function formatAgent(agent: AgentRow): string {
  const rating =
    Number(agent.rating_count) > 0
      ? (Number(agent.rating_sum) / Number(agent.rating_count)).toFixed(1) + "/5"
      : "No ratings";

  const lines = [`**${agent.name}** ${agent.is_active ? "(Active)" : "(Inactive)"}`, `- Pubkey: \`${agent.pubkey}\``];

  if (agent.description) lines.push(`- Description: ${agent.description}`);
  lines.push(`- Skills: ${agent.skills}`);
  lines.push(`- Price: $${formatUsdc(agent.price_per_request)} USDC/request`);
  lines.push(`- Mode: ${agent.delivery_mode === "ws" ? "WebSocket" : "Push (HTTPS)"}`);
  lines.push(`- Jobs Completed: ${agent.total_jobs_completed}`);
  lines.push(`- Rating: ${rating} (${agent.rating_count} reviews)`);
  lines.push(`- Total Earned: $${formatUsdc(agent.total_earned)} USDC`);

  if (agent.endpoint) lines.push(`- Endpoint: ${agent.endpoint}`);
  if (agent.slug) lines.push(`- A2A Card: https://agentbazaar.dev/a2a/${agent.slug}/.well-known/agent.json`);
  if (agent.supports_quoting) lines.push(`- Quoting: Enabled (dynamic pricing)`);
  if (agent.nft_8004) lines.push(`- 8004 NFT: \`${agent.nft_8004}\``);
  if (agent.image_url) lines.push(`- Avatar: ${agent.image_url}`);

  return lines.join("\n");
}

export function formatAgentShort(agent: AgentRow): string {
  const rating =
    Number(agent.rating_count) > 0 ? (Number(agent.rating_sum) / Number(agent.rating_count)).toFixed(1) + "/5" : "N/A";

  return [
    `**${agent.name}** — $${formatUsdc(agent.price_per_request)} USDC`,
    `  Skills: ${agent.skills} | Rating: ${rating} | Jobs: ${agent.total_jobs_completed}`,
    `  Pubkey: \`${agent.pubkey}\``,
  ].join("\n");
}

const JOB_STATUS: Record<number, string> = {
  0: "Created",
  1: "Completed",
  2: "Disputed",
  3: "Cancelled",
};

export function formatJob(job: JobRow): string {
  return [
    `**Job #${job.id}** — ${JOB_STATUS[job.status] || "Unknown"}`,
    `- Amount: $${formatUsdc(job.amount)} USDC`,
    `- Buyer: \`${job.buyer}\``,
    `- Seller: \`${job.seller}\``,
    `- Created: ${job.created_at}`,
    job.completed_at ? `- Completed: ${job.completed_at}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRating(rating: RatingRow): string {
  const stars = "★".repeat(rating.score) + "☆".repeat(5 - rating.score);
  return [
    `${stars} (${rating.score}/5) — Job #${rating.job_id}`,
    rating.comment ? `  "${rating.comment}"` : null,
    `  By: \`${rating.rater}\` — ${rating.created_at}`,
  ]
    .filter(Boolean)
    .join("\n");
}
