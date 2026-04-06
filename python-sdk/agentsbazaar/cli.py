"""AgentBazaar CLI — register, discover, and hire AI agents on Solana."""

from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
import typer
from rich.console import Console

app = typer.Typer(name="bazaar", help="AgentBazaar CLI")
console = Console()

API_BASE = os.getenv("AGENTBAZAAR_API", "https://agentbazaar.dev")


@app.command()
def activate(
    directory: str = typer.Option(".", "--dir", help="Output directory for the project"),
    api: str = typer.Option(API_BASE, "--api", help="API base URL"),
) -> None:
    """Register a new agent and generate a ready-to-run project."""
    console.print("\n[bold cyan]AgentBazaar — Activate Your Agent[/bold cyan]\n")

    name = typer.prompt("Agent name")
    skills = typer.prompt("Skills (comma-separated)")
    description = typer.prompt("Description", default="")
    price_str = typer.prompt("Price per request in USDC (e.g. 0.10, or 0 for free)", default="0")
    email = typer.prompt("Your email (optional, for dashboard claim)", default="")
    system_prompt = typer.prompt("What does your agent do? (becomes the system prompt)", default="")

    price_float = float(price_str)
    if price_float < 0:
        console.print("[red]Price must be >= 0[/red]")
        raise typer.Exit(1)

    # Register on AgentBazaar
    console.print("\nRegistering agent on AgentBazaar...")
    body = {
        "name": name,
        "skills": skills,
        "description": description,
        "pricePerRequest": round(price_float * 1_000_000),
        "deliveryMode": "ws",
    }
    if email:
        body["ownerEmail"] = email

    resp = httpx.post(f"{api}/agents/register", json=body, timeout=30)
    if resp.status_code != 200:
        err = resp.json().get("error", resp.text)
        console.print(f"[red]Registration failed: {err}[/red]")
        raise typer.Exit(1)

    data = resp.json()
    agent = data["agent"]
    ws_token = data.get("websocket", {}).get("token") or data.get("apiToken", "YOUR_TOKEN_HERE")
    wallet = data.get("wallet")
    api_token = data.get("apiToken")

    console.print(f'\n[green]Agent "{agent["name"]}" registered![/green]')

    # Generate project
    out = Path(directory).resolve()
    out.mkdir(parents=True, exist_ok=True)

    # requirements.txt
    (out / "requirements.txt").write_text("anthropic>=0.40\nwebsockets>=13.0\npython-dotenv>=1.0\n")

    # .env
    env_content = f"AGENTBAZAAR_WS_TOKEN={ws_token}\nANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY\n"
    (out / ".env").write_text(env_content)

    # agent.py
    prompt_text = system_prompt or f"You are {name}. {description or 'You help users with their requests.'}"
    agent_script = f'''import asyncio
import json
import os

import anthropic
import websockets
from dotenv import load_dotenv

load_dotenv()

WS_TOKEN = os.environ["AGENTBAZAAR_WS_TOKEN"]
API_KEY = os.environ["ANTHROPIC_API_KEY"]
RECONNECT_SECONDS = 5

client = anthropic.Anthropic(api_key=API_KEY)

SYSTEM_PROMPT = """{prompt_text}"""


async def handle_task(task_text: str) -> str:
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{{"role": "user", "content": task_text}}],
    )
    return message.content[0].text


async def connect():
    uri = f"wss://agentbazaar.dev/ws?token={{WS_TOKEN}}"
    while True:
        try:
            print("Connecting to AgentBazaar...")
            async with websockets.connect(uri) as ws:
                print("Connected! Listening for jobs...")
                async for raw in ws:
                    msg = json.loads(raw)
                    if "taskId" not in msg or "input" not in msg:
                        continue

                    task_id = msg["taskId"]
                    inp = msg["input"]
                    task_text = inp if isinstance(inp, str) else inp.get("task", json.dumps(inp))
                    print(f"Job {{task_id}}: {{task_text[:80]}}")

                    try:
                        result = await asyncio.to_thread(handle_task, task_text)
                        await ws.send(json.dumps({{
                            "taskId": task_id,
                            "result": {{"success": True, "agent": {json.dumps(name)}, "result": result}},
                            "status": 200,
                            "final": True,
                        }}))
                        print(f"Job {{task_id}}: responded")
                    except Exception as e:
                        print(f"Error: {{e}}")
                        await ws.send(json.dumps({{
                            "taskId": task_id,
                            "result": {{"success": False, "error": "Agent error"}},
                            "status": 500,
                            "final": True,
                        }}))
        except Exception as e:
            print(f"Disconnected: {{e}}. Reconnecting in {{RECONNECT_SECONDS}}s...")
            await asyncio.sleep(RECONNECT_SECONDS)


if __name__ == "__main__":
    asyncio.run(connect())
'''
    (out / "agent.py").write_text(agent_script)

    # Print summary
    console.print(f"\n[bold]--- Your Agent ---[/bold]")
    console.print(f"Name: {agent['name']}")
    console.print(f"Authority: {agent['authority']}")
    if agent.get("slug"):
        console.print(f"Profile: https://agentbazaar.dev/agent/{agent['slug']}")
    if wallet:
        console.print(f"Wallet: {wallet['solanaAddress']}")
        console.print(f"Recovery Phrase: {wallet['recoveryPhrase']}")
    if api_token:
        console.print(f"API Token: {api_token}")

    console.print(f"\n[bold]--- Next Steps ---[/bold]")
    rel = os.path.relpath(out) if str(out) != os.getcwd() else "."
    console.print(f"1. cd {rel}")
    console.print(f"2. Add your ANTHROPIC_API_KEY to .env")
    console.print(f"3. pip install -r requirements.txt")
    console.print(f"4. python agent.py")
    console.print(f"\n[green]Your agent will connect to AgentBazaar and start earning![/green]")


@app.command()
def agents(
    skill: str = typer.Option(None, "--skill", help="Filter by skill"),
    limit: int = typer.Option(20, "--limit", help="Max results"),
    api: str = typer.Option(API_BASE, "--api", help="API base URL"),
) -> None:
    """List registered agents."""
    params = {"limit": str(limit), "active_only": "true"}
    if skill:
        params["skills"] = skill
    resp = httpx.get(f"{api}/agents", params=params, timeout=15)
    data = resp.json()
    for a in data.get("agents", []):
        status = "Active" if a["is_active"] else "Inactive"
        price = int(a["price_per_request"]) / 1_000_000
        console.print(f"  {a['name']} ({status}) — ${price:.2f} USDC")
        console.print(f"    Skills: {a['skills']}")
        console.print(f"    Jobs: {a['total_jobs_completed']}")
        console.print()


@app.command()
def stats(
    api: str = typer.Option(API_BASE, "--api", help="API base URL"),
) -> None:
    """Platform statistics."""
    resp = httpx.get(f"{api}/stats", timeout=15)
    data = resp.json()
    console.print("[bold]AgentBazaar Platform Stats[/bold]")
    console.print(f"  Agents: {data.get('total_agents', 0)}")
    console.print(f"  Jobs: {data.get('total_jobs', 0)}")
    console.print(f"  Volume: ${data.get('total_volume_usdc', '0')} USDC")


if __name__ == "__main__":
    app()
