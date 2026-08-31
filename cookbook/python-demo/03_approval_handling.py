"""
Demo 03: Sensitive Tool Approvals
Demonstrates intercepting approval/request notifications when the agent
attempts sensitive actions (e.g., executing shell commands or writing files),
and programmatically or interactively prompting the user.
"""

import asyncio
from client import MiniAgentClient


async def interactive_approval_handler(request_id: str, action: str) -> bool:
    """
    Custom approval callback.
    Can be connected to a GUI modal, CLI prompt, or security policy engine.
    """
    print("\n" + "=" * 60)
    print("🔒 [SECURITY APPROVAL REQUIRED]")
    print(f"Request ID : {request_id}")
    print(f"Action     : {action}")
    print("=" * 60)

    # In a real UI, this could be a button click or WebSocket response.
    loop = asyncio.get_running_loop()
    user_choice = await loop.run_in_executor(
        None,
        lambda: input("Allow agent to execute this action? (y/N): ").strip().lower(),
    )
    approved = user_choice in ("y", "yes")
    print(f"-> Decision: {'APPROVED' if approved else 'REJECTED'}\n")
    return approved


async def main():
    print("=== Demo 03: Sensitive Tool Approvals ===")

    # Initialize client with our custom approval handler
    async with MiniAgentClient(approval_handler=interactive_approval_handler) as client:
        await client.initialize(profile="interactive")
        await client.start_thread()

        prompt = "Please run a shell command to check current git status and list files."
        print(f"[Prompt]: {prompt}\n")

        async for item in client.stream_turn(prompt):
            if item["type"] == "event":
                event = item["event"]
                event_type = event.get("type")

                if event_type == "assistant_text_delta":
                    print(event.get("delta", ""), end="", flush=True)

                elif event_type == "tool_started":
                    call = event.get("call", {})
                    print(f"\n[Tool Started]: {call.get('name')}({call.get('arguments')})")

                elif event_type == "tool_finished":
                    print(f"[Tool Finished]: {event.get('name')}")

                elif event_type == "turn_finished":
                    print(f"\n\n[Turn Finished Status]: {event.get('status')}")


if __name__ == "__main__":
    asyncio.run(main())
